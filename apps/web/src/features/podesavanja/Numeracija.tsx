import { useEffect, useState } from "react";
import { DOC_TYPES, formatirajBroj, podrazumevaniFormat, validirajFormat } from "@albatron/shared";
import { api, ApiError } from "../../api";

// Numeracija dokumenata (brief 14.2): format po tipu, prazno polje = podrazumevani format.
// Vazi samo za nove dokumente; brojac se resetuje svake godine po tipu.
export function Numeracija() {
  const [formati, setFormati] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Record<string, string>>("/api/numeracija").then(setFormati);
  }, []);

  async function save() {
    setError("");
    for (const d of DOC_TYPES) {
      const f = (formati[d.id] ?? "").trim();
      if (!f) continue;
      const greska = validirajFormat(f);
      if (greska) {
        setError(`${d.label}: ${greska}`);
        return;
      }
    }
    try {
      await api("/api/numeracija", { method: "PUT", body: formati });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri snimanju");
    }
  }

  function preview(tip: string) {
    const f = (formati[tip] ?? "").trim() || podrazumevaniFormat(tip);
    if (validirajFormat(f)) return "-";
    return formatirajBroj(f, new Date(), 1);
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Numeracija dokumenata</h1>
      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        Format broja po tipu dokumenta. Prazno polje koristi podrazumevani format. Važi samo za
        nove dokumente; brojač kreće od 1 svake godine, posebno po tipu.
      </p>
      <table className="table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Tip dokumenta</th>
            <th>Format</th>
            <th>Primer</th>
          </tr>
        </thead>
        <tbody>
          {DOC_TYPES.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={formati[d.id] ?? ""}
                  placeholder={podrazumevaniFormat(d.id)}
                  onChange={(e) => setFormati({ ...formati, [d.id]: e.target.value })}
                />
              </td>
              <td>{preview(d.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        Tokeni: {"{GGGG}"} godina (4 cifre), {"{GG}"} godina (2 cifre), {"{MM}"} mesec, {"{DD}"}{" "}
        dan, {"{N}"} do {"{NNNNNNNN}"} brojač (broj slova N = broj cifara). Ostali tekst je
        slobodan, npr. {"{GG}-PON-{NNNNN}"} ili {"{GGGG}-011-{NNN}"}.
      </p>
      {error && <div className="login-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
      </div>
    </div>
  );
}
