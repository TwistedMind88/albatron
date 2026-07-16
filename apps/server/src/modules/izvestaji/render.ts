// Engine placeholdera (brief 7.7): popunjava {polje} u HTML sablonu podacima dokumenta.
// Lista polja je centralno definisana u @albatron/shared (PLACEHOLDERS).
import fs from "node:fs";
import { asc, eq, inArray } from "drizzle-orm";
import type { TabelaKolona } from "@albatron/shared";
import { db, schema } from "../../db/index.js";

export const TIP_LABEL: Record<string, string> = {
  ponuda: "Ponuda",
  predracun: "Predračun",
  revers: "Revers",
  kalkulacija: "Kalkulacija",
  porudzbina: "Porudžbina",
  priprema_uvoza: "Priprema za uvoz",
  ulaz_robe: "Ulaz robe",
  otpremnica: "Otpremnica",
  racun: "Račun",
  avansni_racun: "Avansni račun",
  prenos: "Prenos",
};

function fmtBroj(n: number) {
  return n.toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDatum(d: Date | null) {
  return d ? d.toLocaleDateString("sr-RS") : "";
}
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function labeledList(v: unknown) {
  if (!Array.isArray(v)) return "";
  return (v as { label?: string; value?: string }[])
    .map((x) => [x.label, x.value].filter(Boolean).join(": "))
    .join("; ");
}

// Vraca mapu placeholder -> vrednost za dokument (bez stavke_tabela ako je izostavljena)
export async function placeholderVrednosti(docId: number): Promise<Record<string, string> | null> {
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, docId));
  if (!doc) return null;

  const items = await db
    .select()
    .from(schema.documentItems)
    .where(eq(schema.documentItems.documentId, docId))
    .orderBy(asc(schema.documentItems.pozicija));

  const [firma] = await db.select().from(schema.companyProfile);
  const referent = doc.referentId
    ? (await db.select().from(schema.users).where(eq(schema.users.id, doc.referentId)))[0]
    : undefined;

  // puna (externa) vrednost za paritet i nacin placanja
  async function externa(kind: string, internal: string) {
    if (!internal) return "";
    const rows = await db
      .select({ e: schema.lookups.externalValue, i: schema.lookups.internalValue })
      .from(schema.lookups)
      .where(eq(schema.lookups.kind, kind));
    const hit = rows.find((r) => r.i === internal);
    return hit?.e || internal;
  }

  // ukupni iznosi - opcione stavke (ponuda, brief 8.1) se ne uracunavaju
  let osnovica = 0;
  let popust = 0;
  let pdv = 0;
  for (const s of items) {
    if (s.opcioni) continue;
    const kol = Number(s.kolicina);
    const cena = Number(s.cena);
    const pop = Number(s.popust);
    const stopa = Number(s.porezStopa);
    const osn = cena * (1 - pop / 100) * kol;
    osnovica += osn;
    popust += cena * (pop / 100) * kol;
    pdv += osn * (stopa / 100);
  }

  // Opcione stavke (ponuda, brief 8.1) idu u posebnu tabelu ispod obracuna, bez suma
  const stopaKolona = items.some((s) => Number(s.porezStopa) > 0);
  function tabela(lista: typeof items) {
    const redovi = lista
      .map((s, i) => {
        const osn = Number(s.cena) * (1 - Number(s.popust) / 100) * Number(s.kolicina);
        const ukupno = osn * (1 + Number(s.porezStopa) / 100);
        return `<tr>
<td>${i + 1}</td>
<td>${esc(s.ident)}</td>
<td>${esc(s.naziv)}${s.napomena ? `<br/><small>${esc(s.napomena)}</small>` : ""}</td>
<td class="num">${fmtBroj(Number(s.kolicina))}</td>
<td class="num">${fmtBroj(Number(s.cena))}</td>
<td class="num">${fmtBroj(Number(s.popust))}%</td>
${stopaKolona ? `<td class="num">${fmtBroj(Number(s.porezStopa))}%</td>` : ""}
<td class="num">${fmtBroj(ukupno)}</td>
</tr>`;
      })
      .join("\n");
    return `<table class="stavke" border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
<thead><tr><th>#</th><th>Ident</th><th>Naziv</th><th>Kol.</th><th>Cena</th><th>Popust</th>${stopaKolona ? "<th>PDV</th>" : ""}<th>Ukupno</th></tr></thead>
<tbody>${redovi}</tbody>
</table>`;
  }

  const redovne = items.filter((s) => !s.opcioni);
  const opcione = items.filter((s) => s.opcioni);
  const stavkeTabela = tabela(redovne);
  const opcioniTabela = opcione.length
    ? `<h3 style="margin:16px 0 4px">Opcioni artikli</h3>\n${tabela(opcione)}`
    : "";

  const smtp = (referent?.smtp ?? null) as { fromEmail?: string } | null;

  return {
    doc_broj: esc(doc.broj),
    doc_tip: TIP_LABEL[doc.tip] ?? doc.tip,
    doc_datum: fmtDatum(doc.datum),
    doc_vazi_do: fmtDatum(doc.vaziDo),
    doc_status: esc(doc.status),
    doc_valuta: esc(doc.valuta),
    doc_kurs: doc.kurs ? fmtBroj(Number(doc.kurs)) : "",
    doc_paritet: esc(await externa("paritet", doc.paritet)),
    doc_nacin_placanja: esc(await externa("nacin_placanja", doc.nacinPlacanja)),
    doc_referenca_kupca: esc(doc.referencaKupca),
    doc_osnovica: fmtBroj(osnovica),
    doc_popust: fmtBroj(popust),
    doc_pdv: fmtBroj(pdv),
    doc_ukupno: fmtBroj(osnovica + pdv),
    doc_broj_fakture: esc(doc.brojFakture),
    doc_datum_fakture: fmtDatum(doc.datumFakture),
    avans_predracun_broj: esc(doc.avansPredracunBroj),
    avans_osnovica: doc.avansOsnovica ? fmtBroj(Number(doc.avansOsnovica)) : "",
    avans_iznos: doc.avansIznos ? fmtBroj(Number(doc.avansIznos)) : "",
    klijent_naziv: esc(doc.klijentNaziv),
    klijent_puni_naziv: esc(doc.klijentPuniNaziv),
    klijent_pib: esc(doc.klijentPib),
    klijent_adresa: esc(doc.klijentAdresa),
    klijent_postanski_broj: esc(doc.klijentPostanskiBroj),
    klijent_grad: esc(doc.klijentGrad),
    kontakt_osoba: esc(doc.kontaktOsoba),
    kontakt_telefon: esc(doc.kontaktTelefon),
    kontakt_email: esc(doc.kontaktEmail),
    // aliasi za nabavne tipove (faza 15 RP5) - isti snapshot podaci
    dobavljac_naziv: esc(doc.klijentNaziv),
    dobavljac_puni_naziv: esc(doc.klijentPuniNaziv),
    dobavljac_pib: esc(doc.klijentPib),
    dobavljac_adresa: esc(doc.klijentAdresa),
    dobavljac_postanski_broj: esc(doc.klijentPostanskiBroj),
    dobavljac_grad: esc(doc.klijentGrad),
    firma_naziv: esc(firma?.name ?? ""),
    firma_adresa: esc(firma?.address ?? ""),
    firma_pib: esc(firma?.pib ?? ""),
    firma_maticni_broj: esc(firma?.maticniBroj ?? ""),
    firma_racuni: esc(labeledList(firma?.bankAccounts)),
    firma_telefoni: esc(labeledList(firma?.phones)),
    firma_mailovi: esc(labeledList(firma?.emails)),
    user_ime: esc(referent?.fullName ?? ""),
    user_email: esc(smtp?.fromEmail ?? ""),
    stavke_tabela: stavkeTabela,
    opcioni_tabela: opcioniTabela,
  };
}

// Prenos kao standardan dokument (faza 16, RP2): adapter koji cita iz prenosi +
// prenos_stavke i vraca istu mapu placeholdera (doc_* kljucevi + prenos_* polja)
export async function placeholderVrednostiPrenos(id: number): Promise<Record<string, string> | null> {
  const [p] = await db.select().from(schema.prenosi).where(eq(schema.prenosi.id, id));
  if (!p) return null;

  const stavke = await db
    .select()
    .from(schema.prenosStavke)
    .where(eq(schema.prenosStavke.prenosId, id))
    .orderBy(asc(schema.prenosStavke.id));
  const [firma] = await db.select().from(schema.companyProfile);
  const referent = p.userId
    ? (await db.select().from(schema.users).where(eq(schema.users.id, p.userId)))[0]
    : undefined;
  const skladista = await db
    .select()
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.id, [p.izdajnoId, p.prijemnoId]));
  const nazivSkl = (sid: number) => skladista.find((s) => s.id === sid)?.naziv ?? "";

  const redovi = stavke
    .map(
      (s, i) => `<tr>
<td>${i + 1}</td>
<td>${esc(s.ident)}</td>
<td>${esc(s.naziv)}</td>
<td class="num">${fmtBroj(Number(s.kolicina))}</td>
<td>${esc(Array.isArray(s.serijskiBrojevi) ? (s.serijskiBrojevi as string[]).join(", ") : "")}</td>
<td>${esc(s.napomena)}</td>
</tr>`,
    )
    .join("\n");
  const stavkeTabela = `<table class="stavke" border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
<thead><tr><th>#</th><th>Ident</th><th>Naziv</th><th>Kol.</th><th>Serijski brojevi</th><th>Napomena</th></tr></thead>
<tbody>${redovi}</tbody>
</table>`;

  const smtp = (referent?.smtp ?? null) as { fromEmail?: string } | null;

  return {
    doc_broj: esc(p.broj),
    doc_tip: TIP_LABEL.prenos!,
    doc_datum: fmtDatum(p.datum),
    prenos_izdajno: esc(nazivSkl(p.izdajnoId)),
    prenos_prijemno: esc(nazivSkl(p.prijemnoId)),
    prenos_napomena: esc(p.napomena),
    firma_naziv: esc(firma?.name ?? ""),
    firma_adresa: esc(firma?.address ?? ""),
    firma_pib: esc(firma?.pib ?? ""),
    firma_maticni_broj: esc(firma?.maticniBroj ?? ""),
    firma_racuni: esc(labeledList(firma?.bankAccounts)),
    firma_telefoni: esc(labeledList(firma?.phones)),
    firma_mailovi: esc(labeledList(firma?.emails)),
    user_ime: esc(referent?.fullName ?? ""),
    user_email: esc(smtp?.fromEmail ?? ""),
    stavke_tabela: stavkeTabela,
    opcioni_tabela: "",
  };
}

// --- Faza 15 RP5: imenovane tabele stavki i slike u sablonima ---

type StavkaRed = typeof schema.documentItems.$inferSelect;

function stavkaOsnovica(s: StavkaRed) {
  return Number(s.cena) * (1 - Number(s.popust) / 100) * Number(s.kolicina);
}

// mapa polje -> render vrednosti (kljucevi = STAVKA_POLJA u @albatron/shared)
// skuPoArtiklu: articles.sku po articleId, za polje sku_dobavljaca (porudzbenica)
const POLJE_RENDER: Record<
  string,
  (s: StavkaRed, rb: number, skuPoArtiklu: Map<number, string>, odnosPoArtiklu: Map<number, number>) => string
> = {
  rb: (_s, rb) => String(rb),
  ident: (s) => esc(s.ident),
  naziv: (s) => esc(s.naziv),
  napomena: (s) => esc(s.napomena),
  kolicina: (s) => fmtBroj(Number(s.kolicina)),
  cena: (s) => fmtBroj(Number(s.cena)),
  popust: (s) => `${fmtBroj(Number(s.popust))}%`,
  pdv_stopa: (s) => `${fmtBroj(Number(s.porezStopa))}%`,
  osnovica: (s) => fmtBroj(stavkaOsnovica(s)),
  pdv_iznos: (s) => fmtBroj((stavkaOsnovica(s) * Number(s.porezStopa)) / 100),
  ukupno: (s) => fmtBroj(stavkaOsnovica(s) * (1 + Number(s.porezStopa) / 100)),
  rok_isporuke: (s) => esc(s.rokIsporuke),
  serijski_brojevi: (s) =>
    esc(Array.isArray(s.serijskiBrojevi) ? (s.serijskiBrojevi as string[]).join(", ") : s.serijskiBroj),
  zemlja_porekla: (s) => esc(s.zemljaPorekla),
  carinska_tarifa: (s) => esc(s.carinskaTarifa),
  nabavna_cena: (s) => (s.nabavnaCena ? fmtBroj(Number(s.nabavnaCena)) : ""),
  sku_dobavljaca: (s, _rb, skuPoArtiklu) => esc(s.articleId !== null ? (skuPoArtiklu.get(s.articleId) ?? "") : ""),
  // koleta: snapshot sa stavke; stari dokumenti (null) - fallback preracun iz artikla (faza 17, RP5)
  koleta: (s, _rb, _sku, odnosPoArtiklu) => {
    if (s.koleta !== null) return fmtBroj(Number(s.koleta));
    const odnos = s.articleId !== null ? odnosPoArtiklu.get(s.articleId) : undefined;
    return odnos ? fmtBroj(Number(s.kolicina) * odnos) : "";
  },
};

function imenovanaTabela(
  kolone: TabelaKolona[],
  lista: StavkaRed[],
  skuPoArtiklu: Map<number, string>,
  odnosPoArtiklu: Map<number, number>,
) {
  const ths = kolone
    .map((k) => `<th style="text-align:${k.poravnanje}${k.sirina ? `;width:${k.sirina}` : ""}">${esc(k.naslov)}</th>`)
    .join("");
  const redovi = lista
    .map(
      (s, i) =>
        `<tr>${kolone.map((k) => `<td style="text-align:${k.poravnanje}">${POLJE_RENDER[k.polje]?.(s, i + 1, skuPoArtiklu, odnosPoArtiklu) ?? ""}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<table class="stavke" border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
<thead><tr>${ths}</tr></thead>
<tbody>${redovi}</tbody>
</table>`;
}

// Pre popuni(): zamenjuje {slika:naziv} data URI-jem i {stavke_tabela:naziv} / {opcioni_tabela:naziv}
// imenovanim tabelama. Nepostojeca definicija/slika ostavlja placeholder netaknut.
export async function prosiriSablon(html: string, docId: number | null): Promise<string> {
  const slikaNazivi = [...new Set([...html.matchAll(/\{slika:([a-z0-9_]+)\}/g)].map((m) => m[1]!))];
  if (slikaNazivi.length) {
    const slike = await db
      .select()
      .from(schema.reportImages)
      .where(inArray(schema.reportImages.naziv, slikaNazivi));
    for (const s of slike) {
      if (!fs.existsSync(s.storedPath)) {
        console.error(`sablon slika: fajl nedostaje na disku (${s.naziv}: ${s.storedPath})`);
        continue;
      }
      const dataUri = `data:${s.mime};base64,${fs.readFileSync(s.storedPath).toString("base64")}`;
      html = html.split(`{slika:${s.naziv}}`).join(dataUri);
    }
  }

  const tabNazivi = [
    ...new Set([...html.matchAll(/\{(?:stavke_tabela|opcioni_tabela):([a-z0-9_]+)\}/g)].map((m) => m[1]!)),
  ];
  if (tabNazivi.length) {
    const defs = await db
      .select()
      .from(schema.reportTableDefs)
      .where(inArray(schema.reportTableDefs.naziv, tabNazivi));
    const items =
      docId !== null
        ? await db
            .select()
            .from(schema.documentItems)
            .where(eq(schema.documentItems.documentId, docId))
            .orderBy(asc(schema.documentItems.pozicija))
        : [];
    // sku_dobavljaca nije snapshot na stavci - cita se iz sifarnika artikala;
    // odnos zbirne JM za fallback preracun kolete na starim dokumentima (faza 17, RP5)
    let skuPoArtiklu = new Map<number, string>();
    let odnosPoArtiklu = new Map<number, number>();
    const trebaPolje = (p: string) => defs.some((d) => (d.kolone as TabelaKolona[]).some((k) => k.polje === p));
    if (trebaPolje("sku_dobavljaca") || trebaPolje("koleta")) {
      const ids = [...new Set(items.map((i) => i.articleId).filter((x): x is number => x !== null))];
      if (ids.length) {
        const arts = await db
          .select({
            id: schema.articles.id,
            sku: schema.articles.sku,
            zbirnaNasaKolicina: schema.articles.zbirnaNasaKolicina,
            zbirnaDobKolicina: schema.articles.zbirnaDobKolicina,
          })
          .from(schema.articles)
          .where(inArray(schema.articles.id, ids));
        skuPoArtiklu = new Map(arts.map((a) => [a.id, a.sku]));
        odnosPoArtiklu = new Map(
          arts
            .filter((a) => Number(a.zbirnaNasaKolicina) > 0 && Number(a.zbirnaDobKolicina) > 0)
            .map((a) => [a.id, Number(a.zbirnaDobKolicina) / Number(a.zbirnaNasaKolicina)]),
        );
      }
    }
    for (const d of defs) {
      const kolone = d.kolone as TabelaKolona[];
      const opcione = items.filter((s) => s.opcioni);
      html = html
        .split(`{stavke_tabela:${d.naziv}}`)
        .join(imenovanaTabela(kolone, items.filter((s) => !s.opcioni), skuPoArtiklu, odnosPoArtiklu));
      html = html
        .split(`{opcioni_tabela:${d.naziv}}`)
        .join(opcione.length ? `<h3 style="margin:16px 0 4px">Opcioni artikli</h3>\n${imenovanaTabela(kolone, opcione, skuPoArtiklu, odnosPoArtiklu)}` : "");
    }
  }
  return html;
}

export function popuni(html: string, vrednosti: Record<string, string>) {
  return html.replace(/\{([a-z0-9_]+)\}/g, (m, key: string) => vrednosti[key] ?? m);
}

// Dokumenti artikala sa dokumenta za mail priloge (brief 7.8):
// fajlovi artikala + fajlovi parenta varijacije, slika se preskace
export async function prilogeZaDokument(docId: number) {
  const items = await db
    .select({ articleId: schema.documentItems.articleId })
    .from(schema.documentItems)
    .where(eq(schema.documentItems.documentId, docId));
  const ids = [...new Set(items.map((i) => i.articleId).filter((x): x is number => x !== null))];
  if (!ids.length) return [];

  const clanci = await db
    .select({ id: schema.articles.id, naziv: schema.articles.naziv, parentId: schema.articles.parentId })
    .from(schema.articles)
    .where(inArray(schema.articles.id, ids));
  const sviIds = [...new Set([...ids, ...clanci.map((c) => c.parentId).filter((x): x is number => x !== null)])];

  const fajlovi = await db
    .select()
    .from(schema.articleFiles)
    .where(inArray(schema.articleFiles.articleId, sviIds));
  const nazivPoId = new Map(clanci.map((c) => [c.id, c.naziv]));
  return fajlovi
    .filter((f) => !f.isImage)
    .map((f) => ({
      id: f.id,
      filename: f.filename,
      autoAttach: f.autoAttach,
      artikal: nazivPoId.get(f.articleId) ?? "",
      storedPath: f.storedPath,
    }));
}
