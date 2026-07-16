import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { articleSchema } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";
import { getIstorija, logChanges, nextIdent } from "./service.js";

const read = requirePrivilege("artikli", "read");
const write = requirePrivilege("artikli", "write");

const STORAGE = process.env.FILE_STORAGE ?? join(process.cwd(), "storage");

// numericka polja se u bazu upisuju kao string (drizzle numeric)
const NUMERIC_FIELDS = [
  "prodajnaCena", "kurs", "marza", "dobavljacevaCena", "ocekivaniPopust",
  "carinskaStopa", "sertifikacijaStopa", "dodatniTroskoviStopa", "akcijaProcenat",
] as const;

function toDb(input: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...input };
  for (const f of NUMERIC_FIELDS) {
    if (f in out) out[f] = out[f] === null ? null : String(out[f]);
  }
  for (const f of ["akcijaOd", "akcijaDo"]) {
    if (f in out && typeof out[f] === "string") out[f] = new Date(out[f] as string);
  }
  return out;
}

// ident, ako je poslat, mora biti tacno 6 cifara (faza 15, RP1.1)
function identErr(body: unknown): string | null {
  const ident = (body as Record<string, unknown>).ident;
  if (ident !== undefined && !/^\d{6}$/.test(String(ident))) return "Ident mora biti tacno 6 cifara";
  return null;
}

// da li je subjekat oznacen kao dobavljac (brief 4.1)
async function checkDobavljac(id: number | null): Promise<string | null> {
  if (id === null) return null;
  const [s] = await db.select().from(schema.subjects).where(eq(schema.subjects.id, id));
  if (!s) return "Dobavljač ne postoji";
  if (s.role !== "dobavljac" && s.role !== "oba") return "Subjekat nije označen kao dobavljač";
  return null;
}

export async function artikliRoutes(app: FastifyInstance) {
  app.get("/api/artikli", { preHandler: read }, async () => {
    return db.select().from(schema.articles).orderBy(asc(schema.articles.ident));
  });

  // Cene iz najnovijeg cenovnika dobavljaca po artiklu (faza 17, RP12):
  // articles.dobavljacId + articles.sku > najnoviji pricelist (vaziOd, id desc) > stavka po sku.
  // Artikli bez dobavljaca/sku-a/cenovnika/stavke se izostavljaju iz odgovora.
  app.get("/api/artikli/cenovnik-cene", { preHandler: read }, async (req) => {
    const ids = ((req.query as { ids?: string }).ids ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const out: Record<number, { cena: number; valuta: string }> = {};
    if (!ids.length) return out;
    const arts = await db
      .select({ id: schema.articles.id, sku: schema.articles.sku, dobavljacId: schema.articles.dobavljacId })
      .from(schema.articles)
      .where(inArray(schema.articles.id, ids));
    // najnoviji cenovnik po dobavljacu - jednom po dobavljacu, ne po artiklu
    const cenovnikDobavljaca = new Map<number, { id: number; valuta: string }>();
    for (const a of arts) {
      if (!a.dobavljacId || !a.sku || cenovnikDobavljaca.has(a.dobavljacId)) continue;
      const [pl] = await db
        .select({ id: schema.pricelists.id, valuta: schema.pricelists.valuta })
        .from(schema.pricelists)
        .where(eq(schema.pricelists.dobavljacId, a.dobavljacId))
        .orderBy(desc(schema.pricelists.vaziOd), desc(schema.pricelists.id))
        .limit(1);
      if (pl) cenovnikDobavljaca.set(a.dobavljacId, pl);
    }
    for (const a of arts) {
      if (!a.dobavljacId || !a.sku) continue;
      const pl = cenovnikDobavljaca.get(a.dobavljacId);
      if (!pl) continue;
      const [item] = await db
        .select({ cena: schema.pricelistItems.cena })
        .from(schema.pricelistItems)
        .where(and(eq(schema.pricelistItems.pricelistId, pl.id), eq(schema.pricelistItems.sku, a.sku)))
        .limit(1);
      if (item?.cena != null) out[a.id] = { cena: Number(item.cena), valuta: pl.valuta };
    }
    return out;
  });

  app.get("/api/artikli/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [artikal] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
    if (!artikal) return reply.code(404).send({ error: "Artikal ne postoji" });
    const [atributi, povezani, fajlovi, varijacije] = await Promise.all([
      db.select().from(schema.articleAttributes).where(eq(schema.articleAttributes.articleId, id)),
      db
        .select({ id: schema.relatedArticles.id, relatedId: schema.relatedArticles.relatedId, naziv: schema.articles.naziv, ident: schema.articles.ident })
        .from(schema.relatedArticles)
        .innerJoin(schema.articles, eq(schema.relatedArticles.relatedId, schema.articles.id))
        .where(eq(schema.relatedArticles.articleId, id)),
      db.select().from(schema.articleFiles).where(eq(schema.articleFiles.articleId, id)),
      db.select().from(schema.articles).where(eq(schema.articles.parentId, id)),
    ]);
    return { ...artikal, atributi, povezani, fajlovi, varijacije };
  });

  app.post("/api/artikli", { preHandler: write }, async (req, reply) => {
    const body = req.body as { varijacije?: unknown[] } & Record<string, unknown>;
    const idErr = identErr(body);
    if (idErr) return reply.code(400).send({ error: idErr });
    const parsed = articleSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const d = parsed.data;

    // parent mora dobiti bar jednu varijaciju odmah (brief 5.2)
    if (d.tip === "parent" && (!Array.isArray(body.varijacije) || body.varijacije.length === 0)) {
      return reply.code(400).send({ error: "Morate uneti barem jednu varijaciju" });
    }
    // varijacija iz forme novog artikla (faza 15, RP7.4): parent obavezan i mora biti tip parent
    if (d.tip === "varijacija") {
      if (d.parentId === null) return reply.code(400).send({ error: "Varijacija mora imati parent artikal" });
      const [parent] = await db.select({ tip: schema.articles.tip }).from(schema.articles).where(eq(schema.articles.id, d.parentId));
      if (!parent || parent.tip !== "parent") {
        return reply.code(400).send({ error: "Parent artikal ne postoji ili nije tip parent" });
      }
    }
    const dobErr = await checkDobavljac(d.dobavljacId);
    if (dobErr) return reply.code(400).send({ error: dobErr });

    const [artikal] = await db
      .insert(schema.articles)
      .values({ ...(toDb(d) as typeof schema.articles.$inferInsert), ident: await nextIdent() })
      .returning();
    if (!artikal) return reply.code(500).send({ error: "Greska pri snimanju" });

    if (d.tip === "parent") {
      for (const v of body.varijacije!) {
        const vParsed = articleSchema.safeParse({ ...(v as object), tip: "varijacija", parentId: artikal.id });
        if (!vParsed.success) {
          await db.delete(schema.articles).where(eq(schema.articles.id, artikal.id));
          return reply.code(400).send({ error: `Varijacija: ${vParsed.error.issues[0]?.message}` });
        }
        const vDobErr = await checkDobavljac(vParsed.data.dobavljacId);
        if (vDobErr) {
          await db.delete(schema.articles).where(eq(schema.articles.id, artikal.id));
          return reply.code(400).send({ error: `Varijacija: ${vDobErr}` });
        }
        await db
          .insert(schema.articles)
          .values({ ...(toDb(vParsed.data) as typeof schema.articles.$inferInsert), ident: await nextIdent() });
      }
    }
    if (d.akcijaProcenat !== null) await upisiAkciju(artikal.id, d, req.user?.id ?? null);
    return reply.code(201).send(artikal);
  });

  app.put("/api/artikli/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [existing] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
    if (!existing) return reply.code(404).send({ error: "Artikal ne postoji" });
    const idErr = identErr(req.body);
    if (idErr) return reply.code(400).send({ error: idErr });

    // flag vodjenja serijskih se menja iskljucivo kroz /api/artikli/:id/serijski-flag (faza 15, RP3)
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.serijskiBrojevi;
    const merged = { ...existing, ...numFromDb(existing), ...body };
    const parsed = articleSchema.safeParse(merged);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const dobErr = await checkDobavljac(parsed.data.dobavljacId);
    if (dobErr) return reply.code(400).send({ error: dobErr });

    const [updated] = await db
      .update(schema.articles)
      .set(toDb(parsed.data))
      .where(eq(schema.articles.id, id))
      .returning();

    await logChanges("artikal", id, existing, updated!, req.user?.id ?? null);

    // promena akcije ide u istoriju akcija (brief 5.1)
    const akcijaChanged =
      String(existing.akcijaProcenat) !== String(updated!.akcijaProcenat) ||
      String(existing.akcijaOd) !== String(updated!.akcijaOd) ||
      String(existing.akcijaDo) !== String(updated!.akcijaDo) ||
      existing.akcijaNeograniceno !== updated!.akcijaNeograniceno;
    if (akcijaChanged) await upisiAkciju(id, parsed.data, req.user?.id ?? null);

    return updated;
  });

  app.get("/api/artikli/:id/istorija", { preHandler: read }, async (req) => {
    return getIstorija("artikal", Number((req.params as { id: string }).id));
  });

  app.get("/api/artikli/:id/akcije", { preHandler: read }, async (req) => {
    return db
      .select()
      .from(schema.akcijaIstorija)
      .where(eq(schema.akcijaIstorija.articleId, Number((req.params as { id: string }).id)))
      .orderBy(asc(schema.akcijaIstorija.createdAt));
  });

  // --- Atributi (zamena celog niza) ---

  app.put("/api/artikli/:id/atributi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ atributi: z.array(z.string().min(1)).max(20) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Najvise 20 atributa" });
    await db.delete(schema.articleAttributes).where(eq(schema.articleAttributes.articleId, id));
    if (parsed.data.atributi.length) {
      await db
        .insert(schema.articleAttributes)
        .values(parsed.data.atributi.map((value) => ({ articleId: id, value })));
    }
    return { ok: true };
  });

  // --- Povezani artikli (jednosmerno, multi-add) ---

  app.post("/api/artikli/:id/povezani", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ ids: z.array(z.number()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const postojeci = await db
      .select({ relatedId: schema.relatedArticles.relatedId })
      .from(schema.relatedArticles)
      .where(eq(schema.relatedArticles.articleId, id));
    const vec = new Set(postojeci.map((p) => p.relatedId));
    const novi = parsed.data.ids.filter((rid) => rid !== id && !vec.has(rid));
    if (novi.length) {
      await db.insert(schema.relatedArticles).values(novi.map((relatedId) => ({ articleId: id, relatedId })));
    }
    return { ok: true, dodato: novi.length };
  });

  app.delete("/api/artikli/:id/povezani/:relatedId", { preHandler: write }, async (req) => {
    const p = req.params as { id: string; relatedId: string };
    await db
      .delete(schema.relatedArticles)
      .where(
        and(
          eq(schema.relatedArticles.articleId, Number(p.id)),
          eq(schema.relatedArticles.relatedId, Number(p.relatedId)),
        ),
      );
    return { ok: true };
  });

  // --- Fajlovi: slika i dokumenti (brief 5.6) ---

  app.post("/api/artikli/:id/fajlovi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { slika } = req.query as { slika?: string };
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Fajl nije poslat" });

    if (!existsSync(STORAGE)) mkdirSync(STORAGE, { recursive: true });
    // ime na disku je iskljucivo servski generisano (bez korisnickog unosa)
    const ext = extname(file.filename).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
    const stored = `${randomBytes(16).toString("hex")}${ext}`;
    await pipeline(file.file, createWriteStream(safePath(stored)));

    const isImage = slika === "true";
    if (isImage) {
      // jedna slika po artiklu - stara se brise
      const old = await db
        .select()
        .from(schema.articleFiles)
        .where(and(eq(schema.articleFiles.articleId, id), eq(schema.articleFiles.isImage, true)));
      for (const o of old) {
        try { unlinkSync(safePath(o.storedPath)); } catch { /* vec obrisan */ }
      }
      await db
        .delete(schema.articleFiles)
        .where(and(eq(schema.articleFiles.articleId, id), eq(schema.articleFiles.isImage, true)));
    }
    const [row] = await db
      .insert(schema.articleFiles)
      .values({ articleId: id, filename: file.filename, storedPath: stored, isImage })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/fajlovi/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z
      .object({ filename: z.string().min(1).optional(), autoAttach: z.boolean().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const [row] = await db
      .update(schema.articleFiles)
      .set(parsed.data)
      .where(eq(schema.articleFiles.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: "Fajl ne postoji" });
    return row;
  });

  app.delete("/api/fajlovi/:id", { preHandler: write }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.select().from(schema.articleFiles).where(eq(schema.articleFiles.id, id));
    if (row) {
      try { unlinkSync(safePath(row.storedPath)); } catch { /* vec obrisan */ }
      await db.delete(schema.articleFiles).where(eq(schema.articleFiles.id, id));
    }
    return { ok: true };
  });

  app.get("/api/fajlovi/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.select().from(schema.articleFiles).where(eq(schema.articleFiles.id, id));
    if (!row) return reply.code(404).send({ error: "Fajl ne postoji" });
    const { createReadStream } = await import("node:fs");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    const imgType = IMAGE_TYPES[extname(row.storedPath).toLowerCase()];
    if (row.isImage && imgType) {
      // slike inline (prikaz u <img>), sa fiksnim image/* tipom
      reply.header("Content-Type", imgType);
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.filename)}"`);
    } else {
      // dokumenti iskljucivo kao download, bez sniffovanja
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(row.filename)}"`);
    }
    return reply.send(createReadStream(safePath(row.storedPath)));
  });

  // --- Import + masovno azuriranje (faza 15, RP4) ---
  // Parsiranje fajla je na klijentu; ovde stizu redovi kao mape polje -> string.
  // dryRun samo validira i predlaze idente; upis RE-VALIDIRA sve iznova (Uvezi je poseban zahtev).

  const importBody = z.object({
    mode: z.enum(["novi", "azuriranje"]),
    dryRun: z.boolean(),
    rows: z.array(z.record(z.string(), z.string())).min(1),
  });

  const IMPORT_TEKST = ["naziv", "opis", "napomena", "sku", "prodajnaValuta", "dobavljacevaValuta", "zemljaPorekla", "carinskaTarifa"] as const;
  // marza se ne uvozi - preracunava se iz unetih cena
  const IMPORT_BROJ = [
    "prodajnaCena", "dobavljacevaCena", "kurs", "ocekivaniPopust",
    "carinskaStopa", "sertifikacijaStopa", "dodatniTroskoviStopa", "akcijaProcenat",
  ] as const;

  app.post("/api/artikli-import", { preHandler: write }, async (req, reply) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const { mode, dryRun, rows } = parsed.data;

    const subjekti = await db.select().from(schema.subjects);
    const dobavljacPoNazivu = new Map(
      subjekti
        .filter((s) => s.role === "dobavljac" || s.role === "oba")
        .map((s) => [s.naziv.trim().toLowerCase(), s.id]),
    );
    const artikli = await db.select().from(schema.articles);
    const poIdentu = new Map(artikli.map((a) => [a.ident, a]));
    // kategorije se u fajlu unose kao sifre (categories.code)
    const kategorije = await db.select().from(schema.categories);
    const kategPoSifri = new Map(
      kategorije.filter((k) => k.code).map((k) => [k.code!.trim().toUpperCase(), k.id]),
    );

    // serijski flag: "da/1/x/+" -> true, "ne/0/prazno" -> false
    const parseFlag = (v: string) => /^(da|1|x|\+|true)$/i.test(v.trim());

    // tip artikla u fajlu: O/P/V, prazno = obican (faza 16, RP15)
    const TIP_MAPA: Record<string, "obican" | "parent" | "varijacija"> = {
      "": "obican", O: "obican", P: "parent", V: "varijacija",
    };

    const rez = rows.map((_, index) => ({
      index,
      status: "ok" as "ok" | "greska",
      napomena: "",
      predlozeniIdent: undefined as string | undefined,
    }));
    const greska = (i: number, msg: string) => {
      rez[i]!.status = "greska";
      if (!rez[i]!.napomena) rez[i]!.napomena = msg;
    };

    // duplikat kljuca (ident) unutar fajla = greska oba reda
    if (mode === "azuriranje") {
      const videno = new Map<string, number>();
      rows.forEach((r, i) => {
        const ident = (r.ident ?? "").trim();
        if (!ident) return;
        const prvi = videno.get(ident);
        if (prvi !== undefined) {
          greska(prvi, `Ident ${ident} se ponavlja u fajlu`);
          greska(i, `Ident ${ident} se ponavlja u fajlu`);
        } else videno.set(ident, i);
      });
    }

    // parenti iz istog fajla (mode novi): ident kolona parent reda je privremena oznaka
    // koju varijacije referenciraju kroz parentIdent; pravi ident dodeljuje server
    const fajlParenti = new Map<string, number>();
    if (mode === "novi") {
      rows.forEach((r, i) => {
        if (TIP_MAPA[(r.tip ?? "").trim().toUpperCase()] !== "parent") return;
        const oznaka = (r.ident ?? "").trim();
        if (!oznaka) return;
        if (fajlParenti.has(oznaka)) {
          greska(fajlParenti.get(oznaka)!, `Parent oznaka ${oznaka} se ponavlja u fajlu`);
          greska(i, `Parent oznaka ${oznaka} se ponavlja u fajlu`);
        } else fajlParenti.set(oznaka, i);
      });
    }

    type Kandidat = {
      i: number;
      data: z.infer<typeof articleSchema>;
      existing?: (typeof artikli)[number];
      // varijacija koja referencira parent red iz istog fajla (index reda)
      parentRed?: number;
    };
    const kandidati: Kandidat[] = [];
    rows.forEach((r, i) => {
      if (rez[i]!.status === "greska") return;
      const obj: Record<string, unknown> = {};
      for (const f of IMPORT_TEKST) {
        const v = (r[f] ?? "").trim();
        if (v) obj[f] = v;
      }
      for (const f of IMPORT_BROJ) {
        const v = (r[f] ?? "").trim().replace(",", ".");
        if (!v) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) return greska(i, `Polje ${f}: "${r[f]}" nije broj`);
        obj[f] = n;
      }
      const dob = (r.dobavljac ?? "").trim();
      if (dob) {
        const did = dobavljacPoNazivu.get(dob.toLowerCase());
        if (!did) return greska(i, `Dobavljac "${dob}" ne postoji`);
        obj.dobavljacId = did;
      }
      // kategorije po sifri
      for (const [kol, polje] of [
        ["glavnaKategorija", "glavnaKategorijaId"],
        ["sekundarnaKategorija", "sekundarnaKategorijaId"],
      ] as const) {
        const sifra = (r[kol] ?? "").trim();
        if (!sifra) continue;
        const kid = kategPoSifri.get(sifra.toUpperCase());
        if (!kid) return greska(i, `Kategorija sa sifrom "${sifra}" ne postoji`);
        obj[polje] = kid;
      }
      // serijski flag samo pri unosu novih (izmena flaga ide kroz /serijski-flag, faza 15 RP3)
      if (mode === "novi" && (r.serijskiBrojevi ?? "").trim()) {
        obj.serijskiBrojevi = parseFlag(r.serijskiBrojevi!);
      }
      if (mode === "novi") {
        // tipovi O/P/V (faza 16, RP15); ista validacija parenta kao create ruta (RP7.4)
        const tipRaw = (r.tip ?? "").trim().toUpperCase();
        const tip = TIP_MAPA[tipRaw];
        if (!tip) return greska(i, `Tip "${r.tip}" nije O, P ili V`);
        let parentId: number | null = null;
        let parentRed: number | undefined;
        if (tip === "varijacija") {
          const pid = (r.parentIdent ?? "").trim();
          if (!pid) return greska(i, "Parent ident je obavezan za varijaciju");
          const dbParent = poIdentu.get(pid);
          if (dbParent) {
            if (dbParent.tip !== "parent") return greska(i, `Artikal ${pid} nije tip parent`);
            parentId = dbParent.id;
          } else if (fajlParenti.has(pid)) {
            parentRed = fajlParenti.get(pid);
            parentId = -1; // placeholder za validaciju; pravi id posle inserta parenta
          } else return greska(i, `Parent sa identom ${pid} ne postoji`);
        }
        const p = articleSchema.safeParse({ ...obj, tip, parentId });
        if (!p.success) return greska(i, p.error.issues[0]?.message ?? "Neispravni podaci");
        kandidati.push({ i, data: p.data, parentRed });
      } else {
        const ident = (r.ident ?? "").trim();
        if (!ident) return greska(i, "Ident je obavezan pri azuriranju");
        const existing = poIdentu.get(ident);
        if (!existing) return greska(i, `Artikal sa identom ${ident} ne postoji`);
        // prazna celija ne dira polje: merge preko postojeceg stanja, kao PUT
        const p = articleSchema.safeParse({ ...existing, ...numFromDb(existing), ...obj });
        if (!p.success) return greska(i, p.error.issues[0]?.message ?? "Neispravni podaci");
        kandidati.push({ i, data: p.data, existing });
      }
    });

    // varijacija ciji parent red iz fajla ima gresku pada zajedno sa njim
    for (const k of kandidati) {
      if (k.parentRed !== undefined && rez[k.parentRed]!.status === "greska") {
        greska(k.i, "Parent red u fajlu ima gresku");
      }
    }

    // predlozeni identi: samo prikaz, dodela se radi iznova pri upisu
    if (mode === "novi") {
      let next = parseInt(await nextIdent(), 10);
      for (const k of kandidati) rez[k.i]!.predlozeniIdent = String(next++).padStart(6, "0");
    }

    const ok = rez.every((r) => r.status === "ok");
    if (dryRun || !ok) return { ok, rows: rez, created: [] };

    const created: { ident: string; naziv: string; sku: string }[] = [];
    const azurirani: { existing: Record<string, unknown>; updated: Record<string, unknown> }[] = [];
    // ponytail: identi se dodeljuju sekvencijalno od max-a pre transakcije; paralelan
    // rucni unos artikla u istom trenutku bi pao na unique - prihvatljivo za ERP
    let next = parseInt(await nextIdent(), 10);
    // identi po redosledu redova u fajlu; upis ide parenti pre varijacija (RP15)
    const identPoRedu = new Map<number, string>();
    if (mode === "novi") {
      for (const k of kandidati) identPoRedu.set(k.i, String(next++).padStart(6, "0"));
    }
    const redosledUpisa = mode === "novi"
      ? [...kandidati].sort((a, b) => (a.data.tip === "parent" ? 0 : 1) - (b.data.tip === "parent" ? 0 : 1))
      : kandidati;
    const idPoRedu = new Map<number, number>(); // index parent reda -> novi id
    await db.transaction(async (tx) => {
      for (const k of redosledUpisa) {
        if (mode === "novi") {
          const ident = identPoRedu.get(k.i)!;
          const parentId = k.parentRed !== undefined ? idPoRedu.get(k.parentRed)! : k.data.parentId;
          const [row] = await tx
            .insert(schema.articles)
            .values({ ...(toDb(k.data) as typeof schema.articles.$inferInsert), ident, parentId })
            .returning();
          if (k.data.tip === "parent") idPoRedu.set(k.i, row!.id);
          created.push({ ident: row!.ident, naziv: row!.naziv, sku: row!.sku });
          rez[k.i]!.predlozeniIdent = ident;
        } else {
          const [upd] = await tx
            .update(schema.articles)
            .set(toDb(k.data))
            .where(eq(schema.articles.id, k.existing!.id))
            .returning();
          azurirani.push({ existing: k.existing!, updated: upd! });
        }
      }
    });
    for (const a of azurirani) {
      await logChanges("artikal", a.updated.id as number, a.existing, a.updated, req.user?.id ?? null);
    }
    return { ok: true, rows: rez, created };
  });
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// putanja sme biti samo unutar STORAGE foldera
function safePath(stored: string): string {
  const full = resolve(join(STORAGE, stored));
  if (!full.startsWith(resolve(STORAGE) + sep)) throw new Error("Nedozvoljena putanja");
  return full;
}

// numeric kolone iz baze stizu kao string - vrati u number za validaciju
function numFromDb(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of NUMERIC_FIELDS) {
    out[f] = row[f] === null ? null : Number(row[f]);
  }
  for (const f of ["akcijaOd", "akcijaDo"]) {
    out[f] = row[f] instanceof Date ? (row[f] as Date).toISOString() : row[f];
  }
  return out;
}

async function upisiAkciju(
  articleId: number,
  d: { akcijaProcenat: number | null; akcijaOd: string | null; akcijaDo: string | null; akcijaNeograniceno: boolean },
  userId: number | null,
) {
  await db.insert(schema.akcijaIstorija).values({
    articleId,
    procenat: d.akcijaProcenat?.toString() ?? null,
    od: d.akcijaOd ? new Date(d.akcijaOd) : null,
    doDatuma: d.akcijaDo ? new Date(d.akcijaDo) : null,
    neograniceno: d.akcijaNeograniceno,
    userId,
  });
}
