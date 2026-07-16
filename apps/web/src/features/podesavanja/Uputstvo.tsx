import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PLACEHOLDERS, PLACEHOLDER_GRUPE } from "@albatron/shared";
import { api, apiFetch, fajlUrl, ApiError } from "../../api";

interface UputstvoDok {
  id: number;
  naziv: string;
  filename: string;
  sistemsko: boolean;
}

// Uputstvo (brief 11.11, faza 16 RP8): tab Dokumenti (PDF uputstva) + tab Placeholderi
export function Uputstvo() {
  const [tab, setTab] = useState<"dokumenti" | "placeholderi">("dokumenti");
  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 17, margin: "0 0 12px" }}>Uputstvo</h1>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--line)" }}>
        <TabDugme aktivan={tab === "dokumenti"} onClick={() => setTab("dokumenti")}>Dokumenti</TabDugme>
        <TabDugme aktivan={tab === "placeholderi"} onClick={() => setTab("placeholderi")}>Placeholderi</TabDugme>
      </div>
      {tab === "dokumenti" ? <Dokumenti /> : <Placeholderi />}
    </div>
  );
}

function TabDugme({ aktivan, onClick, children }: { aktivan: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: "none",
        padding: "6px 12px",
        fontSize: 13,
        cursor: "pointer",
        borderBottom: aktivan ? "2px solid var(--accent)" : "2px solid transparent",
        color: aktivan ? "var(--ink)" : "var(--ink-2)",
        fontWeight: aktivan ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Dokumenti() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["uputstva"], queryFn: () => api<UputstvoDok[]>("/api/uputstva") });
  const lista = query.data ?? [];
  const [naziv, setNaziv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function upload() {
    setError("");
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Izaberite PDF fajl");
    const fd = new FormData();
    fd.append("naziv", naziv.trim());
    fd.append("fajl", file);
    try {
      const res = await apiFetch("/api/uputstva", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Greška pri upload-u");
      }
      setNaziv("");
      if (fileRef.current) fileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["uputstva"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Greška");
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 12 }}>
        PDF uputstva za korišćenje programa. Klik na naziv otvara dokument.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="naziv (opciono, podrazumevano ime fajla)"
          value={naziv}
          onChange={(e) => setNaziv(e.target.value)}
        />
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ fontSize: 12 }} />
        <button className="btn primary" onClick={upload}>Dodaj uputstvo</button>
      </div>
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      <table className="data" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Naziv</th>
            <th style={{ width: 90 }}>Vrsta</th>
            <th style={{ width: 70 }} />
          </tr>
        </thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id}>
              <td>
                <a className="link" href={fajlUrl(`/api/uputstva/${d.id}`)} target="_blank" rel="noreferrer">{d.naziv}</a>
              </td>
              <td style={{ color: "var(--ink-2)" }}>{d.sistemsko ? "Sistemsko" : "Korisničko"}</td>
              <td>
                {!d.sistemsko && (
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: "1px 6px" }}
                    onClick={async () => {
                      if (!window.confirm(`Obrisati uputstvo "${d.naziv}"?`)) return;
                      try {
                        await api(`/api/uputstva/${d.id}`, { method: "DELETE" });
                        await qc.invalidateQueries({ queryKey: ["uputstva"] });
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : "Greška");
                      }
                    }}
                  >
                    Obriši
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!lista.length && (
            <tr>
              <td colSpan={3} style={{ color: "var(--ink-2)", fontSize: 12 }}>Nema uputstava.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Placeholderi() {
  const grupe = Object.entries(PLACEHOLDER_GRUPE) as [keyof typeof PLACEHOLDER_GRUPE, string][];
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 12 }}>
        Dinamička placeholder polja za šablone izveštaja i mail template. U šablonu se pišu u
        vitičastim zagradama, npr. {"{doc_broj}"}.
      </p>
      {grupe.map(([grupa, label]) => (
        <div key={grupa} style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{label}</h2>
          <table className="data" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 220 }}>Polje</th>
                <th>Opis</th>
              </tr>
            </thead>
            <tbody>
              {PLACEHOLDERS.filter((p) => p.grupa === grupa).map((p) => (
                <tr key={p.key}>
                  <td style={{ fontFamily: "monospace" }}>{`{${p.key}}`}</td>
                  <td>{p.opis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
