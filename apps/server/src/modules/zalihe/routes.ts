import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { MODULES, OBAVEZNI_MODULI, type ModulId } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requireAdmin, requirePrivilege } from "../auth/guard.js";
import { dodajPromet, stanjeNaDan } from "./service.js";

const read = requirePrivilege("zalihe", "read");
const write = requirePrivilege("zalihe", "write");

const MODULI_KEY = "moduli";

// svi moduli podrazumevano ukljuceni (odluka sa sastanka: nema wizarda,
// admin gasi u Podesavanja > Moduli); obavezni se ne mogu iskljuciti
async function getModuli(): Promise<Record<ModulId, boolean>> {
  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, MODULI_KEY));
  const svi = Object.fromEntries(MODULES.map((m) => [m.id, true]));
  const val = { ...svi, ...((row?.value as object) ?? {}) } as Record<ModulId, boolean>;
  for (const m of OBAVEZNI_MODULI) val[m] = true;
  return val;
}

const prenosSchema = z.object({
  izdajnoId: z.number(),
  prijemnoId: z.number(),
  datum: z.string(),
  napomena: z.string().default(""),
  stavke: z
    .array(
      z.object({
        articleId: z.number(),
        kolicina: z.number().positive(),
        serijskiBrojevi: z.array(z.string().min(1)).default([]),
        napomena: z.string().default(""),
      }),
    )
    .min(1),
});

type PrenosStavkaInput = z.infer<typeof prenosSchema>["stavke"][number];

// Knjizenje stavki prenosa - deli POST i PUT (faza 15, RP2): validacija serijskih
// (artikal sa flagom mora imati tacno kolicina brojeva), promet -izdajno/+prijemno,
// selidba serijskih brojeva, upis prenos_stavke redova.
async function knjiziPrenosStavke(
  tx: typeof db,
  prenos: { id: number; izdajnoId: number; prijemnoId: number; datum: Date },
  stavke: PrenosStavkaInput[],
  userId: number | null,
) {
  for (const s of stavke) {
    const [artikal] = await tx
      .select({
        ident: schema.articles.ident,
        naziv: schema.articles.naziv,
        serijskiBrojevi: schema.articles.serijskiBrojevi,
      })
      .from(schema.articles)
      .where(eq(schema.articles.id, s.articleId));
    if (!artikal) throw new Error("Artikal ne postoji");
    if (artikal.serijskiBrojevi && s.serijskiBrojevi.length !== s.kolicina) {
      throw new Error(
        `Artikal ${artikal.ident} vodi serijske brojeve: izaberite tacno ${s.kolicina} serijskih brojeva iz izdajnog skladista`,
      );
    }
    if (s.serijskiBrojevi.length > s.kolicina) {
      throw new Error("Vise serijskih brojeva nego sto je kolicina stavke");
    }
    // validacija stanja je u dodajPromet (izdajno skladiste)
    await dodajPromet(tx, {
      articleId: s.articleId,
      warehouseId: prenos.izdajnoId,
      datum: prenos.datum,
      kolicina: -s.kolicina,
      vrsta: "prenos",
      refId: prenos.id,
      userId,
    });
    await dodajPromet(tx, {
      articleId: s.articleId,
      warehouseId: prenos.prijemnoId,
      datum: prenos.datum,
      kolicina: s.kolicina,
      vrsta: "prenos",
      refId: prenos.id,
      userId,
    });
    // serijski brojevi se sele zajedno sa robom (brief 12.3)
    for (const broj of s.serijskiBrojevi) {
      const [red] = await tx
        .select({ id: schema.serialNumbers.id })
        .from(schema.serialNumbers)
        .where(
          and(
            eq(schema.serialNumbers.articleId, s.articleId),
            eq(schema.serialNumbers.warehouseId, prenos.izdajnoId),
            eq(schema.serialNumbers.broj, broj),
            isNull(schema.serialNumbers.izlazId),
          ),
        );
      if (!red) throw new Error(`Serijski broj ${broj} nije u izdajnom skladistu`);
      await tx
        .update(schema.serialNumbers)
        .set({ warehouseId: prenos.prijemnoId })
        .where(eq(schema.serialNumbers.id, red.id));
    }
    await tx.insert(schema.prenosStavke).values({
      prenosId: prenos.id,
      articleId: s.articleId,
      ident: artikal.ident,
      naziv: artikal.naziv,
      kolicina: s.kolicina.toString(),
      serijskiBrojevi: s.serijskiBrojevi,
      napomena: s.napomena,
    });
  }
}

// Upis stavki nacrt prenosa (bez knjizenja, bez selidbe serijskih) - koristi se
// za izmenu nacrta i za generator prenosa iz popisa. Serijski brojevi su opcioni
// (0..kolicina), kompletiraju se pre primene.
export async function upisiNacrtStavke(tx: typeof db, prenosId: number, stavke: PrenosStavkaInput[]) {
  for (const s of stavke) {
    const [artikal] = await tx
      .select({ ident: schema.articles.ident, naziv: schema.articles.naziv })
      .from(schema.articles)
      .where(eq(schema.articles.id, s.articleId));
    if (!artikal) throw new Error("Artikal ne postoji");
    if (s.serijskiBrojevi.length > s.kolicina) {
      throw new Error("Vise serijskih brojeva nego sto je kolicina stavke");
    }
    await tx.insert(schema.prenosStavke).values({
      prenosId,
      articleId: s.articleId,
      ident: artikal.ident,
      naziv: artikal.naziv,
      kolicina: s.kolicina.toString(),
      serijskiBrojevi: s.serijskiBrojevi,
      napomena: s.napomena,
    });
  }
}

export async function zaliheRoutes(app: FastifyInstance) {
  // --- Moduli (brief 12): admin ukljucuje funkcionalnosti ---

  app.get("/api/moduli", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    return getModuli();
  });

  app.put("/api/moduli", { preHandler: requireAdmin }, async (req, reply) => {
    const shape = Object.fromEntries(MODULES.map((m) => [m.id, z.boolean().optional()]));
    const parsed = z.object(shape).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const value = { ...(await getModuli()), ...parsed.data };
    for (const m of OBAVEZNI_MODULI) value[m] = true;
    // zavisnosti: iskljucen preduslov gasi i zavisne module
    for (const m of MODULES) {
      if (value[m.id] && m.zavisi.some((z2) => !value[z2 as ModulId])) value[m.id] = false;
    }
    await db
      .insert(schema.appSettings)
      .values({ key: MODULI_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return value;
  });

  // --- Skladista: definise admin u podesavanjima, jedno primarno ---

  app.get("/api/skladista", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    return db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.active, true))
      .orderBy(desc(schema.warehouses.isPrimary), asc(schema.warehouses.id));
  });

  const skladisteSchema = z.object({ naziv: z.string().min(1), isPrimary: z.boolean().default(false) });

  app.post("/api/skladista", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = skladisteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Naziv je obavezan" });
    const postojeca = await db.select().from(schema.warehouses).where(eq(schema.warehouses.active, true));
    const isPrimary = parsed.data.isPrimary || postojeca.length === 0; // prvo skladiste je primarno
    if (isPrimary) await db.update(schema.warehouses).set({ isPrimary: false });
    const [created] = await db
      .insert(schema.warehouses)
      .values({ naziv: parsed.data.naziv, isPrimary })
      .returning();
    return reply.code(201).send(created);
  });

  app.put("/api/skladista/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = skladisteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Naziv je obavezan" });
    if (parsed.data.isPrimary) {
      await db.update(schema.warehouses).set({ isPrimary: false }).where(ne(schema.warehouses.id, id));
    }
    const [updated] = await db
      .update(schema.warehouses)
      .set(parsed.data)
      .where(eq(schema.warehouses.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Skladiste ne postoji" });
    return updated;
  });

  app.delete("/api/skladista/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, id));
    if (!row) return reply.code(404).send({ error: "Skladiste ne postoji" });
    if (row.isPrimary) return reply.code(400).send({ error: "Primarno skladiste se ne moze obrisati" });
    await db.update(schema.warehouses).set({ active: false }).where(eq(schema.warehouses.id, id));
    return { ok: true };
  });

  // --- Kartica Zalihe na artiklu (brief 12) ---

  app.get("/api/artikli/:id/zalihe", { preHandler: read }, async (req, reply) => {
    const articleId = Number((req.params as { id: string }).id);
    const [artikal] = await db.select().from(schema.articles).where(eq(schema.articles.id, articleId));
    if (!artikal) return reply.code(404).send({ error: "Artikal ne postoji" });
    const skladista = await db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.active, true))
      .orderBy(desc(schema.warehouses.isPrimary), asc(schema.warehouses.id));
    const nivoi = await db
      .select()
      .from(schema.articleStockLevels)
      .where(eq(schema.articleStockLevels.articleId, articleId));
    const serijski = await db
      .select({
        warehouseId: schema.serialNumbers.warehouseId,
        broj: sql<number>`count(*)`,
      })
      .from(schema.serialNumbers)
      .where(and(eq(schema.serialNumbers.articleId, articleId), isNull(schema.serialNumbers.izlazId)))
      .groupBy(schema.serialNumbers.warehouseId);
    const sad = new Date();
    const redovi = [];
    for (const s of skladista) {
      const nivo = nivoi.find((n) => n.warehouseId === s.id);
      redovi.push({
        warehouseId: s.id,
        naziv: s.naziv,
        isPrimary: s.isPrimary,
        stanje: await stanjeNaDan(db, articleId, s.id, sad),
        min: nivo?.min ?? null,
        opt: nivo?.opt ?? null,
        max: nivo?.max ?? null,
        serijskih: Number(serijski.find((x) => x.warehouseId === s.id)?.broj ?? 0),
      });
    }
    return {
      zbirnaNasaKolicina: artikal.zbirnaNasaKolicina,
      zbirnaNasaJm: artikal.zbirnaNasaJm,
      zbirnaDobKolicina: artikal.zbirnaDobKolicina,
      zbirnaDobJm: artikal.zbirnaDobJm,
      minPorucivanje: artikal.minPorucivanje,
      korakPorucivanja: artikal.korakPorucivanja,
      skladista: redovi,
    };
  });

  const nivoSchema = z.object({
    warehouseId: z.number(),
    min: z.number().nullable().default(null),
    opt: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
  });

  app.put("/api/artikli/:id/zalihe", { preHandler: write }, async (req, reply) => {
    const articleId = Number((req.params as { id: string }).id);
    const parsed = z
      .object({
        zbirnaNasaKolicina: z.number().nullable().default(null),
        zbirnaNasaJm: z.string().default(""),
        zbirnaDobKolicina: z.number().nullable().default(null),
        zbirnaDobJm: z.string().default(""),
        minPorucivanje: z.number().nullable().default(null),
        korakPorucivanja: z.number().nullable().default(null),
        nivoi: z.array(nivoSchema).default([]),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const { nivoi, ...header } = parsed.data;
    const [updated] = await db
      .update(schema.articles)
      .set({
        zbirnaNasaKolicina: header.zbirnaNasaKolicina?.toString() ?? null,
        zbirnaNasaJm: header.zbirnaNasaJm,
        zbirnaDobKolicina: header.zbirnaDobKolicina?.toString() ?? null,
        zbirnaDobJm: header.zbirnaDobJm,
        minPorucivanje: header.minPorucivanje?.toString() ?? null,
        korakPorucivanja: header.korakPorucivanja?.toString() ?? null,
      })
      .where(eq(schema.articles.id, articleId))
      .returning({ id: schema.articles.id });
    if (!updated) return reply.code(404).send({ error: "Artikal ne postoji" });
    for (const n of nivoi) {
      await db
        .insert(schema.articleStockLevels)
        .values({
          articleId,
          warehouseId: n.warehouseId,
          min: n.min?.toString() ?? null,
          opt: n.opt?.toString() ?? null,
          max: n.max?.toString() ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.articleStockLevels.articleId, schema.articleStockLevels.warehouseId],
          set: {
            min: n.min?.toString() ?? null,
            opt: n.opt?.toString() ?? null,
            max: n.max?.toString() ?? null,
          },
        });
    }
    return { ok: true };
  });

  // Serijski brojevi artikla po skladistu (brief 12.3).
  // Bez skladisteId vraca SVE brojeve artikla (i izdate) sa nazivom skladista,
  // za CSV export pri iskljucivanju vodjenja (faza 15, RP3).
  app.get("/api/artikli/:id/serijski-brojevi", { preHandler: read }, async (req) => {
    const articleId = Number((req.params as { id: string }).id);
    const { skladisteId } = req.query as { skladisteId?: string };
    if (skladisteId) {
      return db
        .select()
        .from(schema.serialNumbers)
        .where(
          and(
            eq(schema.serialNumbers.articleId, articleId),
            isNull(schema.serialNumbers.izlazId),
            eq(schema.serialNumbers.warehouseId, Number(skladisteId)),
          ),
        )
        .orderBy(asc(schema.serialNumbers.id));
    }
    return db
      .select({
        id: schema.serialNumbers.id,
        warehouseId: schema.serialNumbers.warehouseId,
        skladiste: schema.warehouses.naziv,
        broj: schema.serialNumbers.broj,
        izlazId: schema.serialNumbers.izlazId,
      })
      .from(schema.serialNumbers)
      .innerJoin(schema.warehouses, eq(schema.serialNumbers.warehouseId, schema.warehouses.id))
      .where(eq(schema.serialNumbers.articleId, articleId))
      .orderBy(asc(schema.serialNumbers.warehouseId), asc(schema.serialNumbers.id));
  });

  // Ukljucivanje/iskljucivanje vodjenja serijskih brojeva (faza 15, RP3).
  // Iskljucivanje TRAJNO brise sve brojeve artikla; ukljucivanje sa zalihama
  // zahteva tacno stanje brojeva po svakom skladistu.
  app.post(
    "/api/artikli/:id/serijski-flag",
    { preHandler: requirePrivilege("artikli", "write") },
    async (req, reply) => {
      const articleId = Number((req.params as { id: string }).id);
      const parsed = z
        .object({
          enable: z.boolean(),
          poSkladistu: z.record(z.string(), z.array(z.string().min(1))).default({}),
        })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
      const [artikal] = await db.select().from(schema.articles).where(eq(schema.articles.id, articleId));
      if (!artikal) return reply.code(404).send({ error: "Artikal ne postoji" });

      if (!parsed.data.enable) {
        await db.transaction(async (tx) => {
          await tx.delete(schema.serialNumbers).where(eq(schema.serialNumbers.articleId, articleId));
          await tx.update(schema.articles).set({ serijskiBrojevi: false }).where(eq(schema.articles.id, articleId));
        });
        return { ok: true };
      }

      // duplikati u celom payload-u
      const svi = Object.values(parsed.data.poSkladistu).flat().map((b) => b.trim());
      const videni = new Set<string>();
      for (const b of svi) {
        if (videni.has(b)) return reply.code(400).send({ error: `Serijski broj "${b}" je unet vise puta` });
        videni.add(b);
      }

      const skladista = await db.select().from(schema.warehouses).where(eq(schema.warehouses.active, true));
      const poznata = new Set(skladista.map((s) => String(s.id)));
      for (const key of Object.keys(parsed.data.poSkladistu)) {
        if (!poznata.has(key)) return reply.code(400).send({ error: "Nepoznato skladiste u zahtevu" });
      }

      const sad = new Date();
      const inserts: { articleId: number; warehouseId: number; broj: string }[] = [];
      for (const s of skladista) {
        const stanje = await stanjeNaDan(db, articleId, s.id, sad);
        const brojevi = (parsed.data.poSkladistu[String(s.id)] ?? []).map((b) => b.trim());
        if (brojevi.length !== stanje) {
          return reply
            .code(400)
            .send({ error: `Skladiste ${s.naziv}: uneto ${brojevi.length}, stanje ${stanje}` });
        }
        for (const broj of brojevi) inserts.push({ articleId, warehouseId: s.id, broj });
      }

      await db.transaction(async (tx) => {
        await tx.delete(schema.serialNumbers).where(eq(schema.serialNumbers.articleId, articleId));
        if (inserts.length) await tx.insert(schema.serialNumbers).values(inserts);
        await tx.update(schema.articles).set({ serijskiBrojevi: true }).where(eq(schema.articles.id, articleId));
      });
      return { ok: true };
    },
  );

  // Obracun stanja na dan (brief 12)
  app.get("/api/zalihe/stanje", { preHandler: read }, async (req, reply) => {
    const { articleId, warehouseId, datum } = req.query as Record<string, string | undefined>;
    if (!articleId || !warehouseId) return reply.code(400).send({ error: "articleId i warehouseId su obavezni" });
    const dan = datum ? new Date(`${datum}T23:59:59.999Z`) : new Date();
    return { stanje: await stanjeNaDan(db, Number(articleId), Number(warehouseId), dan) };
  });

  // --- Prenos medju skladistima (brief 12) ---

  app.get("/api/prenosi", { preHandler: read }, async () => {
    const iz = schema.warehouses;
    const rows = await db
      .select({
        id: schema.prenosi.id,
        broj: schema.prenosi.broj,
        datum: schema.prenosi.datum,
        izdajnoId: schema.prenosi.izdajnoId,
        prijemnoId: schema.prenosi.prijemnoId,
        napomena: schema.prenosi.napomena,
        status: schema.prenosi.status,
        popisId: schema.prenosi.popisId,
        referent: schema.users.fullName,
      })
      .from(schema.prenosi)
      .leftJoin(schema.users, eq(schema.prenosi.userId, schema.users.id))
      .orderBy(desc(schema.prenosi.id));
    const skladista = await db.select().from(iz);
    const naziv = (id: number) => skladista.find((s) => s.id === id)?.naziv ?? "?";
    return rows.map((r) => ({ ...r, izdajno: naziv(r.izdajnoId), prijemno: naziv(r.prijemnoId) }));
  });

  app.get("/api/prenosi/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [prenos] = await db.select().from(schema.prenosi).where(eq(schema.prenosi.id, id));
    if (!prenos) return reply.code(404).send({ error: "Prenos ne postoji" });
    const stavke = await db
      .select()
      .from(schema.prenosStavke)
      .where(eq(schema.prenosStavke.prenosId, id))
      .orderBy(asc(schema.prenosStavke.id));
    return { ...prenos, stavke };
  });

  app.post("/api/prenosi", { preHandler: write }, async (req, reply) => {
    const parsed = prenosSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const p = parsed.data;
    if (p.izdajnoId === p.prijemnoId) {
      return reply.code(400).send({ error: "Izdajno i prijemno skladiste moraju biti razlicita" });
    }
    const datum = new Date(`${p.datum.slice(0, 10)}T12:00:00Z`);
    try {
      const prenos = await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const godina = new Date().getFullYear();
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${schema.prenosi.redniBroj}), 0)` })
          .from(schema.prenosi)
          .where(eq(schema.prenosi.godina, godina));
        const redniBroj = (max?.n ?? 0) + 1;
        const [pr] = await tx
          .insert(schema.prenosi)
          .values({
            godina,
            redniBroj,
            broj: `${String(godina).slice(-2)}-PRN-${String(redniBroj).padStart(5, "0")}`,
            izdajnoId: p.izdajnoId,
            prijemnoId: p.prijemnoId,
            datum,
            napomena: p.napomena,
            status: "knjizen",
            userId: req.user?.id ?? null,
          })
          .returning();
        await knjiziPrenosStavke(
          txdb,
          { id: pr!.id, izdajnoId: p.izdajnoId, prijemnoId: p.prijemnoId, datum },
          p.stavke,
          req.user?.id ?? null,
        );
        return pr!;
      });
      return reply.code(201).send(prenos);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Prenos nije uspeo" });
    }
  });

  // Izmena prenosa (faza 15, RP2.4): puno storniranje starih stavki kroz dodajPromet
  // (cuva audit trail i validaciju stanja), vracanje serijskih, pa ponovno knjizenje.
  app.put("/api/prenosi/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = prenosSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const p = parsed.data;
    if (p.izdajnoId === p.prijemnoId) {
      return reply.code(400).send({ error: "Izdajno i prijemno skladiste moraju biti razlicita" });
    }
    const [stari] = await db.select().from(schema.prenosi).where(eq(schema.prenosi.id, id));
    if (!stari) return reply.code(404).send({ error: "Prenos ne postoji" });
    const datum = new Date(`${p.datum.slice(0, 10)}T12:00:00Z`);
    // nacrt: bez ledger/serijskih efekata, samo zamena redova (storno bi korumpirao ledger)
    if (stari.status === "nacrt") {
      try {
        await db.transaction(async (tx) => {
          const txdb = tx as unknown as typeof db;
          await tx.delete(schema.prenosStavke).where(eq(schema.prenosStavke.prenosId, id));
          await upisiNacrtStavke(txdb, id, p.stavke);
          await tx
            .update(schema.prenosi)
            .set({ izdajnoId: p.izdajnoId, prijemnoId: p.prijemnoId, datum, napomena: p.napomena })
            .where(eq(schema.prenosi.id, id));
        });
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "Izmena prenosa nije uspela" });
      }
    }
    try {
      await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const stareStavke = await tx
          .select()
          .from(schema.prenosStavke)
          .where(eq(schema.prenosStavke.prenosId, id));
        // storno starih stavki na STARI datum: +izdajno, -prijemno; dodajPromet
        // baca gresku ako je roba u medjuvremenu potrosena na prijemnom
        for (const s of stareStavke) {
          const kolicina = Number(s.kolicina);
          await dodajPromet(txdb, {
            articleId: s.articleId,
            warehouseId: stari.izdajnoId,
            datum: stari.datum,
            kolicina,
            vrsta: "prenos_storno",
            refId: id,
            userId: req.user?.id ?? null,
          });
          await dodajPromet(txdb, {
            articleId: s.articleId,
            warehouseId: stari.prijemnoId,
            datum: stari.datum,
            kolicina: -kolicina,
            vrsta: "prenos_storno",
            refId: id,
            userId: req.user?.id ?? null,
          });
          // vracanje serijskih na staro izdajno; blokada ako je broj u medjuvremenu otisao dalje
          for (const broj of (s.serijskiBrojevi ?? []) as string[]) {
            const [red] = await tx
              .select({ id: schema.serialNumbers.id })
              .from(schema.serialNumbers)
              .where(
                and(
                  eq(schema.serialNumbers.articleId, s.articleId),
                  eq(schema.serialNumbers.warehouseId, stari.prijemnoId),
                  eq(schema.serialNumbers.broj, broj),
                  isNull(schema.serialNumbers.izlazId),
                ),
              );
            if (!red) {
              throw new Error(`Serijski broj ${broj} je u medjuvremenu izdat ili premesten - izmena prenosa nije moguca`);
            }
            await tx
              .update(schema.serialNumbers)
              .set({ warehouseId: stari.izdajnoId })
              .where(eq(schema.serialNumbers.id, red.id));
          }
        }
        await tx.delete(schema.prenosStavke).where(eq(schema.prenosStavke.prenosId, id));
        await knjiziPrenosStavke(
          txdb,
          { id, izdajnoId: p.izdajnoId, prijemnoId: p.prijemnoId, datum },
          p.stavke,
          req.user?.id ?? null,
        );
        // broj/redniBroj/godina se NE menjaju
        await tx
          .update(schema.prenosi)
          .set({ izdajnoId: p.izdajnoId, prijemnoId: p.prijemnoId, datum, napomena: p.napomena })
          .where(eq(schema.prenosi.id, id));
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Izmena prenosa nije uspela" });
    }
  });

  // Primena nacrta: knjizi promet i seli serijske; guard update sprecava duplu primenu
  app.post("/api/prenosi/:id/primeni", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const [p] = await tx
          .update(schema.prenosi)
          .set({ status: "knjizen" })
          .where(and(eq(schema.prenosi.id, id), eq(schema.prenosi.status, "nacrt")))
          .returning();
        if (!p) throw new Error("Prenos nije nacrt ili ne postoji");
        const stavke = await tx
          .select()
          .from(schema.prenosStavke)
          .where(eq(schema.prenosStavke.prenosId, id))
          .orderBy(asc(schema.prenosStavke.id));
        await tx.delete(schema.prenosStavke).where(eq(schema.prenosStavke.prenosId, id));
        await knjiziPrenosStavke(
          txdb,
          { id, izdajnoId: p.izdajnoId, prijemnoId: p.prijemnoId, datum: p.datum },
          stavke.map((s) => ({
            articleId: s.articleId,
            kolicina: Number(s.kolicina),
            serijskiBrojevi: (s.serijskiBrojevi ?? []) as string[],
            napomena: s.napomena,
          })),
          req.user?.id ?? null,
        );
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Primena prenosa nije uspela" });
    }
  });

  app.delete("/api/prenosi/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [p] = await db.select().from(schema.prenosi).where(eq(schema.prenosi.id, id));
    if (!p) return reply.code(404).send({ error: "Prenos ne postoji" });
    if (p.status !== "nacrt") return reply.code(400).send({ error: "Samo nacrt prenosa se moze obrisati" });
    await db.delete(schema.prenosi).where(eq(schema.prenosi.id, id));
    return { ok: true };
  });
}
