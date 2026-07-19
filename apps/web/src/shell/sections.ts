// Definicija sidebar sekcija (brief 3.1). Redosled grupa je po korisniku
// (sidebarLayout u moj-profil), ovo je podrazumevani raspored.
export interface NavItem {
  id: string;
  ikona: string; // id SVG ikonice (components/Ikona)
  label: string;
  // stavka je tip dokumenta: "+" na hover otvara nov tab sa novim dokumentom (faza 16, st. 46)
  novi?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  ikona: string; // id SVG ikonice grupe (components/Ikona)
  items: NavItem[];
}

export const DEFAULT_GROUPS: NavGroup[] = [
  {
    id: "prodaja",
    label: "Prodaja",
    ikona: "cart",
    items: [
      { id: "ponude", ikona: "doc", label: "Ponude", novi: true },
      { id: "predracuni", ikona: "doc-check", label: "Predračuni", novi: true },
      { id: "reversi", ikona: "swap", label: "Reversi", novi: true },
      { id: "kalkulacije", ikona: "calc", label: "Kalkulacije", novi: true },
    ],
  },
  {
    id: "isporuka",
    label: "Isporuka",
    ikona: "truck",
    items: [
      { id: "otpremnice", ikona: "send", label: "Otpremnice", novi: true },
      { id: "racuni", ikona: "receipt", label: "Računi", novi: true },
      { id: "avansni-racuni", ikona: "cash", label: "Avansni računi", novi: true },
    ],
  },
  {
    id: "nabavka",
    label: "Nabavka",
    ikona: "box",
    items: [
      { id: "porudzbine", ikona: "clip", label: "Porudžbine", novi: true },
      { id: "priprema-za-uvoz", ikona: "globe", label: "Priprema za uvoz", novi: true },
      { id: "ulaz-robe", ikona: "in", label: "Ulaz robe", novi: true },
    ],
  },
  {
    id: "sifarnici",
    label: "Šifarnici",
    ikona: "book",
    items: [
      { id: "klijenti", ikona: "users", label: "Klijenti" },
      { id: "dobavljaci", ikona: "factory", label: "Dobavljači" },
      { id: "artikli", ikona: "tag", label: "Artikli" },
      { id: "cenovnici", ikona: "table", label: "Cenovnici" },
    ],
  },
  {
    id: "magacin",
    label: "Magacin",
    ikona: "house",
    items: [
      { id: "prenosi", ikona: "arrows", label: "Prenosi" },
      { id: "popisi", ikona: "clip", label: "Popisi" },
      { id: "presifriranja", ikona: "swap", label: "Prešifriranja" },
    ],
  },
  {
    id: "pregled",
    label: "Pregled",
    ikona: "chart",
    items: [
      { id: "obracuni", ikona: "pie", label: "Obračuni" },
      { id: "uplate", ikona: "card", label: "Uplate" },
      { id: "projekti", ikona: "folder", label: "Projekti" },
      { id: "podesavanja", ikona: "gear", label: "Podešavanja" },
    ],
  },
];

export function findItem(sectionId: string): NavItem | undefined {
  for (const g of DEFAULT_GROUPS) {
    const item = g.items.find((i) => i.id === sectionId);
    if (item) return item;
  }
  return undefined;
}
