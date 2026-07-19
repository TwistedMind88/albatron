import { useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionUser } from "@albatron/shared";
import { api } from "../../api";
import { KorisniciPage } from "../korisnici/KorisniciPage";
import { ProfilFirme } from "./ProfilFirme";
import { MojProfil } from "./MojProfil";
import { Izgled } from "./Izgled";
import { MeniEditor } from "./MeniEditor";
import { Liste } from "./Liste";
import { PodrazumevaniIzbori } from "./PodrazumevaniIzbori";
import { Kategorije } from "./Kategorije";
import { Numeracija } from "./Numeracija";
import { Sabloni } from "./Sabloni";
import { Moduli, SkladistaSekcija } from "./Moduli";
import { UpitSablon } from "./UpitSablon";
import { AutoUpdate } from "./AutoUpdate";
import { Uputstvo } from "./Uputstvo";

// Layout podesavanja (brief 11): vertikalni meni pored glavnog sidebara,
// sadrzaj desno, puna visina
const SECTIONS: { id: string; label: string; el: ComponentType; adminOnly?: boolean }[] = [
  { id: "profil-firme", label: "Profil firme", el: ProfilFirme },
  { id: "profil", label: "Profil", el: MojProfil },
  { id: "izgled", label: "Izgled (tema)", el: Izgled },
  { id: "meni", label: "Levi meni", el: MeniEditor },
  { id: "liste", label: "Liste predefinisanih izbora", el: Liste },
  { id: "podrazumevani", label: "Podrazumevani izbori", el: PodrazumevaniIzbori },
  { id: "kategorije", label: "Kategorije artikala", el: Kategorije },
  { id: "numeracija", label: "Numeracija dokumenata", el: Numeracija },
  { id: "sabloni", label: "Šabloni izveštaja", el: Sabloni },
  { id: "moduli", label: "Moduli", el: Moduli },
  { id: "skladista", label: "Skladišta", el: SkladistaSekcija },
  // korisnici preseljeni iz sidebara (faza 16, st. 48); vidi samo admin
  { id: "korisnici", label: "Korisnici", el: KorisniciPage, adminOnly: true },
  { id: "upit-sablon", label: "Upit dobavljača", el: UpitSablon, adminOnly: true },
  { id: "auto-update", label: "Automatsko ažuriranje", el: AutoUpdate, adminOnly: true },
  { id: "uputstvo", label: "Uputstvo", el: Uputstvo },
];

export function PodesavanjaPage() {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  const me = useQuery({ queryKey: ["auth-me"], queryFn: () => api<SessionUser>("/api/auth/me") });
  const vidljive = SECTIONS.filter((s) => !s.adminOnly || me.data?.isAdmin);
  const section = vidljive.find((s) => s.id === active) ?? vidljive[0]!;
  const El = section.el;

  return (
    <div style={{ display: "flex", gap: 0, margin: "-14px -16px", height: "calc(100% + 28px)" }}>
      <div
        style={{
          width: 200,
          flexShrink: 0,
          borderRight: "1px solid var(--line)",
          background: "var(--surface)",
          padding: "10px 6px",
        }}
      >
        {vidljive.map((s) => (
          <div
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              fontSize: "12.5px",
              fontWeight: s.id === active ? 600 : 400,
              background: s.id === active ? "var(--accent-soft)" : undefined,
              color: s.id === active ? "var(--accent-ink)" : "var(--ink)",
            }}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
        <El />
      </div>
    </div>
  );
}
