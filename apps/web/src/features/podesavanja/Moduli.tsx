import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MODULES, OBAVEZNI_MODULI, type ModulId } from "@albatron/shared";
import { api, ApiError } from "../../api";
import Toggle from "../../components/Toggle";

export interface Skladiste {
  id: number;
  naziv: string;
  isPrimary: boolean;
}

// Ukljucivanje modula (brief 12) - samo admin; skladista su izdvojena
// u posebnu sekciju podesavanja (faza 16, st. 13)
export function Moduli() {
  const qc = useQueryClient();
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<Record<ModulId, boolean>>("/api/moduli") });
  const [error, setError] = useState("");

  const stanje = moduli.data;

  // ukljucivanje pali i preduslove; iskljucivanje gasi i zavisne (tranzitivno)
  function toggle(id: ModulId, on: boolean) {
    const next: Record<string, boolean> = { ...(stanje ?? {}), [id]: on };
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of MODULES) {
        if (on && next[m.id] && m.zavisi.some((z) => !next[z])) {
          for (const z of m.zavisi) if (!next[z]) { next[z] = true; changed = true; }
        }
        if (!on && next[m.id] && m.zavisi.some((z) => !next[z])) {
          next[m.id] = false;
          changed = true;
        }
      }
    }
    setError("");
    api("/api/moduli", { method: "PUT", body: next })
      .then(() => qc.invalidateQueries({ queryKey: ["moduli"] }))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Greska"));
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 16 }}>Moduli</h1>
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      <p style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
        Isključeni moduli se ne prikazuju u meniju. Uključivanje modula automatski uključuje
        module od kojih zavisi; isključivanje gasi i zavisne module.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 16 }}>
        {MODULES.filter((m) => !OBAVEZNI_MODULI.includes(m.id)).map((m) => (
          <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <Toggle checked={stanje?.[m.id] ?? true} onChange={(v) => toggle(m.id, v)} />
            {m.label}
            {m.zavisi.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>
                (zavisi: {m.zavisi.map((z) => MODULES.find((x) => x.id === z)?.label ?? z).join(", ")})
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

// Upravljanje skladistima - posebna sekcija podesavanja (faza 16, st. 13)
export function SkladistaSekcija() {
  const qc = useQueryClient();
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<Record<ModulId, boolean>>("/api/moduli") });
  const skladista = useQuery({ queryKey: ["skladista"], queryFn: () => api<Skladiste[]>("/api/skladista") });
  const [novo, setNovo] = useState("");
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["skladista"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska");
    }
  }

  if (moduli.data && !moduli.data.zalihe) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 16 }}>Skladišta</h1>
        <p style={{ fontSize: 12, color: "var(--ink-2)" }}>
          Modul zaliha nije uključen (sekcija Moduli).
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 16 }}>Skladišta</h1>
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="tablewrap" style={{ marginBottom: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Naziv</th>
              <th>Primarno</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(skladista.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.naziv}</td>
                <td>
                  <input
                    type="radio"
                    name="primarno"
                    checked={s.isPrimary}
                    onChange={() =>
                      run(() =>
                        api(`/api/skladista/${s.id}`, { method: "PUT", body: { naziv: s.naziv, isPrimary: true } }),
                      )
                    }
                  />
                </td>
                <td>
                  {!s.isPrimary && (
                    <button
                      className="btn"
                      style={{ padding: "0 6px" }}
                      onClick={() => run(() => api(`/api/skladista/${s.id}`, { method: "DELETE" }))}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          placeholder="Naziv novog skladišta"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!novo.trim()}
          onClick={() =>
            run(async () => {
              await api("/api/skladista", { method: "POST", body: { naziv: novo.trim() } });
              setNovo("");
            })
          }
        >
          Dodaj
        </button>
      </div>
    </div>
  );
}
