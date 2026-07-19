import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, or, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";
import { upisiNacrtStavke } from "./routes.js";

const read = requirePrivilege("zalihe", "read");
const write = requirePrivilege("zalihe", "write");

type Tx = typeof db;

// Batch stanje svih artikala po skladistima na dan: pun zbir ledgera, isti pristup
// kao /api/artikli-pretraga; mesecni snapshot je samo optimizacija i ovde se namerno preskace.
async function stanjaNaDan(tx: Tx, skladistaIds: number[], datumKraj: Date) {
  const rows = await tx
    .select({
      articleId: schema.stockLedger.articleId,
      warehouseId: schema.stockLedger.warehouseId,
      stanje: sql<string>`coalesce(sum(${schema.stockLedger.kolicina}), 0)`,
    })
    .from(schema.stockLedger)
    .where(and(inArray(schema.stockLedger.warehouseId, skladistaIds), sql`${schema.stockLedger.datum} <= ${datumKraj}`))
    .groupBy(schema.stockLedger.articleId, schema.stockLedger.warehouseId);
  const mapa = new Map<string, number>();
  for (const r of rows) mapa.set(`${r.articleId}:${r.warehouseId}`, Number(r.stanje));
  return mapa;
}

// Artikli koji ulaze u popis po kriterijumima (podstablo kategorija preko code prefiksa)
async function izaberiArtikle(kriterijumi: { dobavljacIds: number[]; kategorijaIds: number[] }) {
  const uslovi = [sql`${schema.articles.tip} != 'parent'`, eq(schema.articles.active, true)];
  if (kriterijumi.dobavljacIds.length) {
    uslovi.push(inArray(schema.articles.dobavljacId, kriterijumi.dobavljacIds));
  }
  if (kriterijumi.kategorijaIds.length) {
    const kats = await db
      .select({ code: schema.categories.code })
      .from(schema.categories)
      .where(inArray(schema.categories.id, kriterijumi.kategorijaIds));
    // prefiks bez zavrsnih nula-parova: "A01000000" pokriva celo podstablo "A01..."
    const prefiksi = kats.map((k) => {
      let c = k.code ?? "";
      while (c.length > 1 && c.endsWith("00")) c = c.slice(0, -2);
      return c;
    });
    const podstablo = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(or(...prefiksi.map((p) => like(schema.categories.code, `${p}%`))));
    const ids = podstablo.map((k) => k.id);
    if (!ids.length) return [];
    uslovi.push(
      or(
        inArray(schema.articles.glavnaKategorijaId, ids),
        inArray(schema.articles.sekundarnaKategorijaId, ids),
      )!,
    );
  }
  return db
    .select({ id: schema.articles.id, ident: schema.articles.ident, naziv: schema.articles.naziv })
    .from(schema.articles)
    .where(and(...uslovi))
    .orderBy(asc(schema.articles.ident));
}

function krajDana(datum: string) {
  return new Date(`${datum.slice(0, 10)}T23:59:59.999Z`);
}

const popisSchema = z.object({
  datum: z.string(),
  napomena: z.string().default(""),
  skladistaIds: z.array(z.number()).min(1),
  dobavljacIds: z.array(z.number()).default([]),
  kategorijaIds: z.array(z.number()).default([]),
});

export async function popisiRoutes(app: FastifyInstance) {
  app.get("/api/popisi", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.popisi.id,
        broj: schema.popisi.broj,
        datum: schema.popisi.datum,
        status: schema.popisi.status,
        napomena: schema.popisi.napomena,
        referent: schema.users.fullName,
      })
      .from(schema.popisi)
      .leftJoin(schema.users, eq(schema.popisi.userId, schema.users.id))
      .orderBy(desc(schema.popisi.id));
  });

  app.post("/api/popisi", { preHandler: write }, async (req, reply) => {
    const parsed = popisSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const p = parsed.data;
    const artikli = await izaberiArtikle(p);
    if (!artikli.length) return reply.code(400).send({ error: "Nijedan artikal ne odgovara kriterijumima" });
    try {
      const popis = await db.transaction(async (tx) => {
        const txdb = tx as unknown as Tx;
        const godina = new Date().getFullYear();
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${schema.popisi.redniBroj}), 0)` })
          .from(schema.popisi)
          .where(eq(schema.popisi.godina, godina));
        const redniBroj = (max?.n ?? 0) + 1;
        const [pop] = await tx
          .insert(schema.popisi)
          .values({
            godina,
            redniBroj,
            broj: `${String(godina).slice(-2)}-POP-${String(redniBroj).padStart(5, "0")}`,
            datum: new Date(`${p.datum.slice(0, 10)}T12:00:00Z`),
            napomena: p.napomena,
            kriterijumi: { skladistaIds: p.skladistaIds, dobavljacIds: p.dobavljacIds, kategorijaIds: p.kategorijaIds },
            userId: req.user?.id ?? null,
          })
          .returning();
        const stanja = await stanjaNaDan(txdb, p.skladistaIds, krajDana(p.datum));
        const redovi = [];
        for (const a of artikli) {
          for (const w of p.skladistaIds) {
            redovi.push({
              popisId: pop!.id,
              articleId: a.id,
              warehouseId: w,
              ident: a.ident,
              naziv: a.naziv,
              ocekivano: (stanja.get(`${a.id}:${w}`) ?? 0).toString(),
            });
          }
        }
        // chunk zbog Postgres limita od 65535 parametara po upitu
        for (let i = 0; i < redovi.length; i += 1000) {
          await tx.insert(schema.popisStavke).values(redovi.slice(i, i + 1000));
        }
        return pop!;
      });
      return reply.code(201).send({ id: popis.id, broj: popis.broj });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Kreiranje popisa nije uspelo" });
    }
  });

  app.get("/api/popisi/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [popis] = await db.select().from(schema.popisi).where(eq(schema.popisi.id, id));
    if (!popis) return reply.code(404).send({ error: "Popis ne postoji" });
    const stavke = await db
      .select({
        articleId: schema.popisStavke.articleId,
        warehouseId: schema.popisStavke.warehouseId,
        ident: schema.popisStavke.ident,
        naziv: schema.popisStavke.naziv,
        ocekivano: schema.popisStavke.ocekivano,
        popisano: schema.popisStavke.popisano,
        datumPopisa: schema.popisStavke.datumPopisa,
        dobavljacId: schema.articles.dobavljacId,
        glavnaKategorijaId: schema.articles.glavnaKategorijaId,
        sekundarnaKategorijaId: schema.articles.sekundarnaKategorijaId,
        serijski: schema.articles.serijskiBrojevi,
      })
      .from(schema.popisStavke)
      .innerJoin(schema.articles, eq(schema.popisStavke.articleId, schema.articles.id))
      .where(eq(schema.popisStavke.popisId, id))
      .orderBy(asc(schema.popisStavke.ident), asc(schema.popisStavke.warehouseId));
    const skladistaIds = (popis.kriterijumi as { skladistaIds: number[] }).skladistaIds;
    // bez active filtera: deaktivirano skladiste zadrzava naziv kolone
    const skladista = await db
      .select({ id: schema.warehouses.id, naziv: schema.warehouses.naziv })
      .from(schema.warehouses)
      .where(inArray(schema.warehouses.id, skladistaIds))
      .orderBy(asc(schema.warehouses.id));
    const postojeciPrenosi = await db
      .select({ id: schema.prenosi.id, broj: schema.prenosi.broj, status: schema.prenosi.status })
      .from(schema.prenosi)
      .where(eq(schema.prenosi.popisId, id))
      .orderBy(asc(schema.prenosi.id));
    return { ...popis, stavke, skladista, postojeciPrenosi };
  });

  const stavkeSchema = z
    .array(z.object({ articleId: z.number(), warehouseId: z.number(), popisano: z.number().nullable() }))
    .min(1);

  app.put("/api/popisi/:id/stavke", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = stavkeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const [popis] = await db.select().from(schema.popisi).where(eq(schema.popisi.id, id));
    if (!popis) return reply.code(404).send({ error: "Popis ne postoji" });
    if (popis.status !== "u_toku") return reply.code(400).send({ error: "Popis je zakljucen" });
    await db.transaction(async (tx) => {
      for (const s of parsed.data) {
        await tx
          .update(schema.popisStavke)
          .set({
            popisano: s.popisano === null ? null : s.popisano.toString(),
            datumPopisa: s.popisano === null ? null : new Date(),
          })
          .where(
            and(
              eq(schema.popisStavke.popisId, id),
              eq(schema.popisStavke.articleId, s.articleId),
              eq(schema.popisStavke.warehouseId, s.warehouseId),
            ),
          );
      }
    });
    return { ok: true };
  });

  // Ponovni obracun ocekivanog (promet knjizen tokom popisa); popisano ostaje netaknuto
  app.post("/api/popisi/:id/osvezi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [popis] = await db.select().from(schema.popisi).where(eq(schema.popisi.id, id));
    if (!popis) return reply.code(404).send({ error: "Popis ne postoji" });
    if (popis.status !== "u_toku") return reply.code(400).send({ error: "Popis je zakljucen" });
    const skladistaIds = (popis.kriterijumi as { skladistaIds: number[] }).skladistaIds;
    await db.transaction(async (tx) => {
      const txdb = tx as unknown as Tx;
      const stanja = await stanjaNaDan(txdb, skladistaIds, new Date(popis.datum.toISOString().slice(0, 10) + "T23:59:59.999Z"));
      const stavke = await tx
        .select({ id: schema.popisStavke.id, articleId: schema.popisStavke.articleId, warehouseId: schema.popisStavke.warehouseId })
        .from(schema.popisStavke)
        .where(eq(schema.popisStavke.popisId, id));
      for (const s of stavke) {
        await tx
          .update(schema.popisStavke)
          .set({ ocekivano: (stanja.get(`${s.articleId}:${s.warehouseId}`) ?? 0).toString() })
          .where(eq(schema.popisStavke.id, s.id));
      }
    });
    return { ok: true };
  });

  app.post("/api/popisi/:id/zakljuci", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [p] = await db
      .update(schema.popisi)
      .set({ status: "zakljucen" })
      .where(and(eq(schema.popisi.id, id), eq(schema.popisi.status, "u_toku")))
      .returning();
    if (!p) return reply.code(400).send({ error: "Popis nije u toku ili ne postoji" });
    return { ok: true };
  });

  app.delete("/api/popisi/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [popis] = await db.select().from(schema.popisi).where(eq(schema.popisi.id, id));
    if (!popis) return reply.code(404).send({ error: "Popis ne postoji" });
    if (popis.status !== "u_toku") return reply.code(400).send({ error: "Zakljucen popis se ne moze obrisati" });
    await db.delete(schema.popisi).where(eq(schema.popisi.id, id));
    return { ok: true };
  });

  const generatorSchema = z.object({
    skladistaIds: z.array(z.number()).min(1),
    otpisnoId: z.number().nullable().default(null),
    datum: z.string().optional(),
  });

  // Generator nacrt prenosa iz obracuna razlika: po artiklu greedy uparivanje
  // izvora (papir > fizicko) sa ciljevima (fizicko > papir); neto manjak opciono
  // u otpisno skladiste, neto visak ostaje za presifriranje.
  app.post("/api/popisi/:id/prenosi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = generatorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const g = parsed.data;
    const [popis] = await db.select().from(schema.popisi).where(eq(schema.popisi.id, id));
    if (!popis) return reply.code(404).send({ error: "Popis ne postoji" });
    const stavke = await db
      .select()
      .from(schema.popisStavke)
      .where(and(eq(schema.popisStavke.popisId, id), inArray(schema.popisStavke.warehouseId, g.skladistaIds)));

    type Move = { izdajnoId: number; prijemnoId: number; articleId: number; kolicina: number };
    const moves: Move[] = [];
    const poArtiklu = new Map<number, typeof stavke>();
    for (const s of stavke) {
      if (s.popisano === null) continue;
      const arr = poArtiklu.get(s.articleId) ?? [];
      arr.push(s);
      poArtiklu.set(s.articleId, arr);
    }
    for (const [articleId, redovi] of poArtiklu) {
      const izvori: { w: number; q: number }[] = [];
      const ciljevi: { w: number; q: number }[] = [];
      for (const r of redovi) {
        const razlika = Number(r.popisano) - Number(r.ocekivano);
        if (razlika < 0) izvori.push({ w: r.warehouseId, q: -razlika });
        else if (razlika > 0) ciljevi.push({ w: r.warehouseId, q: razlika });
      }
      izvori.sort((a, b) => a.w - b.w);
      ciljevi.sort((a, b) => a.w - b.w);
      while (izvori.length && ciljevi.length) {
        const q = Math.min(izvori[0]!.q, ciljevi[0]!.q);
        moves.push({ izdajnoId: izvori[0]!.w, prijemnoId: ciljevi[0]!.w, articleId, kolicina: q });
        izvori[0]!.q -= q;
        ciljevi[0]!.q -= q;
        if (izvori[0]!.q === 0) izvori.shift();
        if (ciljevi[0]!.q === 0) ciljevi.shift();
      }
      if (g.otpisnoId !== null) {
        for (const izvor of izvori) {
          if (izvor.w === g.otpisnoId) continue;
          moves.push({ izdajnoId: izvor.w, prijemnoId: g.otpisnoId, articleId, kolicina: izvor.q });
        }
      }
    }
    if (!moves.length) return reply.code(400).send({ error: "Nema razlika koje se resavaju prenosom" });

    const grupe = new Map<string, Move[]>();
    for (const m of moves) {
      const key = `${m.izdajnoId}:${m.prijemnoId}`;
      const arr = grupe.get(key) ?? [];
      arr.push(m);
      grupe.set(key, arr);
    }
    const datum = new Date(`${(g.datum ?? new Date().toISOString()).slice(0, 10)}T12:00:00Z`);
    try {
      const kreirani = await db.transaction(async (tx) => {
        const txdb = tx as unknown as Tx;
        const godina = new Date().getFullYear();
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${schema.prenosi.redniBroj}), 0)` })
          .from(schema.prenosi)
          .where(eq(schema.prenosi.godina, godina));
        let redniBroj = max?.n ?? 0;
        const rezultat: { id: number; broj: string }[] = [];
        for (const [, grupa] of grupe) {
          redniBroj += 1;
          const [pr] = await tx
            .insert(schema.prenosi)
            .values({
              godina,
              redniBroj,
              broj: `${String(godina).slice(-2)}-PRN-${String(redniBroj).padStart(5, "0")}`,
              izdajnoId: grupa[0]!.izdajnoId,
              prijemnoId: grupa[0]!.prijemnoId,
              datum,
              napomena: `Obracun razlika popisa ${popis.broj}`,
              status: "nacrt",
              popisId: popis.id,
              userId: req.user?.id ?? null,
            })
            .returning();
          await upisiNacrtStavke(
            txdb,
            pr!.id,
            grupa.map((m) => ({ articleId: m.articleId, kolicina: m.kolicina, serijskiBrojevi: [], napomena: "" })),
          );
          rezultat.push({ id: pr!.id, broj: pr!.broj });
        }
        return rezultat;
      });
      return reply.code(201).send(kreirani);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Generisanje prenosa nije uspelo" });
    }
  });
}
