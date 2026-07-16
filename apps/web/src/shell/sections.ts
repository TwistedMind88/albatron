// Definicija sidebar sekcija (brief 3.1). Redosled grupa je po korisniku
// (sidebarLayout u moj-profil), ovo je podrazumevani raspored.
export interface NavItem {
  id: string;
  label: string;
  // stavka je tip dokumenta: "+" na hover otvara nov tab sa novim dokumentom (faza 16, st. 46)
  novi?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  ikona: string; // ikonica grupe za collapsed sidebar (faza 15, RP6.2)
  items: NavItem[];
}

export const DEFAULT_GROUPS: NavGroup[] = [
  {
    id: "prodaja",
    label: "Prodaja",
    ikona: "🛒",
    items: [
      { id: "ponude", label: "Ponude", novi: true },
      { id: "predracuni", label: "Predračuni", novi: true },
      { id: "reversi", label: "Reversi", novi: true },
      { id: "kalkulacije", label: "Kalkulacije", novi: true },
    ],
  },
  {
    id: "isporuka",
    label: "Isporuka",
    ikona: "🚚",
    items: [
      { id: "otpremnice", label: "Otpremnice", novi: true },
      { id: "racuni", label: "Računi", novi: true },
      { id: "avansni-racuni", label: "Avansni računi", novi: true },
    ],
  },
  {
    id: "nabavka",
    label: "Nabavka",
    ikona: "📦",
    items: [
      { id: "porudzbine", label: "Porudžbine", novi: true },
      { id: "priprema-za-uvoz", label: "Priprema za uvoz", novi: true },
      { id: "ulaz-robe", label: "Ulaz robe", novi: true },
    ],
  },
  {
    id: "sifarnici",
    label: "Šifarnici",
    ikona: "📇",
    items: [
      { id: "klijenti", label: "Klijenti" },
      { id: "dobavljaci", label: "Dobavljači" },
      { id: "artikli", label: "Artikli" },
      { id: "cenovnici", label: "Cenovnici" },
    ],
  },
  {
    id: "magacin",
    label: "Magacin",
    ikona: "🏬",
    items: [{ id: "prenosi", label: "Prenosi" }],
  },
  {
    id: "pregled",
    label: "Pregled",
    ikona: "📊",
    items: [
      { id: "obracuni", label: "Obračuni" },
      { id: "uplate", label: "Uplate" },
      { id: "projekti", label: "Projekti" },
      { id: "podesavanja", label: "Podešavanja" },
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
