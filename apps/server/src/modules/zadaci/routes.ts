import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";
import { obavesti } from "../obavestenja/service.js";

// header zadatka za tekst obavestenja
async function zaglavlje(zadatakId: number): Promise<{ naziv: string; kreiraoId: number } | null> {
  const [z] = await db
    .select({ naziv: schema.zadaci.naziv, kreiraoId: schema.zadaci.kreiraoId })
    .from(schema.zadaci)
    .where(eq(schema.zadaci.id, zadatakId));
  return z ?? null;
}

// aktivni ucesnici (prihvatili) + kreator - primaoci dogadjaja o zadatku
async function ucesnici(zadatakId: number): Promise<number[]> {
  const [z] = await db.select({ kreiraoId: schema.zadaci.kreiraoId }).from(schema.zadaci).where(eq(schema.zadaci.id, zadatakId));
  const izv = await db
    .select({ userId: schema.zadatakIzvrsioci.userId })
    .from(schema.zadatakIzvrsioci)
    .where(and(eq(schema.zadatakIzvrsioci.zadatakId, zadatakId), eq(schema.zadatakIzvrsioci.status, "prihvatio")));
  return [...(z ? [z.kreiraoId] : []), ...izv.map((i) => i.userId)];
}

const read = requirePrivilege("zadaci", "read");

// Aktivni ucesnik = kreator ili izvrsilac koji je prihvatio; oni smeju da menjaju
// opis, dodaju hronologiju i zavrse zadatak.
async function jeAktivan(zadatakId: number, userId: number): Promise<boolean> {
  const [z] = await db
    .select({ kreiraoId: schema.zadaci.kreiraoId })
    .from(schema.zadaci)
    .where(eq(schema.zadaci.id, zadatakId));
  if (!z) return false;
  if (z.kreiraoId === userId) return true;
  const [izv] = await db
    .select({ status: schema.zadatakIzvrsioci.status })
    .from(schema.zadatakIzvrsioci)
    .where(
      and(eq(schema.zadatakIzvrsioci.zadatakId, zadatakId), eq(schema.zadatakIzvrsioci.userId, userId)),
    );
  return izv?.status === "prihvatio";
}

const zadatakSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan").max(300),
  opis: z.string().default(""),
  subjektId: z.number().int().positive().nullable().optional(),
  dokumentId: z.number().int().positive().nullable().optional(),
  rok: z.string().datetime().nullable().optional(),
  prioritet: z.enum(["nizak", "srednji", "visok"]).default("srednji"),
  izvrsioci: z.array(z.number().int().positive()).default([]),
});

export async function zadaciRoutes(app: FastifyInstance) {
  // Izvori za obrazac (izvrsioci/subjekat/dokument) - pod zadaci read guardom,
  // korisnik ne mora imati privilegiju na korisnike/subjekte/dokumente.
  app.get("/api/zadaci-korisnici", { preHandler: read }, async () => {
    return db
      .select({ id: schema.users.id, fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.fullName));
  });

  app.get("/api/zadaci-subjekti", { preHandler: read }, async () => {
    return db
      .select({ id: schema.subjects.id, naziv: schema.subjects.naziv })
      .from(schema.subjects)
      .where(eq(schema.subjects.active, true))
      .orderBy(asc(schema.subjects.naziv));
  });

  app.get("/api/zadaci-dokumenti", { preHandler: read }, async () => {
    return db
      .select({ id: schema.documents.id, broj: schema.documents.broj, tip: schema.documents.tip })
      .from(schema.documents)
      .orderBy(desc(schema.documents.id));
  });

  // Lista sa sazetkom izvrsilaca, naziv subjekta, broj dokumenta, ime kreatora.
  app.get("/api/zadaci", { preHandler: read }, async (req) => {
    const q = req.query as { status?: string; mine?: string };
    const status = q.status === "zavrsen" ? "zavrsen" : "aktivan";
    const uslovi = [eq(schema.zadaci.status, status)];

    let zadaciRows = await db
      .select({
        id: schema.zadaci.id,
        naziv: schema.zadaci.naziv,
        prioritet: schema.zadaci.prioritet,
        status: schema.zadaci.status,
        rok: schema.zadaci.rok,
        subjektId: schema.zadaci.subjektId,
        subjektNaziv: schema.subjects.naziv,
        dokumentId: schema.zadaci.dokumentId,
        dokumentBroj: schema.documents.broj,
        dokumentTip: schema.documents.tip,
        kreiraoId: schema.zadaci.kreiraoId,
        kreiraoIme: schema.users.fullName,
        zavrsenoAt: schema.zadaci.zavrsenoAt,
        createdAt: schema.zadaci.createdAt,
      })
      .from(schema.zadaci)
      .leftJoin(schema.subjects, eq(schema.zadaci.subjektId, schema.subjects.id))
      .leftJoin(schema.documents, eq(schema.zadaci.dokumentId, schema.documents.id))
      .innerJoin(schema.users, eq(schema.zadaci.kreiraoId, schema.users.id))
      .where(and(...uslovi))
      .orderBy(desc(schema.zadaci.createdAt));

    const ids = zadaciRows.map((z) => z.id);
    const izvrsioci = ids.length
      ? await db
          .select({
            zadatakId: schema.zadatakIzvrsioci.zadatakId,
            userId: schema.zadatakIzvrsioci.userId,
            ime: schema.users.fullName,
            status: schema.zadatakIzvrsioci.status,
          })
          .from(schema.zadatakIzvrsioci)
          .innerJoin(schema.users, eq(schema.zadatakIzvrsioci.userId, schema.users.id))
          .where(inArray(schema.zadatakIzvrsioci.zadatakId, ids))
      : [];

    const rezultat = zadaciRows.map((z) => {
      const svoji = izvrsioci.filter((i) => i.zadatakId === z.id);
      return {
        ...z,
        izvrsioci: svoji,
        // pozivnica na cekanju za tekuceg korisnika (inline Prihvati/Odbij u listi)
        mojaPozivnica: svoji.some((i) => i.userId === req.user!.id && i.status === "pozvan"),
      };
    });

    if (q.mine === "1") {
      return rezultat.filter(
        (z) => z.kreiraoId === req.user!.id || z.izvrsioci.some((i) => i.userId === req.user!.id),
      );
    }
    return rezultat;
  });

  // Detalj: header + opis + hronologija + izvrsioci + subjekat + dokument.
  app.get("/api/zadaci/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [z] = await db
      .select({
        id: schema.zadaci.id,
        naziv: schema.zadaci.naziv,
        opis: schema.zadaci.opis,
        prioritet: schema.zadaci.prioritet,
        status: schema.zadaci.status,
        rok: schema.zadaci.rok,
        subjektId: schema.zadaci.subjektId,
        subjektNaziv: schema.subjects.naziv,
        dokumentId: schema.zadaci.dokumentId,
        dokumentBroj: schema.documents.broj,
        dokumentTip: schema.documents.tip,
        kreiraoId: schema.zadaci.kreiraoId,
        kreiraoIme: schema.users.fullName,
        zavrsenoAt: schema.zadaci.zavrsenoAt,
        createdAt: schema.zadaci.createdAt,
      })
      .from(schema.zadaci)
      .leftJoin(schema.subjects, eq(schema.zadaci.subjektId, schema.subjects.id))
      .leftJoin(schema.documents, eq(schema.zadaci.dokumentId, schema.documents.id))
      .innerJoin(schema.users, eq(schema.zadaci.kreiraoId, schema.users.id))
      .where(eq(schema.zadaci.id, id));
    if (!z) return reply.code(404).send({ error: "Zadatak ne postoji" });

    const izvrsioci = await db
      .select({
        userId: schema.zadatakIzvrsioci.userId,
        ime: schema.users.fullName,
        status: schema.zadatakIzvrsioci.status,
        pozvaoId: schema.zadatakIzvrsioci.pozvaoId,
      })
      .from(schema.zadatakIzvrsioci)
      .innerJoin(schema.users, eq(schema.zadatakIzvrsioci.userId, schema.users.id))
      .where(eq(schema.zadatakIzvrsioci.zadatakId, id))
      .orderBy(asc(schema.zadatakIzvrsioci.createdAt));

    const hronologija = await db
      .select({
        id: schema.zadatakOpisi.id,
        tekst: schema.zadatakOpisi.tekst,
        autorId: schema.zadatakOpisi.autorId,
        autorIme: schema.users.fullName,
        createdAt: schema.zadatakOpisi.createdAt,
      })
      .from(schema.zadatakOpisi)
      .innerJoin(schema.users, eq(schema.zadatakOpisi.autorId, schema.users.id))
      .where(eq(schema.zadatakOpisi.zadatakId, id))
      .orderBy(asc(schema.zadatakOpisi.createdAt));

    return { ...z, izvrsioci, hronologija };
  });

  app.post("/api/zadaci", { preHandler: read }, async (req, reply) => {
    const parsed = zadatakSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const d = parsed.data;
    const [z] = await db
      .insert(schema.zadaci)
      .values({
        naziv: d.naziv,
        opis: d.opis,
        subjektId: d.subjektId ?? null,
        dokumentId: d.dokumentId ?? null,
        rok: d.rok ? new Date(d.rok) : null,
        prioritet: d.prioritet,
        kreiraoId: req.user!.id,
      })
      .returning();
    // izabrani izvrsioci = pozivnice (status pozvan); kreator ih poziva
    const pozvani = d.izvrsioci.filter((uid) => uid !== req.user!.id);
    if (pozvani.length > 0) {
      await db.insert(schema.zadatakIzvrsioci).values(
        pozvani.map((uid) => ({ zadatakId: z!.id, userId: uid, status: "pozvan", pozvaoId: req.user!.id })),
      );
      await obavesti(db, {
        userIds: pozvani,
        tip: "zadatak_poziv",
        naslov: `Pozvani ste na zadatak: ${z!.naziv}`,
        linkTip: "zadatak",
        linkId: z!.id,
        osim: req.user!.id,
      });
    }
    return reply.code(201).send(z);
  });

  // Izmena headera - samo kreator.
  app.put("/api/zadaci/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [z] = await db.select().from(schema.zadaci).where(eq(schema.zadaci.id, id));
    if (!z) return reply.code(404).send({ error: "Zadatak ne postoji" });
    if (z.kreiraoId !== req.user!.id) return reply.code(403).send({ error: "Samo kreator moze da menja zadatak" });
    const parsed = zadatakSchema
      .pick({ naziv: true, prioritet: true, subjektId: true, dokumentId: true, rok: true })
      .safeParse({ naziv: z.naziv, prioritet: z.prioritet, ...(req.body as object) });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const d = parsed.data;
    const [row] = await db
      .update(schema.zadaci)
      .set({
        naziv: d.naziv,
        prioritet: d.prioritet,
        subjektId: d.subjektId ?? null,
        dokumentId: d.dokumentId ?? null,
        rok: d.rok ? new Date(d.rok) : null,
      })
      .where(eq(schema.zadaci.id, id))
      .returning();
    return row;
  });

  // Izmena glavnog opisa - aktivni ucesnici (kreator + prihvatili).
  app.put("/api/zadaci/:id/opis", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!(await jeAktivan(id, req.user!.id))) return reply.code(403).send({ error: "Niste ucesnik zadatka" });
    const parsed = z.object({ opis: z.string().default("") }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const [row] = await db
      .update(schema.zadaci)
      .set({ opis: parsed.data.opis })
      .where(eq(schema.zadaci.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: "Zadatak ne postoji" });
    return row;
  });

  // Dodavanje stavke hronologije (append-only) - aktivni ucesnici.
  app.post("/api/zadaci/:id/opis", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!(await jeAktivan(id, req.user!.id))) return reply.code(403).send({ error: "Niste ucesnik zadatka" });
    const parsed = z.object({ tekst: z.string().min(1, "Tekst je obavezan") }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db
      .insert(schema.zadatakOpisi)
      .values({ zadatakId: id, tekst: parsed.data.tekst, autorId: req.user!.id })
      .returning();
    return reply.code(201).send(row);
  });

  // Poziv jos korisnika - kreator ili aktivni ucesnik.
  app.post("/api/zadaci/:id/pozovi", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!(await jeAktivan(id, req.user!.id))) return reply.code(403).send({ error: "Niste ucesnik zadatka" });
    const parsed = z.object({ userIds: z.array(z.number().int().positive()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    // preskoci vec upisane (unique index bi pukao)
    const postojeci = await db
      .select({ userId: schema.zadatakIzvrsioci.userId })
      .from(schema.zadatakIzvrsioci)
      .where(eq(schema.zadatakIzvrsioci.zadatakId, id));
    const set = new Set(postojeci.map((p) => p.userId));
    const novi = parsed.data.userIds.filter((uid) => !set.has(uid));
    if (novi.length > 0) {
      await db.insert(schema.zadatakIzvrsioci).values(
        novi.map((uid) => ({ zadatakId: id, userId: uid, status: "pozvan", pozvaoId: req.user!.id })),
      );
      const zag = await zaglavlje(id);
      await obavesti(db, {
        userIds: novi,
        tip: "zadatak_poziv",
        naslov: `Pozvani ste na zadatak: ${zag?.naziv ?? ""}`,
        linkTip: "zadatak",
        linkId: id,
        osim: req.user!.id,
      });
    }
    return { ok: true };
  });

  // Samopridruzivanje - bilo koji korisnik sa read pravom (odmah prihvatio).
  app.post("/api/zadaci/:id/pridruzi", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [z] = await db.select({ id: schema.zadaci.id }).from(schema.zadaci).where(eq(schema.zadaci.id, id));
    if (!z) return reply.code(404).send({ error: "Zadatak ne postoji" });
    await db
      .insert(schema.zadatakIzvrsioci)
      .values({ zadatakId: id, userId: req.user!.id, status: "prihvatio", respondedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.zadatakIzvrsioci.zadatakId, schema.zadatakIzvrsioci.userId],
        set: { status: "prihvatio", respondedAt: new Date() },
      });
    return { ok: true };
  });

  // Napustanje - brise svoj red.
  app.post("/api/zadaci/:id/napusti", { preHandler: read }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await db
      .delete(schema.zadatakIzvrsioci)
      .where(
        and(eq(schema.zadatakIzvrsioci.zadatakId, id), eq(schema.zadatakIzvrsioci.userId, req.user!.id)),
      );
    return { ok: true };
  });

  app.post("/api/zadaci/:id/prihvati", { preHandler: read }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await odgovoriNaPoziv(req, "prihvatio");
    const zag = await zaglavlje(id);
    if (zag && zag.kreiraoId !== req.user!.id) {
      await obavesti(db, {
        userIds: [zag.kreiraoId],
        tip: "zadatak_dogadjaj",
        naslov: `Prihvaćena pozivnica: ${zag.naziv}`,
        linkTip: "zadatak",
        linkId: id,
        osim: req.user!.id,
      });
    }
    return { ok: true };
  });

  app.post("/api/zadaci/:id/odbij", { preHandler: read }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await odgovoriNaPoziv(req, "odbio");
    const zag = await zaglavlje(id);
    if (zag && zag.kreiraoId !== req.user!.id) {
      await obavesti(db, {
        userIds: [zag.kreiraoId],
        tip: "zadatak_dogadjaj",
        naslov: `Odbijena pozivnica: ${zag.naziv}`,
        linkTip: "zadatak",
        linkId: id,
        osim: req.user!.id,
      });
    }
    return { ok: true };
  });

  async function odgovoriNaPoziv(req: FastifyRequest, status: "prihvatio" | "odbio") {
    const id = Number((req.params as { id: string }).id);
    await db
      .update(schema.zadatakIzvrsioci)
      .set({ status, respondedAt: new Date() })
      .where(
        and(
          eq(schema.zadatakIzvrsioci.zadatakId, id),
          eq(schema.zadatakIzvrsioci.userId, req.user!.id),
          eq(schema.zadatakIzvrsioci.status, "pozvan"),
        ),
      );
  }

  // Zavrsavanje - kreator ili aktivni (prihvatio) ucesnik.
  app.post("/api/zadaci/:id/zavrsi", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!(await jeAktivan(id, req.user!.id))) return reply.code(403).send({ error: "Niste ucesnik zadatka" });
    const [row] = await db
      .update(schema.zadaci)
      .set({ status: "zavrsen", zavrsioId: req.user!.id, zavrsenoAt: new Date() })
      .where(and(eq(schema.zadaci.id, id), eq(schema.zadaci.status, "aktivan")))
      .returning();
    if (!row) return reply.code(404).send({ error: "Zadatak ne postoji ili je vec zavrsen" });
    await obavesti(db, {
      userIds: await ucesnici(id),
      tip: "zadatak_dogadjaj",
      naslov: `Zadatak završen: ${row.naziv}`,
      linkTip: "zadatak",
      linkId: id,
      osim: req.user!.id,
    });
    return row;
  });
}
