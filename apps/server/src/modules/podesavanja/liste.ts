import type { FastifyInstance } from "fastify";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { DOC_TYPES, LOOKUP_KINDS, partialUpdate, validirajFormat } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";

const lookupSchema = z.object({
  // dozvoljene vrste izvedene iz shared LOOKUP_KINDS (izbegava drift)
  kind: z.enum(LOOKUP_KINDS.map((k) => k.id) as [string, ...string[]]),
  docType: z.string().nullable().default(null),
  internalValue: z.string().min(1),
  externalValue: z.string().default(""),
  rate: z.number().nullable().default(null),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

const read = requirePrivilege("podesavanja", "read");
const write = requirePrivilege("podesavanja", "write");

export async function listeRoutes(app: FastifyInstance) {
  app.get("/api/liste", { preHandler: read }, async () => {
    return db
      .select()
      .from(schema.lookups)
      .orderBy(asc(schema.lookups.kind), asc(schema.lookups.sortOrder), asc(schema.lookups.id));
  });

  app.post("/api/liste", { preHandler: write }, async (req, reply) => {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const d = parsed.data;
    if (d.isDefault) await clearDefault(d.kind, d.docType);
    const [row] = await db
      .insert(schema.lookups)
      .values({ ...d, rate: d.rate?.toString() ?? null })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/liste/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = partialUpdate(lookupSchema).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const existing = (await db.select().from(schema.lookups).where(eq(schema.lookups.id, id)))[0];
    if (!existing) return reply.code(404).send({ error: "Stavka ne postoji" });
    const d = parsed.data;
    if (d.isDefault) await clearDefault(existing.kind, existing.docType, id);
    const [row] = await db
      .update(schema.lookups)
      .set({ ...d, rate: d.rate !== undefined ? (d.rate?.toString() ?? null) : undefined })
      .where(eq(schema.lookups.id, id))
      .returning();
    return row;
  });

  app.delete("/api/liste/:id", { preHandler: write }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await db.delete(schema.lookups).where(eq(schema.lookups.id, id));
    return { ok: true };
  });

  // Promena redosleda: niz id-jeva u zeljenom redosledu
  app.put("/api/liste-redosled", { preHandler: write }, async (req, reply) => {
    const parsed = z.object({ ids: z.array(z.number()) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    for (let i = 0; i < parsed.data.ids.length; i++) {
      await db
        .update(schema.lookups)
        .set({ sortOrder: i })
        .where(eq(schema.lookups.id, parsed.data.ids[i]!));
    }
    return { ok: true };
  });

  // Bulk import carinskih tarifa (faza 16, RP4): upsert po sifri (internalValue).
  // Postojeca sifra = update naziva/stope, nova = insert. dryRun samo broji.
  app.post("/api/liste-import", { preHandler: write }, async (req, reply) => {
    const kind = (req.query as { kind?: string }).kind;
    if (kind !== "carinska_tarifa") return reply.code(400).send({ error: "Podržan je samo kind=carinska_tarifa" });
    const parsed = z
      .object({
        dryRun: z.boolean().default(false),
        rows: z.array(
          z.object({
            sifra: z.string().min(1),
            naziv: z.string().default(""),
            stopa: z.number().nullable().default(null),
          }),
        ),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });

    const postojece = await db.select().from(schema.lookups).where(eq(schema.lookups.kind, kind));
    const poSifri = new Map(postojece.map((l) => [l.internalValue, l]));
    // duplikat sifre u fajlu: poslednji red pobedjuje
    const redovi = [...new Map(parsed.data.rows.map((r) => [r.sifra, r])).values()];
    let novi = 0;
    let azurirani = 0;
    await db.transaction(async (tx) => {
      for (const r of redovi) {
        const rate = r.stopa?.toString() ?? null;
        const postojeci = poSifri.get(r.sifra);
        if (postojeci) {
          azurirani++;
          if (!parsed.data.dryRun)
            await tx
              .update(schema.lookups)
              .set({ externalValue: r.naziv, rate })
              .where(eq(schema.lookups.id, postojeci.id));
        } else {
          novi++;
          if (!parsed.data.dryRun)
            await tx
              .insert(schema.lookups)
              .values({ kind, docType: null, internalValue: r.sifra, externalValue: r.naziv, rate });
        }
      }
    });
    return { ok: true, dryRun: parsed.data.dryRun, novi, azurirani };
  });

  // --- Podrazumevani izbori za dokumente (brief 11.4) ---

  app.get("/api/podrazumevani-izbori", { preHandler: read }, async () => {
    const row = (
      await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "document_defaults"))
    )[0];
    return row?.value ?? {};
  });

  app.put("/api/podrazumevani-izbori", { preHandler: write }, async (req) => {
    const value = req.body ?? {};
    await db
      .insert(schema.appSettings)
      .values({ key: "document_defaults", value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return value;
  });

  // --- Numeracija dokumenata (brief 14.2): format po tipu, prazno = default ---

  app.get("/api/numeracija", { preHandler: read }, async () => {
    const row = (
      await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "numeracija"))
    )[0];
    return row?.value ?? {};
  });

  app.put("/api/numeracija", { preHandler: write }, async (req, reply) => {
    const parsed = z.record(z.string(), z.string()).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const value: Record<string, string> = {};
    for (const [tip, format] of Object.entries(parsed.data)) {
      if (!DOC_TYPES.some((d) => d.id === tip)) return reply.code(400).send({ error: `Nepoznat tip: ${tip}` });
      if (!format.trim()) continue; // prazno = koristi default
      const greska = validirajFormat(format);
      if (greska) return reply.code(400).send({ error: `${tip}: ${greska}` });
      value[tip] = format;
    }
    await db
      .insert(schema.appSettings)
      .values({ key: "numeracija", value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return value;
  });
}

async function clearDefault(kind: string, docType: string | null, exceptId?: number) {
  const conditions = [eq(schema.lookups.kind, kind)];
  if (docType !== null) conditions.push(eq(schema.lookups.docType, docType));
  if (exceptId !== undefined) conditions.push(ne(schema.lookups.id, exceptId));
  await db
    .update(schema.lookups)
    .set({ isDefault: false })
    .where(and(...conditions));
}
