// Centralna definicija placeholder polja za sablone izvestaja i mail template
// (brief 7.7, 11.11). Tabela u Podesavanja > Uputstvo se generise iz ove liste.

export type PlaceholderDef = {
  key: string; // koristi se kao {key} u sablonu
  opis: string;
  grupa: "dokument" | "klijent" | "firma" | "korisnik" | "stavke" | "prenos";
};

export const PLACEHOLDERS: PlaceholderDef[] = [
  // dokument
  { key: "doc_broj", opis: "Broj dokumenta (npr. 26-PON-00001)", grupa: "dokument" },
  { key: "doc_tip", opis: "Tip dokumenta (Ponuda, Račun, Otpremnica...)", grupa: "dokument" },
  { key: "doc_datum", opis: "Datum dokumenta", grupa: "dokument" },
  { key: "doc_vazi_do", opis: "Datum važenja (rok važenja)", grupa: "dokument" },
  { key: "doc_status", opis: "Status dokumenta", grupa: "dokument" },
  { key: "doc_valuta", opis: "Valuta dokumenta", grupa: "dokument" },
  { key: "doc_kurs", opis: "Kurs valute", grupa: "dokument" },
  { key: "doc_paritet", opis: "Paritet (puna vrednost iz liste)", grupa: "dokument" },
  { key: "doc_nacin_placanja", opis: "Način plaćanja (puna vrednost iz liste)", grupa: "dokument" },
  { key: "doc_referenca_kupca", opis: "Referenca kupca", grupa: "dokument" },
  { key: "doc_osnovica", opis: "Ukupna osnovica (bez PDV, posle popusta)", grupa: "dokument" },
  { key: "doc_popust", opis: "Ukupan iznos popusta", grupa: "dokument" },
  { key: "doc_pdv", opis: "Ukupan iznos PDV", grupa: "dokument" },
  { key: "doc_ukupno", opis: "Ukupno za naplatu (sa PDV)", grupa: "dokument" },
  // nabavni tipovi (priprema uvoza, ulaz robe) i avansni racun (faza 15 RP5)
  { key: "doc_broj_fakture", opis: "Broj fakture dobavljača (priprema uvoza, ulaz robe)", grupa: "dokument" },
  { key: "doc_datum_fakture", opis: "Datum fakture dobavljača (priprema uvoza, ulaz robe)", grupa: "dokument" },
  { key: "avans_predracun_broj", opis: "Broj predračuna (avansni račun)", grupa: "dokument" },
  { key: "avans_osnovica", opis: "Avansna osnovica bez PDV (avansni račun)", grupa: "dokument" },
  { key: "avans_iznos", opis: "Avansni iznos sa PDV (avansni račun)", grupa: "dokument" },
  // klijent (snapshot sa dokumenta)
  { key: "klijent_naziv", opis: "Interni (skraćeni) naziv klijenta", grupa: "klijent" },
  { key: "klijent_puni_naziv", opis: "Puni naziv klijenta", grupa: "klijent" },
  { key: "klijent_pib", opis: "PIB klijenta", grupa: "klijent" },
  { key: "klijent_adresa", opis: "Adresa klijenta", grupa: "klijent" },
  { key: "klijent_postanski_broj", opis: "Poštanski broj klijenta", grupa: "klijent" },
  { key: "klijent_grad", opis: "Grad klijenta", grupa: "klijent" },
  { key: "kontakt_osoba", opis: "Ime kontakt osobe", grupa: "klijent" },
  { key: "kontakt_telefon", opis: "Telefon kontakt osobe", grupa: "klijent" },
  { key: "kontakt_email", opis: "Email kontakt osobe", grupa: "klijent" },
  // aliasi za nabavne tipove - ista vrednost kao klijent_* polja (faza 15 RP5)
  { key: "dobavljac_naziv", opis: "Interni naziv dobavljača (isto kao klijent_naziv)", grupa: "klijent" },
  { key: "dobavljac_puni_naziv", opis: "Puni naziv dobavljača", grupa: "klijent" },
  { key: "dobavljac_pib", opis: "PIB dobavljača", grupa: "klijent" },
  { key: "dobavljac_adresa", opis: "Adresa dobavljača", grupa: "klijent" },
  { key: "dobavljac_postanski_broj", opis: "Poštanski broj dobavljača", grupa: "klijent" },
  { key: "dobavljac_grad", opis: "Grad dobavljača", grupa: "klijent" },
  // firma (profil firme iz podesavanja)
  { key: "firma_naziv", opis: "Naziv firme", grupa: "firma" },
  { key: "firma_adresa", opis: "Adresa firme", grupa: "firma" },
  { key: "firma_pib", opis: "PIB firme", grupa: "firma" },
  { key: "firma_maticni_broj", opis: "Matični broj firme", grupa: "firma" },
  { key: "firma_racuni", opis: "Žiro računi firme (svi, sa oznakama)", grupa: "firma" },
  { key: "firma_telefoni", opis: "Telefoni firme (svi, sa oznakama)", grupa: "firma" },
  { key: "firma_mailovi", opis: "Mailovi firme (svi, sa oznakama)", grupa: "firma" },
  // korisnik (referent dokumenta)
  { key: "user_ime", opis: "Puno ime referenta", grupa: "korisnik" },
  { key: "user_email", opis: "Email referenta (iz SMTP podešavanja profila)", grupa: "korisnik" },
  // stavke
  { key: "stavke_tabela", opis: "Kompletna tabela stavki (HTML), bez opcionih", grupa: "stavke" },
  { key: "opcioni_tabela", opis: "Tabela opcionih stavki (HTML), prazno ako ih nema", grupa: "stavke" },
  // prenos (faza 16, RP2): sablon tipa "prenos" koristi doc_broj/doc_datum + ova polja
  { key: "prenos_izdajno", opis: "Naziv izdajnog skladišta (samo prenos)", grupa: "prenos" },
  { key: "prenos_prijemno", opis: "Naziv prijemnog skladišta (samo prenos)", grupa: "prenos" },
  { key: "prenos_napomena", opis: "Napomena prenosa (samo prenos)", grupa: "prenos" },
];

// Faza 15 RP5: registar polja za imenovane tabele stavki ({stavke_tabela:naziv}).
// Server u render.ts ima mapu key -> (stavka) => string sa formatiranjem.
// tipovi: tipovi dokumenata kod kojih polje ima smisla; bez tipovi = svi tipovi.
const CENOVNI_TIPOVI = [
  "ponuda",
  "predracun",
  "kalkulacija",
  "porudzbina",
  "priprema_uvoza",
  "ulaz_robe",
  "otpremnica",
  "racun",
  "avansni_racun",
]; // svi osim reversa

export const STAVKA_POLJA: { key: string; label: string; tipovi?: string[] }[] = [
  { key: "rb", label: "Redni broj" },
  { key: "ident", label: "Ident" },
  { key: "naziv", label: "Naziv" },
  { key: "napomena", label: "Napomena" },
  { key: "kolicina", label: "Količina" },
  { key: "cena", label: "Cena", tipovi: CENOVNI_TIPOVI },
  { key: "popust", label: "Popust %", tipovi: CENOVNI_TIPOVI },
  { key: "pdv_stopa", label: "PDV stopa %", tipovi: CENOVNI_TIPOVI },
  { key: "osnovica", label: "Osnovica (bez PDV)", tipovi: CENOVNI_TIPOVI },
  { key: "pdv_iznos", label: "Iznos PDV", tipovi: CENOVNI_TIPOVI },
  { key: "ukupno", label: "Ukupno (sa PDV)", tipovi: CENOVNI_TIPOVI },
  { key: "rok_isporuke", label: "Rok isporuke", tipovi: ["ponuda", "predracun"] },
  { key: "serijski_brojevi", label: "Serijski brojevi", tipovi: ["revers", "ulaz_robe", "otpremnica", "racun"] },
  { key: "zemlja_porekla", label: "Zemlja porekla", tipovi: ["priprema_uvoza", "ulaz_robe"] },
  { key: "carinska_tarifa", label: "Carinska tarifa", tipovi: ["priprema_uvoza", "ulaz_robe"] },
  { key: "nabavna_cena", label: "Nabavna cena", tipovi: ["kalkulacija"] },
  // porudzbenica se salje dobavljacu - SKU iz sifarnika artikala (nije kolona na dokumentu)
  { key: "sku_dobavljaca", label: "SKU dobavljača", tipovi: ["porudzbina"] },
  // koleta - snapshot na stavci; stari dokumenti fallback preracun iz artikla (faza 17, RP5)
  { key: "koleta", label: "Koleta", tipovi: ["porudzbina", "priprema_uvoza", "ulaz_robe"] },
];

export type TabelaKolona = {
  polje: string;
  naslov: string;
  poravnanje: "left" | "center" | "right";
  sirina: string; // npr. "12%" ili "80px", prazno = auto
};

export const PLACEHOLDER_GRUPE: Record<PlaceholderDef["grupa"], string> = {
  dokument: "Dokument",
  klijent: "Klijent",
  firma: "Profil firme",
  korisnik: "Referent",
  stavke: "Stavke",
  prenos: "Prenos",
};
