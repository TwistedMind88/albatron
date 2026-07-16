import type { FastifyInstance } from "fastify";
import { partialUpdate } from "@albatron/shared";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";

const read = requirePrivilege("podesavanja", "read");
const write = requirePrivilege("podesavanja", "write");

const categorySchema = z.object({
  name: z.string().min(1),
  parentId: z.number().nullable().default(null),
  porezId: z.number().nullable().default(null),
  carina: z.number().nullable().default(null),
});

// znacajan deo koda: slovo + parovi cifara bez trailing "00" parova (A01000000 -> "A01")
function sig(code: string): string {
  let s = code;
  while (s.length > 1 && s.endsWith("00")) s = s.slice(0, -2);
  return s;
}

// sledeci slobodan kod pod datim parentom (null = glavna, slovo A-Z)
async function sledeciKod(parentId: number | null): Promise<string | { error: string }> {
  const braca = parentId === null
    ? await db.select({ code: schema.categories.code }).from(schema.categories).where(isNull(schema.categories.parentId))
    : await db.select({ code: schema.categories.code }).from(schema.categories).where(eq(schema.categories.parentId, parentId));
  const zauzeti = new Set(braca.map((b) => (b.code ? sig(b.code) : "")));
  if (parentId === null) {
    for (let i = 0; i < 26; i++) {
      const slovo = String.fromCharCode(65 + i);
      if (!zauzeti.has(slovo)) return slovo.padEnd(9, "0");
    }
    return { error: "Maksimalno 26 glavnih kategorija (A-Z)" };
  }
  const [parent] = await db.select({ code: schema.categories.code }).from(schema.categories).where(eq(schema.categories.id, parentId));
  if (!parent?.code) return { error: "Nadkategorija nema sifru" };
  const prefix = sig(parent.code);
  if (prefix.length >= 9) return { error: "Maksimalno 4 nivoa podkategorija" };
  for (let i = 1; i <= 99; i++) {
    const kod = prefix + String(i).padStart(2, "0");
    if (!zauzeti.has(kod)) return kod.padEnd(9, "0");
  }
  return { error: "Maksimalno 99 podkategorija po nivou" };
}

// pri premestanju: dodeli nov kod cvoru pod novim parentom i prepisi prefiks celom podstablu
async function premestiKod(id: number, newParentId: number | null): Promise<string | null> {
  const [row] = await db.select({ code: schema.categories.code }).from(schema.categories).where(eq(schema.categories.id, id));
  const nov = await sledeciKod(newParentId);
  if (typeof nov !== "string") return nov.error;
  await db.update(schema.categories).set({ code: nov }).where(eq(schema.categories.id, id));
  const stariSig = row?.code ? sig(row.code) : null;
  if (stariSig) await prepisiPodstablo(id, stariSig, sig(nov));
  return null;
}

async function prepisiPodstablo(parentId: number, stariPrefix: string, noviPrefix: string) {
  const deca = await db
    .select({ id: schema.categories.id, code: schema.categories.code })
    .from(schema.categories)
    .where(eq(schema.categories.parentId, parentId));
  for (const d of deca) {
    if (d.code?.startsWith(stariPrefix)) {
      const nov = (noviPrefix + sig(d.code).slice(stariPrefix.length)).padEnd(9, "0");
      if (nov.length > 9) continue; // premestanje u dublji nivo bi probilo max dubinu - kod ostaje, admin resava rucno
      await db.update(schema.categories).set({ code: nov }).where(eq(schema.categories.id, d.id));
    }
    await prepisiPodstablo(d.id, stariPrefix, noviPrefix);
  }
}

export async function kategorijeRoutes(app: FastifyInstance) {
  app.get("/api/kategorije", { preHandler: read }, async () => {
    return db
      .select()
      .from(schema.categories)
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
  });

  app.post("/api/kategorije", { preHandler: write }, async (req, reply) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const kod = await sledeciKod(parsed.data.parentId);
    if (typeof kod !== "string") return reply.code(400).send({ error: kod.error });
    const [row] = await db
      .insert(schema.categories)
      .values({ ...parsed.data, code: kod, carina: parsed.data.carina?.toString() ?? null })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/kategorije/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = partialUpdate(categorySchema).extend({ sortOrder: z.number().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
      if (await wouldCycle(id, parsed.data.parentId)) {
        return reply.code(400).send({ error: "Kategorija ne moze biti pod sopstvenom potkategorijom" });
      }
    }
    const d = parsed.data;
    const [pre] = await db
      .select({ parentId: schema.categories.parentId })
      .from(schema.categories)
      .where(eq(schema.categories.id, id));
    if (!pre) return reply.code(404).send({ error: "Kategorija ne postoji" });
    const [row] = await db
      .update(schema.categories)
      .set({ ...d, carina: d.carina !== undefined ? (d.carina?.toString() ?? null) : undefined })
      .where(eq(schema.categories.id, id))
      .returning();
    if (d.parentId !== undefined && d.parentId !== pre.parentId) {
      const err = await premestiKod(id, d.parentId);
      if (err) return reply.code(400).send({ error: err });
    }
    return row;
  });

  app.delete("/api/kategorije/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const children = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.parentId, id));
    if (children.length > 0) {
      return reply.code(400).send({ error: "Kategorija ima potkategorije - prvo ih premestite ili obrisite" });
    }
    await db.delete(schema.categories).where(eq(schema.categories.id, id));
    return { ok: true };
  });

  // Bulk premestanje vise kategorija pod novog parenta (brief 5.3)
  app.put("/api/kategorije-premesti", { preHandler: write }, async (req, reply) => {
    const parsed = z
      .object({ ids: z.array(z.number()).min(1), parentId: z.number().nullable() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const { ids, parentId } = parsed.data;
    if (parentId !== null) {
      if (ids.includes(parentId)) return reply.code(400).send({ error: "Kategorija ne moze pod samu sebe" });
      for (const id of ids) {
        if (await wouldCycle(id, parentId)) {
          return reply.code(400).send({ error: "Premestanje bi napravilo ciklus u stablu" });
        }
      }
    }
    for (const id of ids) {
      const [pre] = await db
        .select({ parentId: schema.categories.parentId })
        .from(schema.categories)
        .where(eq(schema.categories.id, id));
      if (!pre || pre.parentId === parentId) continue;
      await db.update(schema.categories).set({ parentId }).where(eq(schema.categories.id, id));
      const err = await premestiKod(id, parentId);
      if (err) return reply.code(400).send({ error: err });
    }
    return { ok: true };
  });

  // Redosled unutar nivoa: niz id-jeva u zeljenom redosledu
  app.put("/api/kategorije-redosled", { preHandler: write }, async (req, reply) => {
    const parsed = z.object({ ids: z.array(z.number()) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    for (let i = 0; i < parsed.data.ids.length; i++) {
      await db
        .update(schema.categories)
        .set({ sortOrder: i })
        .where(eq(schema.categories.id, parsed.data.ids[i]!));
    }
    return { ok: true };
  });
}

// da li bi postavljanje newParentId kao parenta od id napravilo ciklus
async function wouldCycle(id: number, newParentId: number): Promise<boolean> {
  if (id === newParentId) return true;
  let current: number | null = newParentId;
  while (current !== null) {
    if (current === id) return true;
    const rows: { parentId: number | null }[] = await db
      .select({ parentId: schema.categories.parentId })
      .from(schema.categories)
      .where(eq(schema.categories.id, current));
    const row = rows[0];
    current = row?.parentId ?? null;
  }
  return false;
}
