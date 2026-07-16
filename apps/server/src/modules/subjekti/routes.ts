import type { FastifyInstance } from "fastify";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { contactSchema, partialUpdate, subjectSchema } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requireAnyPrivilege } from "../auth/guard.js";

const read = requireAnyPrivilege(["klijenti", "dobavljaci"], "read");
const write = requireAnyPrivilege(["klijenti", "dobavljaci"], "write");

export async function subjektiRoutes(app: FastifyInstance) {
  app.get("/api/subjekti", { preHandler: read }, async (req) => {
    const { uloga } = req.query as { uloga?: string };
    const rows = await db.select().from(schema.subjects).orderBy(asc(schema.subjects.naziv));
    // klijent vidi 'klijent' i 'oba'; dobavljac vidi 'dobavljac' i 'oba'
    if (uloga === "klijent" || uloga === "dobavljac") {
      return rows.filter((s) => s.role === uloga || s.role === "oba");
    }
    return rows;
  });

  app.get("/api/subjekti/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const subject = (await db.select().from(schema.subjects).where(eq(schema.subjects.id, id)))[0];
    if (!subject) return reply.code(404).send({ error: "Subjekat ne postoji" });
    const kontakti = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.subjectId, id))
      .orderBy(asc(schema.contacts.id));
    return { ...subject, kontakti };
  });

  app.post("/api/subjekti", { preHandler: write }, async (req, reply) => {
    const parsed = subjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db.insert(schema.subjects).values(parsed.data).returning();
    return reply.code(201).send(row);
  });

  app.put("/api/subjekti/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = (await db.select().from(schema.subjects).where(eq(schema.subjects.id, id)))[0];
    if (!existing) return reply.code(404).send({ error: "Subjekat ne postoji" });
    // partial update se validira nad spojenim stanjem (da PIB pravilo uvek vazi)
    const merged = { ...existing, ...(req.body as object) };
    const parsed = subjectSchema.safeParse(merged);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db
      .update(schema.subjects)
      .set(parsed.data)
      .where(eq(schema.subjects.id, id))
      .returning();
    return row;
  });

  // --- Kontakt osobe ---

  app.post("/api/subjekti/:id/kontakti", { preHandler: write }, async (req, reply) => {
    const subjectId = Number((req.params as { id: string }).id);
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    if (parsed.data.isDefault) await clearDefaultContact(subjectId);
    const [row] = await db
      .insert(schema.contacts)
      .values({ ...parsed.data, subjectId })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/kontakti/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = (await db.select().from(schema.contacts).where(eq(schema.contacts.id, id)))[0];
    if (!existing) return reply.code(404).send({ error: "Kontakt ne postoji" });
    const parsed = partialUpdate(contactSchema).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    if (parsed.data.isDefault) await clearDefaultContact(existing.subjectId, id);
    const [row] = await db
      .update(schema.contacts)
      .set(parsed.data)
      .where(eq(schema.contacts.id, id))
      .returning();
    return row;
  });

  // --- Import + masovno azuriranje (faza 15, RP4) ---
  // Parsiranje fajla je na klijentu; redovi stizu kao mape polje -> string.
  // Kljuc za azuriranje bira korisnik (kljucKolona); prazna celija ne dira polje.

  const importBody = z.object({
    uloga: z.enum(["klijent", "dobavljac"]),
    mode: z.enum(["novi", "azuriranje"]),
    kljucKolona: z.enum(["naziv", "puniNaziv", "pib", "mb"]).optional(),
    dryRun: z.boolean(),
    rows: z.array(z.record(z.string(), z.string())).min(1),
  });

  const IMPORT_POLJA = ["naziv", "puniNaziv", "adresa", "postanskiBroj", "grad", "pib", "mb", "drzava", "valuta"] as const;

  app.post("/api/subjekti-import", { preHandler: write }, async (req, reply) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const { uloga, mode, kljucKolona, dryRun, rows } = parsed.data;
    if (mode === "azuriranje" && !kljucKolona) {
      return reply.code(400).send({ error: "Izaberite kljuc-kolonu za azuriranje" });
    }

    const svi = await db.select().from(schema.subjects);
    const rez = rows.map((_, index) => ({ index, status: "ok" as "ok" | "greska", napomena: "" }));
    const greska = (i: number, msg: string) => {
      rez[i]!.status = "greska";
      if (!rez[i]!.napomena) rez[i]!.napomena = msg;
    };

    // duplikat kljuca unutar fajla = greska oba reda
    if (mode === "azuriranje") {
      const videno = new Map<string, number>();
      rows.forEach((r, i) => {
        const kljuc = (r[kljucKolona!] ?? "").trim().toLowerCase();
        if (!kljuc) return;
        const prvi = videno.get(kljuc);
        if (prvi !== undefined) {
          greska(prvi, `Vrednost "${r[kljucKolona!]}" se ponavlja u fajlu`);
          greska(i, `Vrednost "${r[kljucKolona!]}" se ponavlja u fajlu`);
        } else videno.set(kljuc, i);
      });
    }

    type Kandidat = { i: number; data: z.infer<typeof subjectSchema>; existing?: (typeof svi)[number] };
    const kandidati: Kandidat[] = [];
    rows.forEach((r, i) => {
      if (rez[i]!.status === "greska") return;
      const obj: Record<string, unknown> = {};
      for (const f of IMPORT_POLJA) {
        const v = (r[f] ?? "").trim();
        if (v) obj[f] = v;
      }
      if (mode === "novi") {
        const p = subjectSchema.safeParse({ role: uloga, ...obj });
        if (!p.success) return greska(i, p.error.issues[0]?.message ?? "Neispravni podaci");
        kandidati.push({ i, data: p.data });
      } else {
        const kljuc = (r[kljucKolona!] ?? "").trim();
        if (!kljuc) return greska(i, `Kolona ${kljucKolona} (kljuc) je obavezna`);
        const hits = svi.filter(
          (s) => String(s[kljucKolona!] ?? "").trim().toLowerCase() === kljuc.toLowerCase(),
        );
        if (hits.length === 0) return greska(i, `Subjekat sa ${kljucKolona} "${kljuc}" ne postoji`);
        if (hits.length > 1) return greska(i, `Vise subjekata ima ${kljucKolona} "${kljuc}"`);
        const p = subjectSchema.safeParse({ ...hits[0]!, ...obj });
        if (!p.success) return greska(i, p.error.issues[0]?.message ?? "Neispravni podaci");
        kandidati.push({ i, data: p.data, existing: hits[0]! });
      }
    });

    const ok = rez.every((r) => r.status === "ok");
    if (dryRun || !ok) return { ok, rows: rez, created: [] };

    const created: { naziv: string; pib: string }[] = [];
    await db.transaction(async (tx) => {
      for (const k of kandidati) {
        if (mode === "novi") {
          const [row] = await tx.insert(schema.subjects).values(k.data).returning();
          created.push({ naziv: row!.naziv, pib: row!.pib });
        } else {
          await tx.update(schema.subjects).set(k.data).where(eq(schema.subjects.id, k.existing!.id));
        }
      }
    });
    return { ok: true, rows: rez, created };
  });
}

async function clearDefaultContact(subjectId: number, exceptId?: number) {
  const conditions = [eq(schema.contacts.subjectId, subjectId)];
  if (exceptId !== undefined) conditions.push(ne(schema.contacts.id, exceptId));
  await db
    .update(schema.contacts)
    .set({ isDefault: false })
    .where(and(...conditions));
}
