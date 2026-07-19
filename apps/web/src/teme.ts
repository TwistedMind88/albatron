// Registar tema interfejsa (po korisniku, cuva se u uiPrefs.tema).
// Nove teme: dodati klasu u teme.css i stavku ovde.

export interface Tema {
  id: string;
  naziv: string;
  opis: string;
  // CSS klasa iz teme.css; prazna = podrazumevani :root iz styles.css
  klasa: string;
}

export const TEME: Tema[] = [
  { id: "standard", naziv: "Standard", opis: "Podrazumevani izgled programa", klasa: "" },
  { id: "grafit", naziv: "Grafit", opis: "Moderan svetli izgled, tamni sidebar, safirni akcenat", klasa: "tema-grafit" },
  { id: "pergament", naziv: "Pergament", opis: "Klasičan svetli izgled, papirna paleta, bordo akcenat", klasa: "tema-pergament" },
  { id: "kokpit", naziv: "Kokpit", opis: "Tamni tehnički izgled, tirkizni akcenat", klasa: "tema-kokpit" },
];

// Postavlja temu globalno (klasa na <html>)
export function primeniTemu(id: string | undefined | null) {
  const el = document.documentElement;
  for (const t of TEME) if (t.klasa) el.classList.remove(t.klasa);
  const tema = TEME.find((t) => t.id === id);
  if (tema?.klasa) el.classList.add(tema.klasa);
}
