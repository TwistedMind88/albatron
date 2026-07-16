import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Lookup } from "./Liste";

interface Defaults {
  rokVazenja?: number;
  nacinPlacanjaId?: number | null;
  paritetId?: number | null;
}

// Podrazumevani izbori za dokumente (brief 11.4).
// Prioritet pri upotrebi: vrednost iz subjekta > ova podesavanja.
export function PodrazumevaniIzbori() {
  const [d, setD] = useState<Defaults>({});
  const [saved, setSaved] = useState(false);

  const liste = useQuery({ queryKey: ["liste"], queryFn: () => api<Lookup[]>("/api/liste") });
  const naciniPlacanja = (liste.data ?? []).filter((l) => l.kind === "nacin_placanja" && l.active);
  const pariteti = (liste.data ?? []).filter((l) => l.kind === "paritet" && l.active);

  useEffect(() => {
    api<Defaults>("/api/podrazumevani-izbori").then(setD);
  }, []);

  async function save() {
    await api("/api/podrazumevani-izbori", { method: "PUT", body: d });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ maxWidth: 400, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Podrazumevani izbori za dokumente</h1>
      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        Koriste se kad subjekat nema svoju vrednost (prioritet: subjekat, pa ova podešavanja).
      </p>
      <label className="field">
        Rok važenja dokumenta (dana)
        <input
          className="input"
          inputMode="numeric"
          value={d.rokVazenja ?? ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            setD({ ...d, rokVazenja: v === "" ? undefined : Number(v) });
          }}
        />
      </label>
      <label className="field">
        Način plaćanja
        <select
          className="input"
          value={d.nacinPlacanjaId ?? ""}
          onChange={(e) => setD({ ...d, nacinPlacanjaId: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">-</option>
          {naciniPlacanja.map((n) => (
            <option key={n.id} value={n.id}>
              {n.internalValue}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Paritet
        <select
          className="input"
          value={d.paritetId ?? ""}
          onChange={(e) => setD({ ...d, paritetId: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">-</option>
          {pariteti.map((p) => (
            <option key={p.id} value={p.id}>
              {p.internalValue}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
      </div>
    </div>
  );
}
