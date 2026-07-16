import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requireAnyPrivilege } from "../auth/guard.js";
import { DOC_MODULI } from "@albatron/shared";
import { dodajPromet, stanjeNaDan } from "../zalihe/service.js";

type Tx = typeof db;

export interface Potreba {
  predracunId: number;
  broj: string;
  klijentNaziv: string;
  kolicina: number;
}

interface NabavkaItem {
  articleId: number | null;
  naziv: string;
  kolicina: number;
  potrebe?: Potreba[] | null;
  serijskiBrojevi?: string[] | null;
}

// Evidencija porucenog po predracunu (brief 8.5): sync iz potreba stavki porudzbine.
// Brise stare redove ove porudzbine pa upisuje ponovo - izmena dokumenta ne duplira.
export async function upisiEvidencijuPorucenog(tx: Tx, porudzbinaId: number, items: NabavkaItem[]) {
  await tx.delete(schema.porucenoPoPredracunu).where(eq(schema.porucenoPoPredracunu.porudzbinaId, porudzbinaId));
  const rows = [];
  for (const i of items) {
    if (!i.articleId) continue;
    for (const p of i.potrebe ?? []) {
      rows.push({
        predracunId: p.predracunId,
        porudzbinaId,
        articleId: i.articleId,
        kolicina: p.kolicina.toString(),
      });
    }
  }
  if (rows.length) await tx.insert(schema.porucenoPoPredracunu).values(rows);
}

// Ulaz robe (brief 8.7): ubacuje artikle na stanje sa datumom dokumenta.
// Ponovno snimanje prvo ponisti prethodno knjizenje (ledger + serijski brojevi po refId).
export async function knjiziUlaz(
  tx: Tx,
  doc: { id: number; datum: Date; skladisteId: number | null },
  items: NabavkaItem[],
  userId: number | null,
) {
  const stari = await tx
    .select()
    .from(schema.stockLedger)
    .where(and(eq(schema.stockLedger.vrsta, "ulaz"), eq(schema.stockLedger.refId, doc.id)));
  for (const s of stari) {
    // brisanje prometa obara snapshote od tog meseca nadalje
    await tx
      .delete(schema.stockSnapshots)
      .where(
        and(
          eq(schema.stockSnapshots.articleId, s.articleId),
          eq(schema.stockSnapshots.warehouseId, s.warehouseId),
          gte(schema.stockSnapshots.mesec, s.datum.toISOString().slice(0, 7)),
        ),
      );
  }
  await tx
    .delete(schema.stockLedger)
    .where(and(eq(schema.stockLedger.vrsta, "ulaz"), eq(schema.stockLedger.refId, doc.id)));
  await tx.delete(schema.serialNumbers).where(eq(schema.serialNumbers.refId, doc.id));
  // ponytail: bez skladista nema knjizenja (modul zaliha iskljucen) - samo dokument
  if (!doc.skladisteId) return;
  // ista konvencija kao prenosi i test ulaz: promet u podne UTC datuma dokumenta
  const datum = new Date(`${doc.datum.toISOString().slice(0, 10)}T12:00:00Z`);
  for (const i of items) {
    if (!i.articleId) continue;
    const [a] = await tx
      .select({ serijskiBrojevi: schema.articles.serijskiBrojevi })
      .from(schema.articles)
      .where(eq(schema.articles.id, i.articleId));
    const brojevi = i.serijskiBrojevi ?? [];
    if (a?.serijskiBrojevi && brojevi.length !== Number(i.kolicina)) {
      throw new Error(
        `Artikal "${i.naziv}" vodi serijske brojeve: uneto ${brojevi.length}, potrebno ${Number(i.kolicina)}`,
      );
    }
    await dodajPromet(tx, {
      articleId: i.articleId,
      warehouseId: doc.skladisteId,
      datum,
      kolicina: Number(i.kolicina),
      vrsta: "ulaz",
      refId: doc.id,
      userId,
    });
    if (brojevi.length) {
      await tx.insert(schema.serialNumbers).values(
        brojevi.map((broj) => ({
          articleId: i.articleId!,
          warehouseId: doc.skladisteId!,
          broj,
          refId: doc.id,
        })),
      );
    }
  }
}

// Zaokruzivanje predloga na kraju obracuna (brief 8.5)
function zaokruzi(predlog: number, min: number | null, korak: number | null) {
  if (predlog <= 0) return 0;
  let n = predlog;
  if (min && n < min) n = min;
  if (korak && korak > 0) n = Math.ceil(n / korak) * korak;
  return n;
}

const obracunSchema = z.object({
  dobavljacId: z.number(),
  datumOd: z.string().nullable().default(null),
  datumDo: z.string().nullable().default(null),
  statusi: z.array(z.string()).default(["u obradi"]),
  skladista: z.array(z.number()).default([]),
  zaLager: z.boolean().default(false),
  od: z.enum(["min", "opt", "max"]).default("min"),
  dop: z.enum(["min", "opt", "max"]).default("opt"),
  prijemni: z.array(z.number()).default([]),
});

export async function nabavkaRoutes(app: FastifyInstance) {
  const read = requireAnyPrivilege(DOC_MODULI, "read");

  // Carobnjak "Obracun narudzbina" (brief 8.5) - vraca tabelu predloga
  app.post("/api/porudzbine/obracun", { preHandler: read }, async (req, reply) => {
    const parsed = obracunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    const p = parsed.data;

    const artikli = await db
      .select()
      .from(schema.articles)
      .where(and(eq(schema.articles.dobavljacId, p.dobavljacId), eq(schema.articles.active, true)));
    const artikalPoId = new Map(artikli.map((a) => [a.id, a]));
    if (!artikli.length) return { rows: [] };

    // prolaz 1: stavke aktivnih predracuna po filterima (brief 8.5)
    const uslovi = [eq(schema.documents.tip, "predracun"), inArray(schema.documents.status, p.statusi)];
    if (p.datumOd) uslovi.push(gte(schema.documents.datum, new Date(p.datumOd)));
    if (p.datumDo) uslovi.push(lte(schema.documents.datum, new Date(`${p.datumDo.slice(0, 10)}T23:59:59.999Z`)));
    const stavkePredracuna = p.statusi.length
      ? await db
          .select({
            predracunId: schema.documents.id,
            broj: schema.documents.broj,
            klijentNaziv: schema.documents.klijentNaziv,
            articleId: schema.documentItems.articleId,
            kolicina: schema.documentItems.kolicina,
            prenetaKolicina: schema.documentItems.prenetaKolicina,
          })
          .from(schema.documentItems)
          .innerJoin(schema.documents, eq(schema.documentItems.documentId, schema.documents.id))
          .where(and(...uslovi))
      : [];

    // vec poruceno po (predracun, artikal) - evidencija (brief 8.5)
    const poruceno = await db
      .select({
        predracunId: schema.porucenoPoPredracunu.predracunId,
        articleId: schema.porucenoPoPredracunu.articleId,
        kolicina: sql<string>`sum(${schema.porucenoPoPredracunu.kolicina})`,
      })
      .from(schema.porucenoPoPredracunu)
      .groupBy(schema.porucenoPoPredracunu.predracunId, schema.porucenoPoPredracunu.articleId);
    const porucenoMapa = new Map(poruceno.map((r) => [`${r.predracunId}:${r.articleId}`, Number(r.kolicina)]));

    // potrebe po artiklu, razlozeno po predracunima; spakovana kolicina (preneta na
    // otpremnice, brief 8.8) se odbija od potrebe
    const potrebePoArtiklu = new Map<number, Potreba[]>();
    for (const s of stavkePredracuna) {
      if (!s.articleId || !artikalPoId.has(s.articleId)) continue;
      const vecPoruceno = porucenoMapa.get(`${s.predracunId}:${s.articleId}`) ?? 0;
      const neto = Number(s.kolicina) - Number(s.prenetaKolicina);
      const lista = potrebePoArtiklu.get(s.articleId) ?? [];
      const postojeca = lista.find((x) => x.predracunId === s.predracunId);
      if (postojeca) postojeca.kolicina += neto;
      else lista.push({ predracunId: s.predracunId, broj: s.broj, klijentNaziv: s.klijentNaziv, kolicina: neto - vecPoruceno });
      potrebePoArtiklu.set(s.articleId, lista);
    }
    for (const [aid, lista] of potrebePoArtiklu) {
      const preostale = lista.filter((x) => x.kolicina > 0);
      if (preostale.length) potrebePoArtiklu.set(aid, preostale);
      else potrebePoArtiklu.delete(aid);
    }

    // kolicine sa izabranih prijemnih dokumenata (porudzbine/pripreme)
    const prijemnoPoArtiklu = new Map<number, number>();
    if (p.prijemni.length) {
      const prijemneStavke = await db
        .select({ articleId: schema.documentItems.articleId, kolicina: schema.documentItems.kolicina })
        .from(schema.documentItems)
        .where(inArray(schema.documentItems.documentId, p.prijemni));
      for (const s of prijemneStavke) {
        if (!s.articleId) continue;
        prijemnoPoArtiklu.set(s.articleId, (prijemnoPoArtiklu.get(s.articleId) ?? 0) + Number(s.kolicina));
      }
    }

    // min/opt/max nivoi po izabranim skladistima
    const nivoi = p.skladista.length
      ? await db
          .select()
          .from(schema.articleStockLevels)
          .where(inArray(schema.articleStockLevels.warehouseId, p.skladista))
      : [];

    // lager na kraj danasnjeg dana - hvata i promete knjizene u podne UTC
    const sad = new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);
    const rezultat = [];
    // prolaz 2 obuhvata sve ostale artikle dobavljaca samo za lager (brief 8.5)
    const kandidati = p.zaLager ? artikli.map((a) => a.id) : [...potrebePoArtiklu.keys()];
    for (const aid of kandidati) {
      const a = artikalPoId.get(aid)!;
      const potrebeLista = potrebePoArtiklu.get(aid) ?? [];
      const potrebe = potrebeLista.reduce((s, x) => s + x.kolicina, 0);
      // ponytail: stanje po skladistu u petlji - dovoljno za realan broj artikala
      let lager = 0;
      for (const wid of p.skladista) lager += await stanjeNaDan(db, aid, wid, sad);
      const prijemno = prijemnoPoArtiklu.get(aid) ?? 0;
      const lagerUkupno = lager + prijemno;

      const poruciZaKupce = Math.max(0, potrebe - lagerUkupno);
      const zalihaNakon = Math.max(0, lagerUkupno - potrebe);
      const mojiNivoi = nivoi.filter((n) => n.articleId === aid);
      const dopunaOd = mojiNivoi.reduce((s, n) => s + Number(n[p.od] ?? 0), 0);
      const dopunaDo = mojiNivoi.reduce((s, n) => s + Number(n[p.dop] ?? 0), 0);
      const poruciZaLager = p.zaLager && zalihaNakon < dopunaOd ? dopunaDo - zalihaNakon : 0;

      if (potrebe <= 0 && poruciZaLager <= 0) continue;
      const predlog = zaokruzi(
        poruciZaKupce + poruciZaLager,
        a.minPorucivanje !== null ? Number(a.minPorucivanje) : null,
        a.korakPorucivanja !== null ? Number(a.korakPorucivanja) : null,
      );
      rezultat.push({
        articleId: aid,
        ident: a.ident,
        naziv: a.naziv,
        predlog,
        potrebe,
        potrebeLista,
        lager,
        prijemno,
        poruciZaKupce,
        dopunaOd,
        dopunaDo,
        zalihaNakon,
        poruciZaLager,
        dobavljacevaCena: a.dobavljacevaCena !== null ? Number(a.dobavljacevaCena) : null,
        dobavljacevaValuta: a.dobavljacevaValuta,
        ocekivaniPopust: a.ocekivaniPopust !== null ? Number(a.ocekivaniPopust) : 0,
        porezId: a.porezId,
      });
    }
    rezultat.sort((x, y) => x.ident.localeCompare(y.ident));
    return { rows: rezultat };
  });

  // Lista porudzbina/priprema za "uracunaj prijemne dokumente" (brief 8.5)
  app.get("/api/porudzbine/prijemni", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.documents.id,
        broj: schema.documents.broj,
        tip: schema.documents.tip,
        datum: schema.documents.datum,
        status: schema.documents.status,
        klijentId: schema.documents.klijentId,
        klijentNaziv: schema.documents.klijentNaziv,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.tip, ["porudzbina", "priprema_uvoza"]))
      .orderBy(asc(schema.documents.id));
  });
}
