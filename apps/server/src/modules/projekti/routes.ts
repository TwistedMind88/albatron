import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";

const read = requirePrivilege("projekti", "read");
const write = requirePrivilege("projekti", "write");

// isti storage kao fajlovi artikala, poddirektorijum za projekte
const STORAGE = join(process.env.FILE_STORAGE ?? join(process.cwd(), "storage"), "projekti");

function safePath(stored: string): string {
  const full = resolve(join(STORAGE, stored));
  if (!full.startsWith(resolve(STORAGE) + sep)) throw new Error("Nedozvoljena putanja");
  return full;
}

const VRSTE = ["napomena", "referenca", "kontakt", "datum", "ucesnik", "komunikacija"] as const;

const projectSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan"),
  klijentId: z.number(),
  status: z.string().default("otvoren"),
  ocekivanja: z.string().default(""),
  planPocetak: z.string().nullable().default(null),
  planKraj: z.string().nullable().default(null),
});

const entrySchema = z.object({
  vrsta: z.enum(VRSTE),
  osoba: z.string().default(""),
  datum: z.string(), // ISO
  tekst: z.string().default(""),
});

function toRow(p: z.infer<typeof projectSchema>) {
  return {
    ...p,
    planPocetak: p.planPocetak ? new Date(p.planPocetak) : null,
    planKraj: p.planKraj ? new Date(p.planKraj) : null,
  };
}

// Projekti (brief 13): grupa dokumenata po klijentu + hronologija i komunikacija
export async function projektiRoutes(app: FastifyInstance) {
  app.get("/api/projekti", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.projects.id,
        naziv: schema.projects.naziv,
        status: schema.projects.status,
        planPocetak: schema.projects.planPocetak,
        planKraj: schema.projects.planKraj,
        klijentNaziv: schema.subjects.naziv,
        createdAt: schema.projects.createdAt,
      })
      .from(schema.projects)
      .innerJoin(schema.subjects, eq(schema.projects.klijentId, schema.subjects.id))
      .orderBy(desc(schema.projects.id));
  });

  app.get("/api/projekti/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!p) return reply.code(404).send({ error: "Projekat ne postoji" });
    const [klijent] = await db.select({ naziv: schema.subjects.naziv }).from(schema.subjects).where(eq(schema.subjects.id, p.klijentId));
    const dokumenti = await db
      .select({
        vezaId: schema.projectDocuments.id,
        id: schema.documents.id,
        tip: schema.documents.tip,
        broj: schema.documents.broj,
        datum: schema.documents.datum,
        status: schema.documents.status,
        klijentNaziv: schema.documents.klijentNaziv,
      })
      .from(schema.projectDocuments)
      .innerJoin(schema.documents, eq(schema.projectDocuments.documentId, schema.documents.id))
      .where(eq(schema.projectDocuments.projectId, id))
      .orderBy(asc(schema.documents.datum));
    const stavke = await db
      .select({
        id: schema.projectEntries.id,
        vrsta: schema.projectEntries.vrsta,
        osoba: schema.projectEntries.osoba,
        datum: schema.projectEntries.datum,
        tekst: schema.projectEntries.tekst,
        filename: schema.projectEntries.filename,
        strana: schema.projectEntries.strana,
        autor: schema.users.fullName,
      })
      .from(schema.projectEntries)
      .leftJoin(schema.users, eq(schema.projectEntries.userId, schema.users.id))
      .where(eq(schema.projectEntries.projectId, id))
      .orderBy(asc(schema.projectEntries.datum), asc(schema.projectEntries.id));
    return { ...p, klijentNaziv: klijent?.naziv ?? "", dokumenti, stavke };
  });

  app.post("/api/projekti", { preHandler: write }, async (req, reply) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [p] = await db
      .insert(schema.projects)
      .values({ ...toRow(parsed.data), userId: req.user?.id ?? null })
      .returning();
    return reply.code(201).send(p);
  });

  app.put("/api/projekti/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [p] = await db.update(schema.projects).set(toRow(parsed.data)).where(eq(schema.projects.id, id)).returning();
    if (!p) return reply.code(404).send({ error: "Projekat ne postoji" });
    return p;
  });

  // --- Pridruzivanje dokumenata ---

  app.post("/api/projekti/:id/dokumenti", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ documentId: z.number() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const postoji = await db
      .select({ id: schema.projectDocuments.id })
      .from(schema.projectDocuments)
      .where(and(eq(schema.projectDocuments.projectId, id), eq(schema.projectDocuments.documentId, parsed.data.documentId)));
    if (postoji.length) return reply.code(400).send({ error: "Dokument je već pridružen" });
    const [row] = await db
      .insert(schema.projectDocuments)
      .values({ projectId: id, documentId: parsed.data.documentId })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/projekti/:id/dokumenti/:vezaId", { preHandler: write }, async (req) => {
    const p = req.params as { id: string; vezaId: string };
    await db
      .delete(schema.projectDocuments)
      .where(and(eq(schema.projectDocuments.projectId, Number(p.id)), eq(schema.projectDocuments.id, Number(p.vezaId))));
    return { ok: true };
  });

  // --- Stavke hronologije (napomene, reference, kontakti, datumi, ucesnici, komunikacija) ---

  app.post("/api/projekti/:id/stavke", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db
      .insert(schema.projectEntries)
      .values({ ...parsed.data, projectId: id, datum: new Date(parsed.data.datum), userId: req.user?.id ?? null })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/projekti/stavke/:id", { preHandler: write }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.select().from(schema.projectEntries).where(eq(schema.projectEntries.id, id));
    if (row) {
      if (row.storedPath) {
        try { unlinkSync(safePath(row.storedPath)); } catch { /* vec obrisan */ }
      }
      await db.delete(schema.projectEntries).where(eq(schema.projectEntries.id, id));
    }
    return { ok: true };
  });

  // --- Attachmenti (klijenta i ponudjaca) - isti bezbednosni obrazac kao artikli ---

  app.post("/api/projekti/:id/fajlovi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { strana } = req.query as { strana?: string };
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Fajl nije poslat" });
    if (!existsSync(STORAGE)) mkdirSync(STORAGE, { recursive: true });
    const ext = extname(file.filename).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
    const stored = `${randomBytes(16).toString("hex")}${ext}`;
    await pipeline(file.file, createWriteStream(safePath(stored)));
    const [row] = await db
      .insert(schema.projectEntries)
      .values({
        projectId: id,
        vrsta: "attachment",
        filename: file.filename,
        storedPath: stored,
        strana: strana === "klijent" ? "klijent" : "ponudjac",
        userId: req.user?.id ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/api/projekti/fajlovi/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.select().from(schema.projectEntries).where(eq(schema.projectEntries.id, id));
    if (!row || !row.storedPath) return reply.code(404).send({ error: "Fajl ne postoji" });
    const { createReadStream } = await import("node:fs");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(row.filename)}"`);
    return reply.send(createReadStream(safePath(row.storedPath)));
  });
}
