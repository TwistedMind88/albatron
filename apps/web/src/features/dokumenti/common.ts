// Zajednicki tipovi i preracuni za dokumente (brief 7)

export const TIP_INFO: Record<string, { label: string; mnozina: string }> = {
  ponuda: { label: "Ponuda", mnozina: "Ponude" },
  predracun: { label: "Predračun", mnozina: "Predračuni" },
  revers: { label: "Revers", mnozina: "Reversi" },
  kalkulacija: { label: "Kalkulacija", mnozina: "Kalkulacije" },
  porudzbina: { label: "Porudžbina", mnozina: "Porudžbine" },
  priprema_uvoza: { label: "Priprema za uvoz", mnozina: "Pripreme za uvoz" },
  ulaz_robe: { label: "Ulaz robe", mnozina: "Ulazi robe" },
  otpremnica: { label: "Otpremnica", mnozina: "Otpremnice" },
  racun: { label: "Račun", mnozina: "Računi" },
  avansni_racun: { label: "Avansni račun", mnozina: "Avansni računi" },
};

// Nabavni dokumenti idu prema dobavljacu, sa nabavnim cenama (brief 8.5)
export const NABAVNI_TIPOVI = ["porudzbina", "priprema_uvoza", "ulaz_robe"];

// Filteri u pregledu dokumenata (faza 15, RP6.1): konfiguracija po tipu.
// Nove kolone u buducnosti se dodaju ovde (jedno mesto).
export interface FilterDef {
  key: string;
  label: string;
  vrsta: "multi" | "opseg";
}

const OSNOVNI_FILTERI: FilterDef[] = [
  { key: "klijentNaziv", label: "Klijent", vrsta: "multi" },
  { key: "status", label: "Status", vrsta: "multi" },
  { key: "referent", label: "Referent", vrsta: "multi" },
  { key: "referencaKupca", label: "Referenca kupca", vrsta: "multi" },
  { key: "datum", label: "Datum", vrsta: "opseg" },
];

export const FILTERI: Record<string, FilterDef[]> = Object.fromEntries(
  Object.keys(TIP_INFO).map((tip) => [
    tip,
    tip === "revers"
      ? [...OSNOVNI_FILTERI.slice(0, 2), { key: "smer", label: "Smer", vrsta: "multi" as const }, ...OSNOVNI_FILTERI.slice(2)]
      : OSNOVNI_FILTERI,
  ]),
);

export interface Potreba {
  predracunId: number;
  broj: string;
  klijentNaziv: string;
  kolicina: number;
}

export interface Stavka {
  id?: number;
  articleId: number | null;
  ident: string;
  naziv: string;
  kolicina: number;
  cena: number;
  popust: number;
  porezStopa: number;
  rokIsporuke: string;
  napomena: string;
  opcioni: boolean;
  serijskiBroj: string;
  nabavnaCena: number | null;
  kalk: Record<string, number | null> | null;
  vracenaKolicina?: number;
  potrebe: Potreba[] | null;
  zemljaPorekla: string;
  carinskaTarifa: string;
  // procenat carine - snapshot pri izboru tarife (faza 15, RP7.3)
  carinskaStopa: number | null;
  transportTrosak: number | null;
  // koleta - snapshot na stavci nabavnih dokumenata (faza 17, RP5)
  koleta: number | null;
  serijskiBrojevi: string[] | null;
  // prenos 1:1 (brief 8.9) - vodi server, klijent vraca nepromenjeno
  prenetaKolicina: number;
  // atribucija po stavci (faza 3) - server je postavlja, klijent vraca nepromenjeno
  izvorStavkaId?: number | null;
  // izracunato pri citanju (faza 3), read-only: Otpremljeno na predracunu / Fakturisano na otpremnici
  otpremljeno?: number;
  fakturisano?: number;
}

export const PRAZNA_STAVKA: Stavka = {
  articleId: null,
  ident: "",
  naziv: "",
  kolicina: 1,
  cena: 0,
  popust: 0,
  porezStopa: 0,
  rokIsporuke: "",
  napomena: "",
  opcioni: false,
  serijskiBroj: "",
  nabavnaCena: null,
  kalk: null,
  potrebe: null,
  zemljaPorekla: "",
  carinskaTarifa: "",
  carinskaStopa: null,
  transportTrosak: null,
  koleta: null,
  serijskiBrojevi: null,
  prenetaKolicina: 0,
  izvorStavkaId: null,
};

export const KALK_TROSKOVI = [
  { id: "ekoTaksa", label: "Eko taksa" },
  { id: "transport", label: "Transport" },
  { id: "spedicija", label: "Špedicija" },
  { id: "kursnaRazlika", label: "Kursna razlika" },
  { id: "carina", label: "Carina" },
] as const;

export function osnovica(s: Stavka) {
  return s.cena * (1 - s.popust / 100);
}
export function sumaBezPdv(s: Stavka) {
  return osnovica(s) * s.kolicina;
}
export function sumaSaPdv(s: Stavka) {
  return sumaBezPdv(s) * (1 + s.porezStopa / 100);
}
// nabavna cena kalkulacije: osnovica uvecana za zbir procenata svih troskova
// (troskovi se sabiraju pa se ukupan procenat dodaje na osnovicu) - ne kuca se
export function nabavnaKalk(s: Stavka) {
  const proc = KALK_TROSKOVI.reduce((acc, t) => acc + (s.kalk?.[t.id] ?? 0), 0);
  return osnovica(s) * (1 + proc / 100);
}
// prodajna cena po komadu: nabavna uvecana za marzu (kalk.marza, %)
export function prodajnaKalk(s: Stavka) {
  return nabavnaKalk(s) * (1 + (s.kalk?.marza ?? 0) / 100);
}
export function zaradaPoKomadu(s: Stavka) {
  return prodajnaKalk(s) - nabavnaKalk(s);
}
export function zaradaStavke(s: Stavka) {
  return zaradaPoKomadu(s) * s.kolicina;
}

export function jePrazna(s: Stavka) {
  return s.articleId === null && s.naziv.trim() === "";
}

export function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n)) return "";
  return n.toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Preracun cene artikla u valutu dokumenta (brief 7.4): kurs = RSD za 1 jedinicu strane valute
export function uValutuDokumenta(cena: number, valutaArtikla: string, valutaDok: string, kurs: number | null) {
  if (valutaArtikla === valutaDok || !kurs) return cena;
  if (valutaDok === "RSD") return cena * kurs;
  if (valutaArtikla === "RSD") return cena / kurs;
  return cena; // dve strane valute - bez preracuna
}
