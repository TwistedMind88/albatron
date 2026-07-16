// Izvestaji i mail (faza 7, brief 7.7/7.8): sabloni, pregled, PDF/Word/PNG, slanje maila
import fs from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { chromium, type Browser } from "playwright";
import HTMLtoDOCX from "html-to-docx";
import nodemailer from "nodemailer";
import { DOC_MODULI, PLACEHOLDERS, STAVKA_POLJA, partialUpdate } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requireAnyPrivilege, requirePrivilege } from "../auth/guard.js";
import { placeholderVrednosti, placeholderVrednostiPrenos, popuni, prosiriSablon, prilogeZaDokument } from "./render.js";

const read = requireAnyPrivilege(DOC_MODULI, "read");
const write = requireAnyPrivilege(DOC_MODULI, "write");
const podesavanjaWrite = requirePrivilege("podesavanja", "write");

const TIPOVI = [
  "ponuda",
  "predracun",
  "revers",
  "kalkulacija",
  "porudzbina",
  "priprema_uvoza",
  "ulaz_robe",
  "otpremnica",
  "racun",
  "avansni_racun",
  "prenos",
] as const;
const NABAVNI = ["porudzbina", "priprema_uvoza", "ulaz_robe"];

// Podrazumevani sablon - isti skelet za sva 4 tipa (brief 7.7)
const DEFAULT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 32px; }
h1 { font-size: 20px; margin: 0 0 2px; }
.meta { color: #555; margin-bottom: 16px; }
.blokovi { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.blok h3 { font-size: 12px; margin: 0 0 4px; text-transform: uppercase; color: #777; }
table.stavke th { background: #f0f0f0; text-align: left; }
table.stavke td.num, table.stavke th.num { text-align: right; }
.total { margin-top: 12px; text-align: right; font-size: 13px; }
.total b { font-size: 15px; }
.footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #ccc; color: #666; font-size: 10.5px; }
</style></head><body>
<h1>{doc_tip} {doc_broj}</h1>
<div class="meta">Datum: {doc_datum} &nbsp;|&nbsp; Važi do: {doc_vazi_do} &nbsp;|&nbsp; Valuta: {doc_valuta}</div>
<div class="blokovi">
  <div class="blok"><h3>Prodavac</h3>{firma_naziv}<br/>{firma_adresa}<br/>PIB: {firma_pib} &nbsp; MB: {firma_maticni_broj}</div>
  <div class="blok"><h3>Kupac</h3>{klijent_puni_naziv}<br/>{klijent_adresa}<br/>{klijent_postanski_broj} {klijent_grad}<br/>PIB: {klijent_pib}</div>
</div>
{stavke_tabela}
<div class="total">Osnovica: {doc_osnovica} {doc_valuta}<br/>PDV: {doc_pdv} {doc_valuta}<br/><b>Ukupno: {doc_ukupno} {doc_valuta}</b></div>
{opcioni_tabela}
<div class="footer">
Način plaćanja: {doc_nacin_placanja} &nbsp;|&nbsp; Paritet: {doc_paritet}<br/>
Žiro računi: {firma_racuni}<br/>
Referent: {user_ime} &nbsp; {user_email} &nbsp;|&nbsp; Tel: {firma_telefoni} &nbsp;|&nbsp; Mail: {firma_mailovi}
</div>
</body></html>`;

// Prenos (faza 16, RP2): sopstveni skelet - nema klijenta, sume ni PDV
const PRENOS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 32px; }
h1 { font-size: 20px; margin: 0 0 2px; }
.meta { color: #555; margin-bottom: 16px; }
.blokovi { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.blok h3 { font-size: 12px; margin: 0 0 4px; text-transform: uppercase; color: #777; }
table.stavke th { background: #f0f0f0; text-align: left; }
table.stavke td.num, table.stavke th.num { text-align: right; }
.footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #ccc; color: #666; font-size: 10.5px; }
</style></head><body>
<h1>Prenos {doc_broj}</h1>
<div class="meta">Datum: {doc_datum}</div>
<div class="blokovi">
  <div class="blok"><h3>Izdajno skladište</h3>{prenos_izdajno}</div>
  <div class="blok"><h3>Prijemno skladište</h3>{prenos_prijemno}</div>
</div>
{stavke_tabela}
<p>{prenos_napomena}</p>
<div class="footer">
{firma_naziv} &nbsp;|&nbsp; PIB: {firma_pib}<br/>
Referent: {user_ime}
</div>
</body></html>`;

// Faza 15 RP5: default sablon prilagodjen tipu (nabavni tipovi -> dobavljac, faktura, avans polja)
function defaultHtml(tip: string) {
  if (tip === "prenos") return PRENOS_HTML;
  let html = DEFAULT_HTML;
  if (NABAVNI.includes(tip)) {
    html = html
      .replace("<h3>Prodavac</h3>", "<h3>Kupac</h3>")
      .replace(
        '<div class="blok"><h3>Kupac</h3>{klijent_puni_naziv}<br/>{klijent_adresa}<br/>{klijent_postanski_broj} {klijent_grad}<br/>PIB: {klijent_pib}</div>',
        '<div class="blok"><h3>Dobavljač</h3>{dobavljac_puni_naziv}<br/>{dobavljac_adresa}<br/>{dobavljac_postanski_broj} {dobavljac_grad}<br/>PIB: {dobavljac_pib}</div>',
      );
  }
  if (tip === "priprema_uvoza" || tip === "ulaz_robe") {
    html = html.replace(
      "Valuta: {doc_valuta}</div>",
      "Valuta: {doc_valuta} &nbsp;|&nbsp; Faktura: {doc_broj_fakture} od {doc_datum_fakture}</div>",
    );
  }
  if (tip === "avansni_racun") {
    html = html.replace(
      '<div class="total">',
      '<div class="meta" style="margin-top:12px">Po predračunu: {avans_predracun_broj} &nbsp;|&nbsp; Avansna osnovica: {avans_osnovica} {doc_valuta} &nbsp;|&nbsp; Avansni iznos: {avans_iznos} {doc_valuta}</div>\n<div class="total">',
    );
  }
  return html;
}

async function ensureDefaultSabloni() {
  // migracija postojecih "Standardni" sablona: ubaci {opcioni_tabela} iza bloka sa sumama
  const bezOpcionih = await db
    .select({ id: schema.reportTemplates.id, html: schema.reportTemplates.html })
    .from(schema.reportTemplates)
    .where(eq(schema.reportTemplates.naziv, "Standardni"));
  for (const s of bezOpcionih) {
    if (s.html.includes("{opcioni_tabela}") || !s.html.includes('</div>\n<div class="footer">')) continue;
    await db
      .update(schema.reportTemplates)
      .set({ html: s.html.replace('</div>\n<div class="footer">', '</div>\n{opcioni_tabela}\n<div class="footer">') })
      .where(eq(schema.reportTemplates.id, s.id));
  }
  for (const tip of TIPOVI) {
    const postoji = await db
      .select({ id: schema.reportTemplates.id })
      .from(schema.reportTemplates)
      .where(eq(schema.reportTemplates.docType, tip));
    if (!postoji.length) {
      await db.insert(schema.reportTemplates).values({
        docType: tip,
        naziv: "Standardni",
        html: defaultHtml(tip),
        isDefault: true,
      });
    }
  }
}

// ponytail: jedan lenjo pokrenut browser za ceo proces; restart servera ga gasi
let browser: Browser | null = null;
async function getBrowser() {
  if (!browser) browser = await chromium.launch();
  return browser;
}

async function renderHtml(docId: number, sablonId?: number) {
  const vrednosti = await placeholderVrednosti(docId);
  if (!vrednosti) return null;
  const [doc] = await db
    .select({ tip: schema.documents.tip, broj: schema.documents.broj })
    .from(schema.documents)
    .where(eq(schema.documents.id, docId));
  const uslovi = sablonId
    ? eq(schema.reportTemplates.id, sablonId)
    : and(eq(schema.reportTemplates.docType, doc!.tip), eq(schema.reportTemplates.isDefault, true));
  let [sablon] = await db.select().from(schema.reportTemplates).where(uslovi);
  if (!sablon) {
    // nema podrazumevanog - uzmi prvi za tip
    [sablon] = await db
      .select()
      .from(schema.reportTemplates)
      .where(eq(schema.reportTemplates.docType, doc!.tip))
      .orderBy(asc(schema.reportTemplates.id));
  }
  if (!sablon) return null;
  const prosiren = await prosiriSablon(sablon.html, docId);
  return { html: popuni(prosiren, vrednosti), broj: doc!.broj, sablon };
}

// Prenos (faza 16, RP2): isti tok kao renderHtml, podaci iz prenosi tabele
async function renderHtmlPrenos(prenosId: number, sablonId?: number) {
  const vrednosti = await placeholderVrednostiPrenos(prenosId);
  if (!vrednosti) return null;
  const uslovi = sablonId
    ? eq(schema.reportTemplates.id, sablonId)
    : and(eq(schema.reportTemplates.docType, "prenos"), eq(schema.reportTemplates.isDefault, true));
  let [sablon] = await db.select().from(schema.reportTemplates).where(uslovi);
  if (!sablon) {
    [sablon] = await db
      .select()
      .from(schema.reportTemplates)
      .where(eq(schema.reportTemplates.docType, "prenos"))
      .orderBy(asc(schema.reportTemplates.id));
  }
  if (!sablon) return null;
  const prosiren = await prosiriSablon(sablon.html, null);
  return { html: popuni(prosiren, vrednosti), broj: vrednosti.doc_broj!, sablon };
}

async function napraviPdf(html: string) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await page.close();
  }
}

const sablonSchema = z.object({
  docType: z.enum(TIPOVI),
  naziv: z.string().min(1).max(200),
  html: z.string().default(""),
  isDefault: z.boolean().default(false),
});

export async function izvestajiRoutes(app: FastifyInstance) {
  await ensureDefaultSabloni();

  // --- Sabloni (podesavanja) ---

  app.get("/api/sabloni", { preHandler: read }, async (req) => {
    const { tip } = req.query as { tip?: string };
    return db
      .select()
      .from(schema.reportTemplates)
      .where(tip ? eq(schema.reportTemplates.docType, tip) : undefined)
      .orderBy(asc(schema.reportTemplates.docType), asc(schema.reportTemplates.id));
  });

  app.post("/api/sabloni", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const parsed = sablonSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    if (parsed.data.isDefault) {
      await db
        .update(schema.reportTemplates)
        .set({ isDefault: false })
        .where(eq(schema.reportTemplates.docType, parsed.data.docType));
    }
    const [created] = await db.insert(schema.reportTemplates).values(parsed.data).returning();
    return created;
  });

  app.put("/api/sabloni/:id", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = partialUpdate(sablonSchema).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const [postojeci] = await db
      .select()
      .from(schema.reportTemplates)
      .where(eq(schema.reportTemplates.id, id));
    if (!postojeci) return reply.code(404).send({ error: "Šablon ne postoji" });
    if (parsed.data.isDefault) {
      await db
        .update(schema.reportTemplates)
        .set({ isDefault: false })
        .where(eq(schema.reportTemplates.docType, postojeci.docType));
    }
    const [updated] = await db
      .update(schema.reportTemplates)
      .set(parsed.data)
      .where(eq(schema.reportTemplates.id, id))
      .returning();
    return updated;
  });

  // Preview sablona (stavka 40): renderuje prosledjeni HTML kroz isti engine,
  // sa podacima poslednjeg dokumenta tog tipa; bez dokumenta - [placeholder] demo vrednosti
  app.post("/api/sabloni/preview", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const parsed = z
      .object({ docType: z.enum(TIPOVI), html: z.string() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    // prenos (faza 16, RP2): preview sa podacima poslednjeg prenosa
    if (parsed.data.docType === "prenos") {
      const [pr] = await db
        .select({ id: schema.prenosi.id })
        .from(schema.prenosi)
        .orderBy(desc(schema.prenosi.id))
        .limit(1);
      const vrednosti = pr
        ? await placeholderVrednostiPrenos(pr.id)
        : Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, `[${p.key}]`]));
      const prosiren = await prosiriSablon(parsed.data.html, null);
      return { html: popuni(prosiren, vrednosti ?? {}), demo: !pr };
    }
    const [doc] = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.tip, parsed.data.docType))
      .orderBy(desc(schema.documents.id))
      .limit(1);
    const vrednosti = doc
      ? await placeholderVrednosti(doc.id)
      : Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, `[${p.key}]`]));
    const prosiren = await prosiriSablon(parsed.data.html, doc?.id ?? null);
    return { html: popuni(prosiren, vrednosti ?? {}), demo: !doc };
  });

  app.delete("/api/sabloni/:id", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db.delete(schema.reportTemplates).where(eq(schema.reportTemplates.id, id));
    return reply.code(204).send();
  });

  // --- Imenovane tabele stavki (faza 15 RP5) ---

  const POLJA_KEYS = new Set(STAVKA_POLJA.map((p) => p.key));
  const tabelaDefSchema = z.object({
    naziv: z.string().regex(/^[a-z0-9_]+$/, "Naziv sme da sadrži samo mala slova, cifre i _").max(100),
    docType: z.enum(TIPOVI).nullable().default(null),
    kolone: z
      .array(
        z.object({
          polje: z.string().refine((p) => POLJA_KEYS.has(p), "Nepoznato polje"),
          naslov: z.string().max(200),
          poravnanje: z.enum(["left", "center", "right"]).default("left"),
          sirina: z.string().max(20).default(""),
        }),
      )
      .min(1),
  });

  app.get("/api/sabloni-tabele", { preHandler: read }, async () => {
    return db.select().from(schema.reportTableDefs).orderBy(asc(schema.reportTableDefs.naziv));
  });

  app.post("/api/sabloni-tabele", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const parsed = tabelaDefSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Neispravan zahtev" });
    const [postoji] = await db
      .select({ id: schema.reportTableDefs.id })
      .from(schema.reportTableDefs)
      .where(eq(schema.reportTableDefs.naziv, parsed.data.naziv));
    if (postoji) return reply.code(400).send({ error: "Definicija sa tim nazivom već postoji" });
    const [created] = await db.insert(schema.reportTableDefs).values(parsed.data).returning();
    return created;
  });

  app.put("/api/sabloni-tabele/:id", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = tabelaDefSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Neispravan zahtev" });
    const [postoji] = await db
      .select({ id: schema.reportTableDefs.id })
      .from(schema.reportTableDefs)
      .where(eq(schema.reportTableDefs.naziv, parsed.data.naziv));
    if (postoji && postoji.id !== id) return reply.code(400).send({ error: "Definicija sa tim nazivom već postoji" });
    const [updated] = await db
      .update(schema.reportTableDefs)
      .set(parsed.data)
      .where(eq(schema.reportTableDefs.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Definicija ne postoji" });
    return updated;
  });

  // Brisanje: bez ?force=true vraca 409 sa spiskom sablona koji koriste definiciju
  app.delete("/api/sabloni-tabele/:id", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { force } = req.query as { force?: string };
    const [def] = await db.select().from(schema.reportTableDefs).where(eq(schema.reportTableDefs.id, id));
    if (!def) return reply.code(404).send({ error: "Definicija ne postoji" });
    if (force !== "true") {
      const koriste = await db
        .select({ naziv: schema.reportTemplates.naziv, docType: schema.reportTemplates.docType })
        .from(schema.reportTemplates)
        .where(like(schema.reportTemplates.html, `%:${def.naziv}}%`));
      if (koriste.length) {
        return reply.code(409).send({
          error: `Definiciju koriste šabloni: ${koriste.map((k) => `${k.naziv} (${k.docType})`).join(", ")}`,
        });
      }
    }
    await db.delete(schema.reportTableDefs).where(eq(schema.reportTableDefs.id, id));
    return reply.code(204).send();
  });

  // --- Slike u sablonima (faza 15 RP5) ---

  const SLIKE_DIR = join(process.env.FILE_STORAGE ?? join(process.cwd(), "storage"), "sabloni-slike");
  const MIME_WHITELIST = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

  app.get("/api/sabloni-slike", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.reportImages.id,
        naziv: schema.reportImages.naziv,
        filename: schema.reportImages.filename,
        mime: schema.reportImages.mime,
      })
      .from(schema.reportImages)
      .orderBy(asc(schema.reportImages.naziv));
  });

  // thumbnail / pregled slike
  app.get("/api/sabloni-slike/:id/fajl", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [slika] = await db.select().from(schema.reportImages).where(eq(schema.reportImages.id, id));
    if (!slika || !fs.existsSync(slika.storedPath)) return reply.code(404).send({ error: "Slika ne postoji" });
    // SVG moze da nosi skripte - servira se inertno (sandbox CSP) da ne izvrsava na origin-u aplikacije
    if (slika.mime === "image/svg+xml") {
      reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    return reply
      .header("Content-Type", slika.mime)
      .header("X-Content-Type-Options", "nosniff")
      .send(fs.createReadStream(slika.storedPath));
  });

  app.post("/api/sabloni-slike", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "Fajl nije poslat" });
    const nazivField = file.fields.naziv as { value?: string } | undefined;
    const naziv = String(nazivField?.value ?? "").trim();
    if (!/^[a-z0-9_]+$/.test(naziv) || naziv.length > 100) {
      return reply.code(400).send({ error: "Naziv sme da sadrži samo mala slova, cifre i _" });
    }
    if (!MIME_WHITELIST.has(file.mimetype)) {
      return reply.code(400).send({ error: "Dozvoljeni formati: PNG, JPG, SVG, WebP" });
    }
    const [duplikat] = await db
      .select({ id: schema.reportImages.id })
      .from(schema.reportImages)
      .where(eq(schema.reportImages.naziv, naziv));
    if (duplikat) return reply.code(400).send({ error: "Slika sa tim nazivom već postoji" });

    if (!fs.existsSync(SLIKE_DIR)) fs.mkdirSync(SLIKE_DIR, { recursive: true });
    const ext = extname(file.filename).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
    const storedPath = join(SLIKE_DIR, `${randomBytes(16).toString("hex")}${ext}`);
    await pipeline(file.file, fs.createWriteStream(storedPath));
    if (file.file.truncated) {
      fs.unlinkSync(storedPath);
      return reply.code(400).send({ error: "Fajl je veći od 2 MB" });
    }
    const [created] = await db
      .insert(schema.reportImages)
      .values({ naziv, filename: file.filename, storedPath, mime: file.mimetype })
      .returning();
    return { id: created!.id, naziv: created!.naziv, filename: created!.filename, mime: created!.mime };
  });

  app.delete("/api/sabloni-slike/:id", { preHandler: podesavanjaWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [slika] = await db.select().from(schema.reportImages).where(eq(schema.reportImages.id, id));
    if (!slika) return reply.code(404).send({ error: "Slika ne postoji" });
    await db.delete(schema.reportImages).where(eq(schema.reportImages.id, id));
    if (fs.existsSync(slika.storedPath)) fs.unlinkSync(slika.storedPath);
    return reply.code(204).send();
  });

  // --- Pregled i eksport (brief 7.7) ---

  app.get("/api/dokumenti/:id/izvestaj", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { sablon } = req.query as { sablon?: string };
    const r = await renderHtml(id, sablon ? Number(sablon) : undefined);
    if (!r) return reply.code(404).send({ error: "Dokument ili šablon ne postoji" });
    return { html: r.html, sablonId: r.sablon.id };
  });

  // zajednicki eksport odgovor (dokument i prenos, faza 16 RP2)
  async function eksportuj(reply: FastifyReply, r: { html: string; broj: string }, format?: string) {
    const ime = r.broj.replace(/[^\w-]/g, "_");
    if (format === "pdf") {
      const pdf = await napraviPdf(r.html);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${ime}.pdf"`)
        .send(pdf);
    }
    if (format === "png") {
      const b = await getBrowser();
      const page = await b.newPage({ viewport: { width: 794, height: 1123 } }); // A4 @ 96dpi
      try {
        await page.setContent(r.html, { waitUntil: "load" });
        const png = await page.screenshot({ fullPage: true });
        return reply
          .header("Content-Type", "image/png")
          .header("Content-Disposition", `attachment; filename="${ime}.png"`)
          .send(png);
      } finally {
        await page.close();
      }
    }
    if (format === "docx") {
      const docx = await HTMLtoDOCX(r.html, null, { table: { row: { cantSplit: true } } });
      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .header("Content-Disposition", `attachment; filename="${ime}.docx"`)
        .send(docx);
    }
    return reply.code(400).send({ error: "Nepoznat format" });
  }

  app.get("/api/dokumenti/:id/izvestaj-eksport", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { sablon, format } = req.query as { sablon?: string; format?: string };
    const r = await renderHtml(id, sablon ? Number(sablon) : undefined);
    if (!r) return reply.code(404).send({ error: "Dokument ili šablon ne postoji" });
    return eksportuj(reply, r, format);
  });

  // --- Izvestaj prenosa (faza 16, RP2) ---

  const zaliheRead = requirePrivilege("zalihe", "read");

  app.get("/api/prenosi/:id/izvestaj", { preHandler: zaliheRead }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { sablon } = req.query as { sablon?: string };
    const r = await renderHtmlPrenos(id, sablon ? Number(sablon) : undefined);
    if (!r) return reply.code(404).send({ error: "Prenos ili šablon ne postoji" });
    return { html: r.html, sablonId: r.sablon.id };
  });

  app.get("/api/prenosi/:id/izvestaj-eksport", { preHandler: zaliheRead }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { sablon, format } = req.query as { sablon?: string; format?: string };
    const r = await renderHtmlPrenos(id, sablon ? Number(sablon) : undefined);
    if (!r) return reply.code(404).send({ error: "Prenos ili šablon ne postoji" });
    return eksportuj(reply, r, format);
  });

  // --- Mail (brief 7.8) ---

  // lista dokumenata artikala sa dokumenta za "okaci dokumente"
  app.get("/api/dokumenti/:id/prilozi", { preHandler: read }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const priloge = await prilogeZaDokument(id);
    return priloge.map(({ storedPath: _sp, ...rest }) => rest);
  });

  const mailSchema = z.object({
    to: z.string().min(1),
    bcc: z.string().default(""),
    subject: z.string().min(1),
    body: z.string().default(""),
    sablon: z.number().nullable().default(null),
    prilogIds: z.array(z.number()).default([]),
  });

  app.post("/api/dokumenti/:id/posalji-mail", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);

    // multipart/form-data: tekstualna polja + fajlovi okaceni sa racunara (st.9)
    const polja: Record<string, string> = {};
    const uploadovani: { filename: string; content: Buffer }[] = [];
    for await (const part of req.parts()) {
      if (part.type === "file") {
        uploadovani.push({ filename: part.filename, content: await part.toBuffer() });
      } else {
        polja[part.fieldname] = String(part.value ?? "");
      }
    }
    const parsed = mailSchema.safeParse({
      to: polja.to,
      bcc: polja.bcc,
      subject: polja.subject,
      body: polja.body,
      sablon: polja.sablon ? Number(polja.sablon) : null,
      prilogIds: polja.prilogIds ? (JSON.parse(polja.prilogIds) as number[]) : [],
    });
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });

    const [me] = await db
      .select({ smtp: schema.users.smtp })
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.id));
    const smtp = me?.smtp as
      | { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; fromEmail: string }
      | null
      | undefined;
    if (!smtp?.host) {
      return reply.code(400).send({ error: "SMTP nije podešen u profilu (Podešavanja > Profil)" });
    }

    const r = await renderHtml(id, parsed.data.sablon ?? undefined);
    if (!r) return reply.code(404).send({ error: "Dokument ne postoji" });
    const pdf = await napraviPdf(r.html);

    const sviPrilozi = await prilogeZaDokument(id);
    const izabrani = sviPrilozi.filter((p) => parsed.data.prilogIds.includes(p.id));
    const attachments = [
      { filename: `${r.broj.replace(/[^\w-]/g, "_")}.pdf`, content: Buffer.from(pdf) },
      ...izabrani
        .filter((p) => fs.existsSync(p.storedPath))
        .map((p) => ({ filename: p.filename, path: p.storedPath })),
      ...uploadovani,
    ];

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    try {
      await transporter.sendMail({
        from: smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail,
        to: parsed.data.to,
        bcc: parsed.data.bcc || undefined,
        subject: parsed.data.subject,
        text: parsed.data.body,
        attachments,
      });
    } catch (err) {
      req.log.error(err, "slanje maila neuspesno");
      return reply.code(502).send({ error: `Slanje nije uspelo: ${(err as Error).message}` });
    }
    return { ok: true };
  });
}
