import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";
import { logChanges } from "../artikli/service.js";

const read = requirePrivilege("cenovnici", "read");
const write = requirePrivilege("cenovnici", "write");

const importSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan"),
  dobavljacId: z.number(),
  valuta: z.string().min(1).default("EUR"),
  vaziOd: z.string(), // ISO datum
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        naziv: z.string().default(""),
        cena: z.number().nullable().default(null),
        opis: z.string().default(""),
        discontinued: z.boolean().default(false),
        napomena: z.string().max(400).default(""),
        custom: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1, "Cenovnik nema redova"),
});

export async function cenovniciRoutes(app: FastifyInstance) {
  app.get("/api/cenovnici", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.pricelists.id,
        naziv: schema.pricelists.naziv,
        dobavljacId: schema.pricelists.dobavljacId,
        dobavljac: schema.subjects.naziv,
        valuta: schema.pricelists.valuta,
        vaziOd: schema.pricelists.vaziOd,
        createdAt: schema.pricelists.createdAt,
        brojStavki: sql<number>`(select count(*) from ${schema.pricelistItems} where ${schema.pricelistItems.pricelistId} = ${schema.pricelists.id})::int`,
      })
      .from(schema.pricelists)
      .innerJoin(schema.subjects, eq(schema.pricelists.dobavljacId, schema.subjects.id))
      .orderBy(desc(schema.pricelists.vaziOd));
  });

  app.post("/api/cenovnici", { preHandler: write }, async (req, reply) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const d = parsed.data;
    const [cenovnik] = await db
      .insert(schema.pricelists)
      .values({ naziv: d.naziv, dobavljacId: d.dobavljacId, valuta: d.valuta, vaziOd: new Date(d.vaziOd) })
      .returning();
    await db.insert(schema.pricelistItems).values(
      d.items.map((i) => ({
        pricelistId: cenovnik!.id,
        sku: i.sku,
        naziv: i.naziv,
        cena: i.cena?.toString() ?? null,
        opis: i.opis,
        discontinued: i.discontinued,
        napomena: i.napomena,
        custom: i.custom && Object.keys(i.custom).length > 0 ? i.custom : null,
      })),
    );
    return reply.code(201).send({ ...cenovnik, brojStavki: d.items.length });
  });

  // Stavke + status: da li je artikal (dobavljac+SKU) unet u program (brief 6)
  app.get("/api/cenovnici/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cenovnik] = await db.select().from(schema.pricelists).where(eq(schema.pricelists.id, id));
    if (!cenovnik) return reply.code(404).send({ error: "Cenovnik ne postoji" });
    const items = await db
      .select()
      .from(schema.pricelistItems)
      .where(eq(schema.pricelistItems.pricelistId, id))
      .orderBy(asc(schema.pricelistItems.sku));
    const artikli = await db
      .select({ sku: schema.articles.sku, id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.dobavljacId, cenovnik.dobavljacId));
    const skuMap = new Map(artikli.map((a) => [a.sku, a.id]));
    return {
      ...cenovnik,
      items: items.map((i) => ({ ...i, artikalId: skuMap.get(i.sku) ?? null })),
    };
  });

  // Istorija cene jednog SKU kroz sve verzije cenovnika (brief 6)
  app.get("/api/cenovnici-sku/:sku", { preHandler: read }, async (req) => {
    const sku = (req.params as { sku: string }).sku;
    return db
      .select({
        cenovnik: schema.pricelists.naziv,
        dobavljac: schema.subjects.naziv,
        valuta: schema.pricelists.valuta,
        vaziOd: schema.pricelists.vaziOd,
        sku: schema.pricelistItems.sku,
        naziv: schema.pricelistItems.naziv,
        cena: schema.pricelistItems.cena,
      })
      .from(schema.pricelistItems)
      .innerJoin(schema.pricelists, eq(schema.pricelistItems.pricelistId, schema.pricelists.id))
      .innerJoin(schema.subjects, eq(schema.pricelists.dobavljacId, schema.subjects.id))
      .where(eq(schema.pricelistItems.sku, sku))
      .orderBy(desc(schema.pricelists.vaziOd));
  });

  // "Pronadji cenu" pri kreiranju artikla (brief 6): najnovija cena za dobavljac+SKU
  app.get("/api/cenovnici-cena", { preHandler: read }, async (req, reply) => {
    const { dobavljacId, sku } = req.query as { dobavljacId?: string; sku?: string };
    if (!dobavljacId || !sku) return reply.code(400).send({ error: "dobavljacId i sku su obavezni" });
    const rows = await db
      .select({
        cena: schema.pricelistItems.cena,
        valuta: schema.pricelists.valuta,
        cenovnik: schema.pricelists.naziv,
        vaziOd: schema.pricelists.vaziOd,
      })
      .from(schema.pricelistItems)
      .innerJoin(schema.pricelists, eq(schema.pricelistItems.pricelistId, schema.pricelists.id))
      .where(
        and(eq(schema.pricelists.dobavljacId, Number(dobavljacId)), eq(schema.pricelistItems.sku, sku)),
      )
      .orderBy(desc(schema.pricelists.vaziOd))
      .limit(1);
    return rows[0] ?? null;
  });

  // "Azuriraj cene na osnovu ovog cenovnika" (brief 6)
  app.post("/api/cenovnici/:id/azuriraj-cene", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cenovnik] = await db.select().from(schema.pricelists).where(eq(schema.pricelists.id, id));
    if (!cenovnik) return reply.code(404).send({ error: "Cenovnik ne postoji" });
    const items = await db
      .select()
      .from(schema.pricelistItems)
      .where(eq(schema.pricelistItems.pricelistId, id));
    const artikli = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.dobavljacId, cenovnik.dobavljacId));
    const cenaBySku = new Map(items.filter((i) => i.cena !== null).map((i) => [i.sku, i.cena!]));

    let updated = 0;
    for (const a of artikli) {
      const novaCena = cenaBySku.get(a.sku);
      if (novaCena === undefined || a.dobavljacevaCena === novaCena) continue;
      const [after] = await db
        .update(schema.articles)
        .set({ dobavljacevaCena: novaCena, dobavljacevaValuta: cenovnik.valuta })
        .where(eq(schema.articles.id, a.id))
        .returning();
      await logChanges("artikal", a.id, a, after!, req.user?.id ?? null);
      updated++;
    }
    return { updated };
  });

  // Provera discontinued (brief 6): artikli dobavljaca kojih nema u cenovniku
  app.get("/api/cenovnici/:id/discontinued", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cenovnik] = await db.select().from(schema.pricelists).where(eq(schema.pricelists.id, id));
    if (!cenovnik) return reply.code(404).send({ error: "Cenovnik ne postoji" });
    const items = await db
      .select({ sku: schema.pricelistItems.sku })
      .from(schema.pricelistItems)
      .where(eq(schema.pricelistItems.pricelistId, id));
    const uCenovniku = new Set(items.map((i) => i.sku));
    const artikli = await db
      .select({ id: schema.articles.id, ident: schema.articles.ident, naziv: schema.articles.naziv, sku: schema.articles.sku, discontinued: schema.articles.discontinued })
      .from(schema.articles)
      .where(and(eq(schema.articles.dobavljacId, cenovnik.dobavljacId), eq(schema.articles.discontinued, false)));
    return artikli.filter((a) => a.sku && !uCenovniku.has(a.sku));
  });

  // Novi discontinued (brief 14.5): aktivni artikli koji su u ovom cenovniku oznaceni discontinued
  app.get("/api/cenovnici/:id/novi-discontinued", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cenovnik] = await db.select().from(schema.pricelists).where(eq(schema.pricelists.id, id));
    if (!cenovnik) return reply.code(404).send({ error: "Cenovnik ne postoji" });
    const items = await db
      .select({ sku: schema.pricelistItems.sku })
      .from(schema.pricelistItems)
      .where(and(eq(schema.pricelistItems.pricelistId, id), eq(schema.pricelistItems.discontinued, true)));
    const discSku = new Set(items.map((i) => i.sku));
    if (!discSku.size) return [];
    const artikli = await db
      .select({ id: schema.articles.id, ident: schema.articles.ident, naziv: schema.articles.naziv, sku: schema.articles.sku, discontinued: schema.articles.discontinued })
      .from(schema.articles)
      .where(
        and(
          eq(schema.articles.dobavljacId, cenovnik.dobavljacId),
          eq(schema.articles.discontinued, false),
          eq(schema.articles.active, true),
        ),
      );
    return artikli.filter((a) => a.sku && discSku.has(a.sku));
  });

  app.post("/api/artikli-discontinued", { preHandler: write }, async (req, reply) => {
    const parsed = z.object({ ids: z.array(z.number()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    await db
      .update(schema.articles)
      .set({ discontinued: true })
      .where(inArray(schema.articles.id, parsed.data.ids));
    return { ok: true, oznaceno: parsed.data.ids.length };
  });
}
