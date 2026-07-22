import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import fs from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { db, schema } from "../../db/index.js";
import { requireAdmin, requirePrivilege } from "../auth/guard.js";
import { imapKlijent } from "../dashboard/imap.js";

const labeledValue = z.object({ label: z.string(), value: z.string() });

const companyProfileSchema = z.object({
  name: z.string().default(""),
  address: z.string().default(""),
  pib: z.string().default(""),
  maticniBroj: z.string().default(""),
  bankAccounts: z.array(labeledValue).default([]),
  phones: z.array(labeledValue).default([]),
  emails: z.array(labeledValue).default([]),
});

const smtpSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  pass: z.string(),
  fromName: z.string(),
  fromEmail: z.string(),
  // mail prozor (brief 7.8): BCC kopija i default body template sa {placeholder} poljima
  bcc: z.string().default(""),
  bodyTemplate: z.string().default(""),
});

// IMAP citanje pošte po korisniku (plan 20, faza 7) - ogledalo smtp kolone.
const imapSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  pass: z.string(),
  folder: z.string().default("INBOX"),
});

export async function podesavanjaRoutes(app: FastifyInstance) {
  // --- Profil firme ---

  app.get(
    "/api/profil-firme",
    { preHandler: requirePrivilege("podesavanja", "read") },
    async () => {
      const rows = await db.select().from(schema.companyProfile);
      return rows[0] ?? null;
    },
  );

  app.put(
    "/api/profil-firme",
    { preHandler: requirePrivilege("podesavanja", "write") },
    async (req, reply) => {
      const parsed = companyProfileSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
      const rows = await db.select().from(schema.companyProfile);
      const existing = rows[0];
      if (existing) {
        const [updated] = await db
          .update(schema.companyProfile)
          .set(parsed.data)
          .where(eq(schema.companyProfile.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db.insert(schema.companyProfile).values(parsed.data).returning();
      return created;
    },
  );

  // --- Moj profil (SMTP po korisniku, brief 10) ---

  app.get("/api/moj-profil", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const rows = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        smtp: schema.users.smtp,
        imap: schema.users.imap,
        sidebarLayout: schema.users.sidebarLayout,
        uiPrefs: schema.users.uiPrefs,
        dashboardLayout: schema.users.dashboardLayout,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.user.id));
    return rows[0];
  });

  app.put("/api/moj-profil", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const parsed = z
      .object({
        fullName: z.string().min(1).optional(),
        smtp: smtpSchema.nullable().optional(),
        imap: imapSchema.nullable().optional(),
        sidebarLayout: z.unknown().optional(),
        uiPrefs: z.unknown().optional(),
        dashboardLayout: z.unknown().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const [updated] = await db
      .update(schema.users)
      .set(parsed.data)
      .where(eq(schema.users.id, req.user.id))
      .returning({
        id: schema.users.id,
        fullName: schema.users.fullName,
        smtp: schema.users.smtp,
        imap: schema.users.imap,
        sidebarLayout: schema.users.sidebarLayout,
        uiPrefs: schema.users.uiPrefs,
        dashboardLayout: schema.users.dashboardLayout,
      });
    return updated;
  });

  // Test SMTP podesavanja slanjem probne poruke na fromEmail (faza 15, RP1.5)
  app.post("/api/moj-profil/smtp-test", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const parsed = smtpSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const smtp = parsed.data;
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
    });
    try {
      await transporter.sendMail({
        from: smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail,
        to: smtp.fromEmail,
        subject: "Albatron - test SMTP podesavanja",
        text: "Ako vidite ovu poruku, SMTP podesavanja rade.",
      });
    } catch (err) {
      return reply.code(400).send({ error: `Slanje nije uspelo: ${(err as Error).message}` });
    }
    return { ok: true };
  });

  // Test IMAP podesavanja: konekcija + prijava dokazuju kredencijale (plan 20, faza 7)
  app.post("/api/moj-profil/imap-test", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const parsed = imapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const client = imapKlijent(parsed.data);
    try {
      await client.connect();
    } catch (err) {
      return reply.code(400).send({ error: `Prijava nije uspela: ${(err as Error).message}` });
    } finally {
      await client.logout().catch(() => {});
    }
    return { ok: true };
  });

  // --- Automatsko azuriranje servera (cron u 3h cita ovaj flag iz baze) ---

  app.get("/api/podesavanja/auto-update", { preHandler: requireAdmin }, async () => {
    const row = (
      await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "auto_update"))
    )[0];
    const value = row?.value as { ukljucen?: boolean; sat?: number } | undefined;
    return { ukljucen: value?.ukljucen ?? true, sat: value?.sat ?? 3 };
  });

  app.put("/api/podesavanja/auto-update", { preHandler: requireAdmin }, async (req, reply) => {
    // sat = cas u danu (0-23) kada cron pokrece update; cron radi na svaki pun sat
    const parsed = z
      .object({ ukljucen: z.boolean(), sat: z.number().int().min(0).max(23).default(3) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    await db
      .insert(schema.appSettings)
      .values({ key: "auto_update", value: parsed.data })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: parsed.data } });
    return parsed.data;
  });

  // --- Rezervne kopije (backup baze + storage; cron cita ovu konfiguraciju) ---
  // Mrezni cilj (SMB/NFS) je opcion; lozinka se cuva kao i SMTP/IMAP - u bazi (LAN alat).

  const backupSchema = z.object({
    ukljucen: z.boolean().default(true),
    sat: z.number().int().min(0).max(23).default(3),
    cuvajDana: z.number().int().min(1).max(365).default(14),
    lokalniDir: z.string().default("/var/backups/albatron"),
    mreza: z
      .object({
        tip: z.enum(["", "smb", "nfs"]).default(""),
        server: z.string().default(""),
        deo: z.string().default(""),
        folder: z.string().default(""),
        korisnik: z.string().default(""),
        lozinka: z.string().default(""),
      })
      .default({ tip: "", server: "", deo: "", folder: "", korisnik: "", lozinka: "" }),
  });

  app.get("/api/podesavanja/backup", { preHandler: requireAdmin }, async () => {
    const row = (
      await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "backup"))
    )[0];
    return backupSchema.parse(row?.value ?? {});
  });

  app.put("/api/podesavanja/backup", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = backupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    await db
      .insert(schema.appSettings)
      .values({ key: "backup", value: parsed.data })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: parsed.data } });
    return parsed.data;
  });

  // --- Uputstva (PDF dokumenti, faza 16 RP8) ---

  const UPUTSTVA_DIR = join(process.env.FILE_STORAGE ?? join(process.cwd(), "storage"), "uputstva");

  app.get(
    "/api/uputstva",
    { preHandler: requirePrivilege("podesavanja", "read") },
    async () => {
      return db
        .select({
          id: schema.uputstvaDokumenti.id,
          naziv: schema.uputstvaDokumenti.naziv,
          filename: schema.uputstvaDokumenti.filename,
          sistemsko: schema.uputstvaDokumenti.sistemsko,
        })
        .from(schema.uputstvaDokumenti)
        .orderBy(asc(schema.uputstvaDokumenti.naziv));
    },
  );

  // otvaranje PDF-a (dozvoljen ?t= token za <a> u remote rezimu, guard FAJL_RUTA)
  app.get(
    "/api/uputstva/:id",
    { preHandler: requirePrivilege("podesavanja", "read") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const [dok] = await db.select().from(schema.uputstvaDokumenti).where(eq(schema.uputstvaDokumenti.id, id));
      if (!dok || !fs.existsSync(dok.storedPath)) return reply.code(404).send({ error: "Uputstvo ne postoji" });
      return reply
        .header("Content-Type", "application/pdf")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", `inline; filename="${encodeURIComponent(dok.filename)}"`)
        .send(fs.createReadStream(dok.storedPath));
    },
  );

  app.post(
    "/api/uputstva",
    { preHandler: requirePrivilege("podesavanja", "write") },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
      if (!file) return reply.code(400).send({ error: "Fajl nije poslat" });
      const nazivField = file.fields.naziv as { value?: string } | undefined;
      const naziv = String(nazivField?.value ?? "").trim() || file.filename;
      if (naziv.length > 200) return reply.code(400).send({ error: "Naziv je predugačak" });
      if (file.mimetype !== "application/pdf") return reply.code(400).send({ error: "Dozvoljen je samo PDF" });

      if (!fs.existsSync(UPUTSTVA_DIR)) fs.mkdirSync(UPUTSTVA_DIR, { recursive: true });
      const ext = extname(file.filename).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10) || ".pdf";
      const storedPath = join(UPUTSTVA_DIR, `${randomBytes(16).toString("hex")}${ext}`);
      await pipeline(file.file, fs.createWriteStream(storedPath));
      if (file.file.truncated) {
        fs.unlinkSync(storedPath);
        return reply.code(400).send({ error: "Fajl je veći od 20 MB" });
      }
      const [created] = await db
        .insert(schema.uputstvaDokumenti)
        .values({ naziv, filename: file.filename, storedPath, sistemsko: false })
        .returning();
      return { id: created!.id, naziv: created!.naziv, filename: created!.filename, sistemsko: created!.sistemsko };
    },
  );

  app.delete(
    "/api/uputstva/:id",
    { preHandler: requirePrivilege("podesavanja", "write") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const [dok] = await db.select().from(schema.uputstvaDokumenti).where(eq(schema.uputstvaDokumenti.id, id));
      if (!dok) return reply.code(404).send({ error: "Uputstvo ne postoji" });
      if (dok.sistemsko) return reply.code(400).send({ error: "Sistemsko uputstvo se ne može obrisati" });
      await db.delete(schema.uputstvaDokumenti).where(eq(schema.uputstvaDokumenti.id, id));
      if (fs.existsSync(dok.storedPath)) fs.unlinkSync(dok.storedPath);
      return reply.code(204).send();
    },
  );
}
