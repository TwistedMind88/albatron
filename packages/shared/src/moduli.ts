// Registar modula (faza 14.4, stavke 2-4 + 7-8): JEDAN model - modul je ujedno
// i resurs za privilegije (grupi korisnika se po modulu dodeljuje nema/read/write),
// a na nivou firme se moduli pale/gase (stavka 2-4, appSettings.modules).
export const MODULES = [
  { id: "artikli", label: "Artikli", zavisi: [] },
  { id: "cenovnici", label: "Cenovnici", zavisi: ["artikli"] },
  { id: "klijenti", label: "Klijenti", zavisi: [] },
  { id: "dobavljaci", label: "Dobavljači", zavisi: [] },
  { id: "ponude", label: "Ponude", zavisi: ["artikli", "klijenti"] },
  { id: "predracuni", label: "Predračuni", zavisi: ["artikli", "klijenti"] },
  { id: "racuni", label: "Računi", zavisi: ["artikli", "klijenti"] },
  { id: "avansni_racuni", label: "Avansni računi", zavisi: ["racuni"] },
  { id: "otpremnice", label: "Otpremnice", zavisi: ["artikli", "klijenti"] },
  { id: "reversi", label: "Reversi", zavisi: ["artikli", "klijenti"] },
  { id: "kalkulacije", label: "Kalkulacije", zavisi: ["artikli"] },
  { id: "porudzbine", label: "Porudžbine", zavisi: ["artikli", "dobavljaci"] },
  { id: "priprema_uvoza", label: "Priprema za uvoz", zavisi: ["porudzbine"] },
  { id: "zalihe", label: "Zalihe", zavisi: ["artikli"] },
  { id: "ulaz_robe", label: "Ulaz robe", zavisi: ["zalihe", "dobavljaci"] },
  { id: "obracuni", label: "Obračuni", zavisi: [] },
  { id: "uplate", label: "Uplate", zavisi: ["klijenti"] },
  { id: "projekti", label: "Projekti", zavisi: [] },
  { id: "korisnici", label: "Korisnici", zavisi: [] },
  { id: "podesavanja", label: "Podešavanja", zavisi: [] },
] as const;

export type ModulId = (typeof MODULES)[number]["id"];

// tip dokumenta -> modul kome pripada
export const DOC_TIP_MODUL: Record<string, ModulId> = {
  ponuda: "ponude",
  predracun: "predracuni",
  revers: "reversi",
  kalkulacija: "kalkulacije",
  otpremnica: "otpremnice",
  racun: "racuni",
  avansni_racun: "avansni_racuni",
  porudzbina: "porudzbine",
  priprema_uvoza: "priprema_uvoza",
  ulaz_robe: "ulaz_robe",
};

// svi moduli koji su tipovi dokumenata
export const DOC_MODULI = Object.values(DOC_TIP_MODUL);

// sidebar sekcija -> modul (stavka 2-4: filtriranje sidebara po ukljucenim modulima)
export const NAV_MODUL: Record<string, ModulId> = {
  ponude: "ponude",
  predracuni: "predracuni",
  reversi: "reversi",
  kalkulacije: "kalkulacije",
  otpremnice: "otpremnice",
  racuni: "racuni",
  "avansni-racuni": "avansni_racuni",
  porudzbine: "porudzbine",
  "priprema-za-uvoz": "priprema_uvoza",
  "ulaz-robe": "ulaz_robe",
  klijenti: "klijenti",
  dobavljaci: "dobavljaci",
  artikli: "artikli",
  cenovnici: "cenovnici",
  prenosi: "zalihe",
  popisi: "zalihe",
  presifriranja: "zalihe",
  obracuni: "obracuni",
  uplate: "uplate",
  projekti: "projekti",
  korisnici: "korisnici",
  podesavanja: "podesavanja",
};

// moduli koji se ne mogu iskljuciti (admin bi zakljucao sam sebe)
export const OBAVEZNI_MODULI: ModulId[] = ["korisnici", "podesavanja"];
