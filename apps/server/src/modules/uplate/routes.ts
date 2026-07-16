import type { FastifyInstance, FastifyRequest } from "fastify";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";

const read = requirePrivilege("uplate", "read");
const write = requirePrivilege("uplate", "write");

const uplataSchema = z.object({
  klijentId: z.number().int().positive("Klijent je obavezan"),
  iznos: z.coerce.number().positive("Iznos mora biti veci od nule"),
  pozivNaBroj: z.string().min(1, "Poziv na broj je obavezan").max(50),
  datumUplate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Neispravan datum"),
  referent: z.string().max(100).default(""),
  avans: z.boolean().default(false),
  napomena: z.string().max(100, "Napomena moze imati najvise 100 karaktera").default(""),
});

// polja koja read korisnik sme da menja (RP7: ostala su zakljucana posle snimanja)
const READ_POLJA = ["referent", "avans", "napomena"] as const;

function imaWrite(req: FastifyRequest) {
  return req.user!.isAdmin || req.user!.privileges["uplate"] === "write";
}

// Uplate klijenata (faza 16, RP7)
export async function uplateRoutes(app: FastifyInstance) {
  app.get("/api/uplate", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.uplate.id,
        klijentId: schema.uplate.klijentId,
        klijentNaziv: schema.subjects.naziv,
        iznos: schema.uplate.iznos,
        pozivNaBroj: schema.uplate.pozivNaBroj,
        datumUplate: schema.uplate.datumUplate,
        referent: schema.uplate.referent,
        avans: schema.uplate.avans,
        napomena: schema.uplate.napomena,
        // za dvoklik na poziv na broj (otvaranje dokumenta u tabu)
        dokumentId: schema.documents.id,
        dokumentTip: schema.documents.tip,
      })
      .from(schema.uplate)
      .innerJoin(schema.subjects, eq(schema.uplate.klijentId, schema.subjects.id))
      .leftJoin(schema.documents, eq(schema.documents.broj, schema.uplate.pozivNaBroj))
      .orderBy(desc(schema.uplate.datumUplate), desc(schema.uplate.id));
  });

  // klijenti i referenti za autocomplete - pod uplate read guardom (korisnik
  // ne mora imati privilegiju na klijente/korisnike da bi unosio uplate)
  app.get("/api/uplate-klijenti", { preHandler: read }, async () => {
    const rows = await db
      .select({ id: schema.subjects.id, naziv: schema.subjects.naziv, pib: schema.subjects.pib, role: schema.subjects.role })
      .from(schema.subjects)
      .where(eq(schema.subjects.active, true))
      .orderBy(asc(schema.subjects.naziv));
    return rows.filter((s) => s.role === "klijent" || s.role === "oba");
  });

  app.get("/api/uplate-referenti", { preHandler: read }, async () => {
    return db
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.fullName));
  });

  app.post("/api/uplate", { preHandler: read }, async (req, reply) => {
    const parsed = uplataSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db
      .insert(schema.uplate)
      .values({ ...parsed.data, iznos: String(parsed.data.iznos), createdBy: req.user!.id })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/uplate/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [existing] = await db.select().from(schema.uplate).where(eq(schema.uplate.id, id));
    if (!existing) return reply.code(404).send({ error: "Uplata ne postoji" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    // read korisnik sme samo referent/avans/napomena (RP7)
    if (!imaWrite(req)) {
      const nedozvoljena = Object.keys(body).filter((k) => !READ_POLJA.includes(k as (typeof READ_POLJA)[number]));
      if (nedozvoljena.length > 0) {
        return reply.code(403).send({ error: "Nemate privilegiju za izmenu ovih polja" });
      }
    }
    const parsed = uplataSchema.safeParse({ ...existing, iznos: Number(existing.iznos), ...body });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db
      .update(schema.uplate)
      .set({ ...parsed.data, iznos: String(parsed.data.iznos), updatedAt: new Date() })
      .where(eq(schema.uplate.id, id))
      .returning();
    return row;
  });

  app.delete("/api/uplate/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const rows = await db.delete(schema.uplate).where(eq(schema.uplate.id, id)).returning();
    if (rows.length === 0) return reply.code(404).send({ error: "Uplata ne postoji" });
    return { ok: true };
  });

  app.post("/api/uplate-bulk-delete", { preHandler: write }, async (req, reply) => {
    const parsed = z.object({ ids: z.array(z.number().int()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    await db.delete(schema.uplate).where(inArray(schema.uplate.id, parsed.data.ids));
    return { ok: true };
  });

  // --- Import (RP7): parsiranje na klijentu (ImportSifarnika), server validira i pise ---
  const importBody = z.object({
    mode: z.enum(["novi", "azuriranje"]),
    dryRun: z.boolean(),
    rows: z.array(z.record(z.string(), z.string())).min(1),
  });

  app.post("/api/uplate-import", { preHandler: write }, async (req, reply) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    if (parsed.data.mode === "azuriranje") {
      return reply.code(400).send({ error: "Import uplata podrzava samo nove unose" });
    }
    const { dryRun, rows } = parsed.data;

    const klijenti = await db
      .select({ id: schema.subjects.id, naziv: schema.subjects.naziv, pib: schema.subjects.pib, role: schema.subjects.role })
      .from(schema.subjects);

    const rez = rows.map((_, index) => ({ index, status: "ok" as "ok" | "greska", napomena: "" }));
    const greska = (i: number, msg: string) => {
      rez[i]!.status = "greska";
      if (!rez[i]!.napomena) rez[i]!.napomena = msg;
    };

    type Kandidat = { i: number; data: z.infer<typeof uplataSchema> };
    const kandidati: Kandidat[] = [];
    rows.forEach((r, i) => {
      const klijentTekst = (r.klijent ?? "").trim();
      const hit = klijenti.find(
        (k) =>
          (k.role === "klijent" || k.role === "oba") &&
          (k.naziv.trim().toLowerCase() === klijentTekst.toLowerCase() || (k.pib && k.pib === klijentTekst)),
      );
      if (!hit) return greska(i, `Klijent "${klijentTekst}" ne postoji`);
      const broj = (r.pozivNaBroj ?? "").trim();
      // datum: ISO ili dd.mm.yyyy
      let datum = (r.datumUplate ?? "").trim();
      const m = datum.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
      if (m) datum = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
      const p = uplataSchema.safeParse({
        klijentId: hit.id,
        iznos: (r.iznos ?? "").trim(),
        pozivNaBroj: broj,
        datumUplate: datum,
        referent: (r.referent ?? "").trim(),
        avans: ["da", "avans", "true", "1"].includes((r.avans ?? "").trim().toLowerCase()),
        napomena: (r.napomena ?? "").trim(),
      });
      if (!p.success) return greska(i, p.error.issues[0]?.message ?? "Neispravni podaci");
      kandidati.push({ i, data: p.data });
    });

    const ok = rez.every((r) => r.status === "ok");
    if (dryRun || !ok) return { ok, rows: rez, created: [] };

    await db.transaction(async (tx) => {
      for (const k of kandidati) {
        await tx
          .insert(schema.uplate)
          .values({ ...k.data, iznos: String(k.data.iznos), createdBy: req.user!.id });
      }
    });
    return { ok: true, rows: rez, created: [] };
  });
}
