import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DOC_MODULI, formatirajBroj, podrazumevaniFormat } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { requireAnyPrivilege, requirePrivilege } from "../auth/guard.js";
import { getIstorija, logChanges } from "../artikli/service.js";
import { knjiziUlaz, upisiEvidencijuPorucenog } from "./nabavka.js";
import { avansiRacuna, iskoriscenoAvansa, knjiziIzlaz, proveriSerijske, veziAvans } from "./prodaja.js";

const read = requireAnyPrivilege(DOC_MODULI, "read");
const write = requireAnyPrivilege(DOC_MODULI, "write");

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
] as const;
type Tip = (typeof TIPOVI)[number];

// Pravilo prenosa 1:1 (brief 8.9): parovi u lancu gde se kolicine prate i ogranicavaju
const LANAC = new Set(["predracun>otpremnica", "predracun>racun", "otpremnica>racun"]);

const r2iznos = (n: number) => Math.round(n * 100) / 100;

// Minimalni set statusa (brief 7.2) - upisuje se ako nedostaje, po tipu
const DEFAULT_STATUSI = ["u izradi", "poslato", "u obradi", "arhiva", "isteklo"];
const REVERS_STATUSI = [...DEFAULT_STATUSI, "vraćeno", "delimično vraćeno"];

async function ensureStatusi() {
  for (const tip of TIPOVI) {
    const postojeci = await db
      .select({ v: schema.lookups.internalValue })
      .from(schema.lookups)
      .where(and(eq(schema.lookups.kind, "status_dokumenta"), eq(schema.lookups.docType, tip)));
    const imamo = new Set(postojeci.map((p) => p.v));
    const zeljeni = tip === "revers" ? REVERS_STATUSI : DEFAULT_STATUSI;
    const fali = zeljeni.filter((s) => !imamo.has(s));
    if (fali.length) {
      await db.insert(schema.lookups).values(
        fali.map((s) => ({
          kind: "status_dokumenta",
          docType: tip,
          internalValue: s,
          externalValue: s,
          sortOrder: zeljeni.indexOf(s),
          isDefault: s === "u izradi",
        })),
      );
    }
  }
}

const itemSchema = z.object({
  articleId: z.number().nullable().default(null),
  ident: z.string().default(""),
  naziv: z.string().min(1),
  kolicina: z.number().default(1),
  cena: z.number().default(0),
  popust: z.number().default(0),
  porezStopa: z.number().default(0),
  rokIsporuke: z.string().default(""),
  napomena: z.string().max(400).default(""),
  opcioni: z.boolean().default(false),
  serijskiBroj: z.string().default(""),
  nabavnaCena: z.number().nullable().default(null),
  kalk: z.record(z.string(), z.number().nullable()).nullable().default(null),
  // nabavka (brief 8.5-8.7)
  potrebe: z
    .array(z.object({ predracunId: z.number(), broj: z.string(), klijentNaziv: z.string(), kolicina: z.number() }))
    .nullable()
    .default(null),
  zemljaPorekla: z.string().default(""),
  carinskaTarifa: z.string().default(""),
  carinskaStopa: z.number().nullable().default(null),
  transportTrosak: z.number().nullable().default(null),
  // koleta - snapshot za nabavne tipove (faza 17, RP5)
  koleta: z.number().nullable().default(null),
  serijskiBrojevi: z.array(z.string().min(1)).nullable().default(null),
  // prenos 1:1 (brief 8.9) - server ga vodi, klijent ga vraca nepromenjenog
  prenetaKolicina: z.number().default(0),
});

const headerSchema = z.object({
  status: z.string().default("u izradi"),
  klijentId: z.number().nullable().default(null),
  klijentNaziv: z.string().default(""),
  klijentPuniNaziv: z.string().default(""),
  klijentPib: z.string().default(""),
  klijentAdresa: z.string().default(""),
  klijentPostanskiBroj: z.string().default(""),
  klijentGrad: z.string().default(""),
  kontaktOsoba: z.string().default(""),
  kontaktTelefon: z.string().default(""),
  kontaktEmail: z.string().default(""),
  adresaSlanja: z.record(z.string(), z.string()).default({}),
  posrednik: z.record(z.string(), z.string()).default({}),
  valuta: z.string().default("RSD"),
  kurs: z.number().nullable().default(null),
  paritet: z.string().default(""),
  nacinPlacanja: z.string().default(""),
  datum: z.string(), // ISO
  rokVazenja: z.number().default(30),
  vaziDo: z.string().nullable().default(null),
  referencaKupca: z.string().default(""),
  smer: z.string().nullable().default(null),
  // revers uz modul zaliha (brief 12): izbor skladista ili null = bez skladista
  skladisteId: z.number().nullable().default(null),
  troskoviZaglavlje: z.record(z.string(), z.number().nullable()).nullable().default(null),
  // priprema za uvoz / ulaz robe (brief 8.6, 8.7)
  brojFakture: z.string().default(""),
  datumFakture: z.string().nullable().default(null),
  ukupanTransport: z.number().nullable().default(null),
  // avansni racun (brief 8.10)
  avansPredracunBroj: z.string().default(""),
  avansOsnovica: z.number().nullable().default(null),
  avansIznos: z.number().nullable().default(null),
});

const createSchema = headerSchema.extend({
  tip: z.enum(TIPOVI),
  items: z.array(itemSchema).default([]),
});

function toRow(h: z.infer<typeof headerSchema>) {
  return {
    ...h,
    kurs: h.kurs?.toString() ?? null,
    datum: new Date(h.datum),
    vaziDo: h.vaziDo ? new Date(h.vaziDo) : null,
    datumFakture: h.datumFakture ? new Date(h.datumFakture) : null,
    ukupanTransport: h.ukupanTransport?.toString() ?? null,
    avansOsnovica: h.avansOsnovica?.toString() ?? null,
    avansIznos: h.avansIznos?.toString() ?? null,
  };
}

function itemRows(documentId: number, items: z.infer<typeof itemSchema>[]) {
  return items.map((i, idx) => ({
    ...i,
    documentId,
    pozicija: idx + 1,
    kolicina: i.kolicina.toString(),
    cena: i.cena.toString(),
    popust: i.popust.toString(),
    porezStopa: i.porezStopa.toString(),
    nabavnaCena: i.nabavnaCena?.toString() ?? null,
    carinskaStopa: i.carinskaStopa?.toString() ?? null,
    transportTrosak: i.transportTrosak?.toString() ?? null,
    koleta: i.koleta?.toString() ?? null,
    prenetaKolicina: i.prenetaKolicina.toString(),
  }));
}

// Numeracija (brief 7.3, 14.2): format po tipu iz podesavanja (default GG-KOD-NNNNN),
// brojac po tipu i godini (godisnji reset), prvi slobodan, transakciono
async function insertSaBrojem(tx: typeof db, tip: Tip, row: ReturnType<typeof toRow>) {
  const danas = new Date();
  const godina = danas.getFullYear();
  const [podesavanje] = await tx
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "numeracija"));
  const formati = (podesavanje?.value ?? {}) as Record<string, string>;
  const format = formati[tip] || podrazumevaniFormat(tip);
  for (let pokusaj = 0; pokusaj < 3; pokusaj++) {
    const [max] = await tx
      .select({ n: sql<number>`coalesce(max(${schema.documents.redniBroj}), 0)` })
      .from(schema.documents)
      .where(and(eq(schema.documents.tip, tip), eq(schema.documents.godina, godina)));
    const redniBroj = (max?.n ?? 0) + 1;
    const broj = formatirajBroj(format, danas, redniBroj);
    try {
      const [doc] = await tx
        .insert(schema.documents)
        .values({ ...row, tip, godina, redniBroj, broj })
        .returning();
      return doc!;
    } catch (e) {
      if (pokusaj === 2) throw e; // unique constraint - paralelan upis, probaj ponovo
    }
  }
  throw new Error("Numeracija nije uspela");
}

async function vezaniDokumenti(id: number) {
  const rows = await db
    .select({
      fromId: schema.documentLinks.fromId,
      toId: schema.documentLinks.toId,
      broj: schema.documents.broj,
      tip: schema.documents.tip,
      status: schema.documents.status,
      docId: schema.documents.id,
    })
    .from(schema.documentLinks)
    .innerJoin(
      schema.documents,
      or(
        and(eq(schema.documentLinks.fromId, id), eq(schema.documents.id, schema.documentLinks.toId)),
        and(eq(schema.documentLinks.toId, id), eq(schema.documents.id, schema.documentLinks.fromId)),
      ),
    )
    .where(or(eq(schema.documentLinks.fromId, id), eq(schema.documentLinks.toId, id)));
  return rows.map((r) => ({
    id: r.docId,
    broj: r.broj,
    tip: r.tip,
    status: r.status,
    smer: r.fromId === id ? "iz-ovog" : "u-ovaj",
  }));
}

export async function dokumentiRoutes(app: FastifyInstance) {
  await ensureStatusi();

  // Sifarnici potrebni dokumentu (statusi, porezi, nacini placanja, pariteti)
  // pod "dokumenti" privilegijom - /api/liste trazi "podesavanja"
  app.get("/api/dokumenti-sifarnici", { preHandler: read }, async () => {
    return db
      .select()
      .from(schema.lookups)
      .where(eq(schema.lookups.active, true))
      .orderBy(asc(schema.lookups.kind), asc(schema.lookups.sortOrder), asc(schema.lookups.id));
  });

  // Datum otpremnice se automatski pomera na tekuci dan dok nije arhivirana (brief 8.8)
  // ponytail: pomera se samo datum dokumenta; knjizenje izlaza ostaje na datumu snimanja
  async function osveziDatumOtpremnica() {
    await db
      .update(schema.documents)
      .set({ datum: new Date() })
      .where(
        and(
          eq(schema.documents.tip, "otpremnica"),
          sql`${schema.documents.status} not in ('arhiva', 'isteklo')`,
          sql`${schema.documents.datum}::date < current_date`,
        ),
      );
  }

  app.get("/api/dokumenti", { preHandler: read }, async (req, reply) => {
    const { tip } = req.query as { tip?: string };
    if (!TIPOVI.includes(tip as Tip)) return reply.code(400).send({ error: "Nepoznat tip dokumenta" });
    if (tip === "otpremnica") await osveziDatumOtpremnica();
    return db
      .select({
        id: schema.documents.id,
        broj: schema.documents.broj,
        datum: schema.documents.datum,
        status: schema.documents.status,
        smer: schema.documents.smer,
        klijentNaziv: schema.documents.klijentNaziv,
        referencaKupca: schema.documents.referencaKupca,
        valuta: schema.documents.valuta,
        referent: schema.users.fullName,
        // suma bez PDV, bez opcionih stavki (brief 8.1)
        suma: sql<string>`coalesce((select sum(${schema.documentItems.kolicina} * ${schema.documentItems.cena} * (1 - ${schema.documentItems.popust} / 100)) from ${schema.documentItems} where ${schema.documentItems.documentId} = ${schema.documents.id} and not ${schema.documentItems.opcioni}), 0)`,
      })
      .from(schema.documents)
      .leftJoin(schema.users, eq(schema.documents.referentId, schema.users.id))
      .where(eq(schema.documents.tip, tip as Tip))
      .orderBy(desc(schema.documents.id));
  });

  app.post("/api/dokumenti", { preHandler: write }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { tip, items, ...header } = parsed.data;
    if (tip === "revers" && !header.smer) header.smer = "izdavanje";
    try {
      const doc = await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const d = await insertSaBrojem(txdb, tip, {
          ...toRow(header),
          referentId: req.user?.id ?? null, // referent = kreator, zakljucan (brief 7.1)
        } as ReturnType<typeof toRow>);
        if (items.length) await tx.insert(schema.documentItems).values(itemRows(d.id, items));
        if (tip === "porudzbina") await upisiEvidencijuPorucenog(txdb, d.id, items);
        if (tip === "ulaz_robe") {
          await knjiziUlaz(txdb, { id: d.id, datum: new Date(header.datum), skladisteId: header.skladisteId }, items, req.user?.id ?? null);
        }
        if (tip === "otpremnica") {
          await knjiziIzlaz(txdb, { id: d.id, datum: new Date(header.datum), skladisteId: header.skladisteId }, items, req.user?.id ?? null);
        }
        if (tip === "racun") await proveriSerijske(txdb, items);
        return d;
      });
      return reply.code(201).send(doc);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška pri snimanju" });
    }
  });

  app.get("/api/dokumenti/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    let [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return reply.code(404).send({ error: "Dokument ne postoji" });
    if (doc.tip === "otpremnica") {
      await osveziDatumOtpremnica();
      [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    }
    const items = await db
      .select()
      .from(schema.documentItems)
      .where(eq(schema.documentItems.documentId, id))
      .orderBy(asc(schema.documentItems.pozicija));
    const [referent] = doc!.referentId
      ? await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, doc!.referentId))
      : [];
    // finansije avansa (brief 8.10): na racunu iskorisceni avansi, na avansu preostalo
    const avansi = doc!.tip === "racun" ? await avansiRacuna(db, id) : null;
    const avansIskorisceno = doc!.tip === "avansni_racun" ? await iskoriscenoAvansa(db, id) : null;
    return { ...doc, referent: referent?.fullName ?? "", items, veze: await vezaniDokumenti(id), avansi, avansIskorisceno };
  });

  // Zakljucavanje dokumenta pri uredjivanju (faza 17, RP11):
  // lock zivi dok heartbeat stigne u poslednjih 15 min; zaostali lock istice sam
  const LOCK_TTL_MS = 15 * 60 * 1000;
  const lockAktivan = (d: { lockedBy: number | null; lockHeartbeat: Date | null }) =>
    d.lockedBy !== null && d.lockHeartbeat !== null && Date.now() - d.lockHeartbeat.getTime() < LOCK_TTL_MS;

  async function lockKonflikt(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, lockedBy: number) {
    const [u] = await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, lockedBy));
    const ime = u?.fullName ?? "Drugi korisnik";
    return reply.code(409).send({ error: `Korisnik ${ime} već uređuje ovaj dokument`, user: ime });
  }

  app.post("/api/dokumenti/:id/lock", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return reply.code(404).send({ error: "Dokument ne postoji" });
    if (lockAktivan(doc) && doc.lockedBy !== req.user!.id) return lockKonflikt(reply, doc.lockedBy!);
    await db
      .update(schema.documents)
      .set({ lockedBy: req.user!.id, lockHeartbeat: new Date() })
      .where(eq(schema.documents.id, id));
    return { ok: true };
  });

  app.post("/api/dokumenti/:id/lock-heartbeat", { preHandler: write }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await db
      .update(schema.documents)
      .set({ lockHeartbeat: new Date() })
      .where(and(eq(schema.documents.id, id), eq(schema.documents.lockedBy, req.user!.id)));
    return { ok: true };
  });

  app.delete("/api/dokumenti/:id/lock", { preHandler: write }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await db
      .update(schema.documents)
      .set({ lockedBy: null, lockHeartbeat: null })
      .where(and(eq(schema.documents.id, id), eq(schema.documents.lockedBy, req.user!.id)));
    return { ok: true };
  });

  app.put("/api/dokumenti/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [before] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!before) return reply.code(404).send({ error: "Dokument ne postoji" });
    // tudji aktivan lock odbija snimanje (faza 17, RP11)
    if (lockAktivan(before) && before.lockedBy !== req.user!.id) return lockKonflikt(reply, before.lockedBy!);
    const parsed = headerSchema.extend({ items: z.array(itemSchema).default([]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { items, ...header } = parsed.data;
    try {
      const after = await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        // uspesno snimanje otpusta lock
        const [a] = await tx
          .update(schema.documents)
          .set({ ...toRow(header), lockedBy: null, lockHeartbeat: null })
          .where(eq(schema.documents.id, id))
          .returning();
        // stavke se menjaju u celini (log na nivou zaglavlja + broj stavki)
        await tx.delete(schema.documentItems).where(eq(schema.documentItems.documentId, id));
        if (items.length) await tx.insert(schema.documentItems).values(itemRows(id, items));
        if (before.tip === "porudzbina") await upisiEvidencijuPorucenog(txdb, id, items);
        if (before.tip === "ulaz_robe") {
          await knjiziUlaz(txdb, { id, datum: new Date(header.datum), skladisteId: header.skladisteId }, items, req.user?.id ?? null);
        }
        if (before.tip === "otpremnica") {
          await knjiziIzlaz(txdb, { id, datum: new Date(header.datum), skladisteId: header.skladisteId }, items, req.user?.id ?? null);
        }
        if (before.tip === "racun") await proveriSerijske(txdb, items);
        return a!;
      });
      // lock polja nisu sadrzaj dokumenta - ne loguju se u audit
      const { lockedBy: _lb, lockHeartbeat: _lh, ...beforeLog } = before;
      const { lockedBy: _la, lockHeartbeat: _lha, ...afterLog } = after;
      await logChanges("dokument", id, beforeLog, afterLog, req.user?.id ?? null);
      return after;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška pri snimanju" });
    }
  });

  // Brisanje dokumenta (faza 16, RP6): posebna privilegija "brisanje_dokumenata".
  // Dokument sa vezama se ne brise; knjizenja zaliha se ponistavaju postojecim
  // mehanizmom (knjiziUlaz/knjiziIzlaz sa praznim stavkama brise ledger+serijske po refId);
  // blokada ako su serijski sa ovog ulaza dalje izdati.
  app.delete(
    "/api/dokumenti/:id",
    { preHandler: requirePrivilege("brisanje_dokumenata", "write") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
      if (!doc) return reply.code(404).send({ error: "Dokument ne postoji" });
      const veze = await vezaniDokumenti(id);
      if (veze.length) {
        return reply.code(400).send({
          error: `Dokument ima vezane dokumente i ne može se obrisati: ${veze.map((v) => v.broj).join(", ")}`,
        });
      }
      const izdati = await db
        .select({ broj: schema.serialNumbers.broj })
        .from(schema.serialNumbers)
        .where(and(eq(schema.serialNumbers.refId, id), isNotNull(schema.serialNumbers.izlazId)));
      if (izdati.length) {
        return reply.code(400).send({
          error: `Serijski brojevi sa ovog dokumenta su dalje izdati: ${izdati.map((s) => s.broj).join(", ")}`,
        });
      }
      try {
        await db.transaction(async (tx) => {
          const txdb = tx as unknown as typeof db;
          if (doc.tip === "ulaz_robe") await knjiziUlaz(txdb, { id, datum: doc.datum, skladisteId: null }, [], req.user?.id ?? null);
          if (doc.tip === "otpremnica") await knjiziIzlaz(txdb, { id, datum: doc.datum, skladisteId: null }, [], req.user?.id ?? null);
          if (doc.tip === "porudzbina") await upisiEvidencijuPorucenog(txdb, id, []);
          // stavke, veze, avans veze i evidencije brise FK cascade
          await tx.delete(schema.documents).where(eq(schema.documents.id, id));
        });
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška pri brisanju" });
      }
      return { ok: true };
    },
  );

  app.get("/api/dokumenti/:id/log", { preHandler: read }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getIstorija("dokument", id);
  });

  // RFQ export (faza 15, RP7.1): stavke kalkulacije sa SKU iz cenovnika dobavljaca dokumenta
  app.get("/api/dokumenti/:id/rfq", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return reply.code(404).send({ error: "Dokument ne postoji" });
    if (doc.tip !== "kalkulacija") return reply.code(400).send({ error: "RFQ export je dostupan samo na kalkulaciji" });
    if (!doc.klijentId) return reply.code(400).send({ error: "Dokument nema vezanog dobavljača" });
    const items = await db
      .select({
        articleId: schema.documentItems.articleId,
        naziv: schema.documentItems.naziv,
        kolicina: schema.documentItems.kolicina,
      })
      .from(schema.documentItems)
      .where(eq(schema.documentItems.documentId, id))
      .orderBy(asc(schema.documentItems.pozicija));
    // SKU u cenovniku dobavljaca: articles.sku koji postoji u pricelist_items tog dobavljaca
    const uCenovniku = await db
      .selectDistinct({ sku: schema.pricelistItems.sku })
      .from(schema.pricelistItems)
      .innerJoin(schema.pricelists, eq(schema.pricelistItems.pricelistId, schema.pricelists.id))
      .where(eq(schema.pricelists.dobavljacId, doc.klijentId));
    const skuSet = new Set(uCenovniku.map((r) => r.sku));
    const artikalIds = items.map((i) => i.articleId).filter((x): x is number => x !== null);
    const artikli = artikalIds.length
      ? await db
          .select({ id: schema.articles.id, sku: schema.articles.sku })
          .from(schema.articles)
          .where(inArray(schema.articles.id, artikalIds))
      : [];
    const skuPoArtiklu = new Map(artikli.map((a) => [a.id, a.sku]));
    return {
      dobavljac: doc.klijentNaziv,
      stavke: items.map((i) => {
        const sku = i.articleId !== null ? skuPoArtiklu.get(i.articleId) : null;
        return {
          sku: sku && skuSet.has(sku) ? sku : null,
          naziv: i.naziv,
          kolicina: Number(i.kolicina),
        };
      }),
    };
  });

  // Kloniranje (brief 7.1 dodatne opcije) - novi broj, status "u izradi", bez veza
  app.post("/api/dokumenti/:id/kloniraj", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [src] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!src) return reply.code(404).send({ error: "Dokument ne postoji" });
    const items = await db.select().from(schema.documentItems).where(eq(schema.documentItems.documentId, id));
    const doc = await db.transaction(async (tx) => {
      const { id: _i, tip, godina: _g, redniBroj: _r, broj: _b, createdAt: _c, ...rest } = src;
      const d = await insertSaBrojem(tx as unknown as typeof db, tip as Tip, {
        ...rest,
        status: "u izradi",
        datum: new Date(),
        referentId: req.user?.id ?? null,
      } as never);
      if (items.length) {
        await tx.insert(schema.documentItems).values(
          items.map(({ id: _ii, documentId: _d, vracenaKolicina: _v, ...it }) => ({ ...it, documentId: d.id })),
        );
      }
      return d;
    });
    return reply.code(201).send(doc);
  });

  // Generisanje dokumenta iz drugog (brief 7.6): izbor stavki, veza, pravila arhiviranja.
  // U lancu predracun > otpremnica > racun (brief 8.9) prenosi se do preostale kolicine,
  // opciono na postojeci dokument (uDokumentId), uz opciju prenosa avansa (brief 8.10).
  app.post("/api/dokumenti/:id/generisi", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z
      .object({
        tip: z.enum(TIPOVI),
        itemIds: z.array(z.number()).default([]),
        items: z.array(z.object({ id: z.number(), kolicina: z.number().nullable().default(null) })).default([]),
        uDokumentId: z.number().nullable().default(null),
        veziAvans: z.boolean().default(false),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const { tip, uDokumentId, veziAvans: prenesiAvans } = parsed.data;
    const izbor = parsed.data.items.length
      ? parsed.data.items
      : parsed.data.itemIds.map((iid) => ({ id: iid, kolicina: null as number | null }));
    const [src] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!src) return reply.code(404).send({ error: "Dokument ne postoji" });
    const sve = await db
      .select()
      .from(schema.documentItems)
      .where(eq(schema.documentItems.documentId, id))
      .orderBy(asc(schema.documentItems.pozicija));
    const izabrane = sve.filter((i) => izbor.some((x) => x.id === i.id));
    const jeLanac = LANAC.has(`${src.tip}>${tip}`);
    const jeAvansCilj = tip === "avansni_racun";
    if (!izabrane.length && !jeAvansCilj) return reply.code(400).send({ error: "Nijedna stavka nije izabrana" });

    // priprema za uvoz: zemlja porekla i carinska tarifa automatski iz artikla (brief 8.6)
    if (tip === "priprema_uvoza") {
      for (const it of izabrane) {
        if (!it.articleId || (it.zemljaPorekla && it.carinskaTarifa && it.carinskaStopa !== null)) continue;
        const [a] = await db
          .select({
            zemljaPorekla: schema.articles.zemljaPorekla,
            carinskaTarifa: schema.articles.carinskaTarifa,
            carinskaStopa: schema.articles.carinskaStopa,
          })
          .from(schema.articles)
          .where(eq(schema.articles.id, it.articleId));
        if (a) {
          it.zemljaPorekla = it.zemljaPorekla || a.zemljaPorekla;
          it.carinskaTarifa = it.carinskaTarifa || a.carinskaTarifa;
          // fallback carine na artikal ako stavka nema (faza 15, RP7.3)
          it.carinskaStopa = it.carinskaStopa ?? a.carinskaStopa;
        }
      }
    }

    const jePovrat = src.tip === "revers" && tip === "revers";
    try {
      const doc = await db.transaction(async (tx) => {
        // kolicina za prenos po stavci: u lancu ograniceno na preostalo (brief 8.9)
        const prenos = new Map<number, number>();
        for (const it of izabrane) {
          const trazeno = izbor.find((x) => x.id === it.id)?.kolicina ?? null;
          if (jeLanac) {
            const preostalo = Number(it.kolicina) - Number(it.prenetaKolicina);
            const k = trazeno ?? preostalo;
            if (k <= 0 || k > preostalo + 0.005) {
              throw new Error(`Stavka "${it.naziv}": prenosivo najviše ${preostalo} (traženo ${k})`);
            }
            prenos.set(it.id, k);
          } else {
            prenos.set(it.id, trazeno ?? Number(it.kolicina));
          }
        }

        let d;
        let pozicijaOd = 0;
        if (uDokumentId !== null) {
          // prenos na postojeci dokument - zbir vise izvora (brief 8.9)
          const [cilj] = await tx.select().from(schema.documents).where(eq(schema.documents.id, uDokumentId));
          if (!cilj || cilj.tip !== tip) throw new Error("Ciljni dokument ne postoji ili nije odgovarajućeg tipa");
          const [maxPoz] = await tx
            .select({ n: sql<number>`coalesce(max(${schema.documentItems.pozicija}), 0)` })
            .from(schema.documentItems)
            .where(eq(schema.documentItems.documentId, uDokumentId));
          pozicijaOd = maxPoz?.n ?? 0;
          d = cilj;
        } else {
          const { id: _i, tip: _t, godina: _g, redniBroj: _r, broj: _b, createdAt: _c, smer: _s, status: _st, ...rest } = src;
          d = await insertSaBrojem(tx as unknown as typeof db, tip, {
            ...rest,
            status: "u izradi",
            datum: new Date(),
            referentId: req.user?.id ?? null,
            // revers iz reversa = povrat, inace izdavanje (brief 8.3)
            smer: tip === "revers" ? (jePovrat ? "povrat" : "izdavanje") : null,
            // otpremnica skida sa stanja - skladiste bira korisnik pri snimanju
            skladisteId: null,
            // avansni racun pamti broj izvornog predracuna (brief 8.10)
            avansPredracunBroj: jeAvansCilj ? src.broj : "",
            avansOsnovica: null,
            avansIznos: null,
          } as never);
        }

        if (izabrane.length && !jeAvansCilj) {
          await tx.insert(schema.documentItems).values(
            izabrane.map(({ id: _ii, documentId: _d, vracenaKolicina: _v, opcioni: _o, prenetaKolicina: _p, ...it }, idx) => {
              const k = prenos.get(_ii)!;
              return {
                ...it,
                // serijski brojevi se nasledjuju samo pri prenosu pune kolicine (brief 8.9)
                serijskiBrojevi: k === Number(it.kolicina) ? it.serijskiBrojevi : null,
                kolicina: k.toString(),
                opcioni: false,
                documentId: d.id,
                pozicija: pozicijaOd + idx + 1,
              };
            }),
          );
        }
        const [postojecaVeza] = await tx
          .select({ id: schema.documentLinks.id })
          .from(schema.documentLinks)
          .where(and(eq(schema.documentLinks.fromId, id), eq(schema.documentLinks.toId, d.id)));
        if (!postojecaVeza) await tx.insert(schema.documentLinks).values({ fromId: id, toId: d.id });

        // evidencija prenetih kolicina na izvoru (brief 8.9)
        if (jeLanac) {
          for (const it of izabrane) {
            await tx
              .update(schema.documentItems)
              .set({ prenetaKolicina: (Number(it.prenetaKolicina) + prenos.get(it.id)!).toString() })
              .where(eq(schema.documentItems.id, it.id));
          }
        }

        // kalkulacija > ponuda arhivira kalkulaciju (brief 7.6)
        if (src.tip === "kalkulacija" && tip === "ponuda") {
          await tx.update(schema.documents).set({ status: "arhiva" }).where(eq(schema.documents.id, id));
        }
        // kreiranje racuna iz otpremnice arhivira otpremnicu (brief 8.8)
        // ponytail: kod delimicnog prenosa arhivira se tek kad je sve preneto
        if (src.tip === "otpremnica" && tip === "racun") {
          const svePreneto = sve.every(
            (i) => Number(i.prenetaKolicina) + (prenos.get(i.id) ?? 0) >= Number(i.kolicina) - 0.005,
          );
          if (svePreneto) {
            await tx.update(schema.documents).set({ status: "arhiva" }).where(eq(schema.documents.id, id));
          }
        }
        // prenos avansa na racun iz predracuna (brief 8.10)
        if (prenesiAvans && src.tip === "predracun" && tip === "racun") {
          const linkovi = await tx.select().from(schema.documentLinks).where(eq(schema.documentLinks.fromId, id));
          const kandidati = linkovi.length
            ? await tx
                .select()
                .from(schema.documents)
                .where(
                  and(
                    eq(schema.documents.tip, "avansni_racun"),
                    inArray(schema.documents.id, linkovi.map((l) => l.toId)),
                  ),
                )
            : [];
          const txdb = tx as unknown as typeof db;
          for (const avans of kandidati) {
            const preostalo = Number(avans.avansIznos ?? 0) - (await iskoriscenoAvansa(txdb, avans.id));
            const sumaRacuna = izabrane.reduce((s, it) => {
              const k = prenos.get(it.id) ?? 0;
              return s + k * Number(it.cena) * (1 - Number(it.popust) / 100) * (1 + Number(it.porezStopa) / 100);
            }, 0);
            const vezano = (await avansiRacuna(txdb, d.id)).ukupno;
            const iznos = Math.min(preostalo, sumaRacuna - vezano);
            if (iznos > 0.005) await veziAvans(txdb, avans.id, d.id, r2iznos(iznos));
          }
        }
        // povrat reversa: oznaci vracene stavke i status originala (brief 8.3)
        if (jePovrat) {
          for (const it of izabrane) {
            await tx
              .update(schema.documentItems)
              .set({ vracenaKolicina: it.kolicina })
              .where(eq(schema.documentItems.id, it.id));
          }
          const svePosle = sve.every((i) => izbor.some((x) => x.id === i.id) || Number(i.vracenaKolicina) > 0);
          await tx
            .update(schema.documents)
            .set({ status: svePosle ? "vraćeno" : "delimično vraćeno" })
            .where(eq(schema.documents.id, id));
        }
        return d;
      });
      return reply.code(201).send(doc);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška pri generisanju" });
    }
  });

  // Popup pretraga artikala (brief 7.5)
  // ponytail: filtriranje u memoriji - SQL filteri ako baza artikala poraste
  app.get("/api/artikli-pretraga", { preHandler: read }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const rows = await db.select().from(schema.articles).where(eq(schema.articles.active, true));
    // stanje za padajucu listu artikala (faza 14.2): primarno skladiste,
    // ili skladiste iz ?skladisteId (faza 15 RP2: izdajno skladiste prenosa)
    const [primarno] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.isPrimary, true));
    const skladisteId = q.skladisteId ? Number(q.skladisteId) : primarno?.id;
    const stanja = new Map<number, number>();
    if (skladisteId) {
      const suma = await db
        .select({
          articleId: schema.stockLedger.articleId,
          s: sql<string>`coalesce(sum(${schema.stockLedger.kolicina}), 0)`,
        })
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.warehouseId, skladisteId))
        .groupBy(schema.stockLedger.articleId);
      for (const r of suma) stanja.set(r.articleId, Number(r.s));
    }
    const attrs = await db.select().from(schema.articleAttributes);
    const attrsByArticle = new Map<number, string[]>();
    for (const a of attrs) {
      const list = attrsByArticle.get(a.articleId) ?? [];
      list.push(a.value.toLowerCase());
      attrsByArticle.set(a.articleId, list);
    }
    const txt = (mode: string | undefined, value: string, target: string) => {
      const t = target.toLowerCase();
      const v = value.toLowerCase();
      return mode === "=" ? t === v : t.includes(v);
    };
    return rows
      .filter((a) => {
        if (q.naziv && !txt(q.nazivMode, q.naziv, a.naziv)) return false;
        if (q.ident && !txt(q.identMode, q.ident, a.ident)) return false;
        if (q.sifra && !txt(q.sifraMode, q.sifra, a.sku)) return false;
        if (q.dobavljacId && a.dobavljacId !== Number(q.dobavljacId)) return false;
        if (q.glavnaKategorijaId && a.glavnaKategorijaId !== Number(q.glavnaKategorijaId)) return false;
        if (q.sekundarnaKategorijaId && a.sekundarnaKategorijaId !== Number(q.sekundarnaKategorijaId)) return false;
        if (q.tip && a.tip !== q.tip) return false;
        const trazeni = [
          ...(q.atributi ? q.atributi.split(",") : []),
          ...(q.tagovi ? q.tagovi.split(",") : []),
        ].filter((x) => x.trim() !== "");
        if (trazeni.length) {
          const moji = attrsByArticle.get(a.id) ?? [];
          for (const t of trazeni) {
            if (!moji.some((m) => m.includes(t.trim().toLowerCase()))) return false;
          }
        }
        return true;
      })
      .slice(0, 200)
      .map((a) => ({
        id: a.id,
        ident: a.ident,
        tip: a.tip,
        naziv: a.naziv,
        sku: a.sku,
        prodajnaCena: a.prodajnaCena,
        prodajnaValuta: a.prodajnaValuta,
        dobavljacevaCena: a.dobavljacevaCena,
        dobavljacevaValuta: a.dobavljacevaValuta,
        porezId: a.porezId,
        serijskiBrojevi: a.serijskiBrojevi,
        stanjePrimarno: stanja.get(a.id) ?? 0,
      }));
  });

  // Dokumenti na kojima se artikal nalazi / svi dokumenti subjekta (brief 7.6)
  app.get("/api/dokumenti-za", { preHandler: read }, async (req, reply) => {
    const { artikalId, subjekatId } = req.query as { artikalId?: string; subjekatId?: string };
    if (artikalId) {
      return db
        .selectDistinct({
          id: schema.documents.id,
          broj: schema.documents.broj,
          tip: schema.documents.tip,
          datum: schema.documents.datum,
          status: schema.documents.status,
          klijentNaziv: schema.documents.klijentNaziv,
        })
        .from(schema.documents)
        .innerJoin(schema.documentItems, eq(schema.documentItems.documentId, schema.documents.id))
        .where(eq(schema.documentItems.articleId, Number(artikalId)))
        .orderBy(desc(schema.documents.id));
    }
    if (subjekatId) {
      return db
        .select({
          id: schema.documents.id,
          broj: schema.documents.broj,
          tip: schema.documents.tip,
          datum: schema.documents.datum,
          status: schema.documents.status,
          klijentNaziv: schema.documents.klijentNaziv,
        })
        .from(schema.documents)
        .where(eq(schema.documents.klijentId, Number(subjekatId)))
        .orderBy(desc(schema.documents.id));
    }
    return reply.code(400).send({ error: "artikalId ili subjekatId je obavezan" });
  });
}
