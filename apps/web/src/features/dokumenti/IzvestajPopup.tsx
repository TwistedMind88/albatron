import { useEffect, useState } from "react";
import { api, apiFetch, ApiError } from "../../api";
import { sacuvajFajl } from "../../download";

// Pregled izvestaja (brief 7.7): dugmici na vrhu, max dimenzije + scroll,
// eksport PDF/Word/PNG i slanje maila (brief 7.8)

interface Sablon {
  id: number;
  docType: string;
  naziv: string;
  isDefault: boolean;
}

interface Prilog {
  id: number;
  filename: string;
  autoAttach: boolean;
  artikal: string;
}

export function IzvestajPopup({
  docId,
  tip,
  broj,
  kontaktEmail,
  sablonId,
  baza = "/api/dokumenti",
  onClose,
}: {
  docId: number;
  tip: string;
  broj: string;
  kontaktEmail: string;
  sablonId?: number;
  // prenos (faza 16, RP2) koristi "/api/prenosi"; mail je dostupan samo za dokumente
  baza?: string;
  onClose: () => void;
}) {
  const [sabloni, setSabloni] = useState<Sablon[]>([]);
  const [aktivni, setAktivni] = useState<number | undefined>(sablonId);
  const [html, setHtml] = useState("");
  const [mail, setMail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Sablon[]>(`/api/sabloni?tip=${tip}`).then(setSabloni).catch(() => setSabloni([]));
  }, [tip]);

  useEffect(() => {
    const q = aktivni ? `?sablon=${aktivni}` : "";
    api<{ html: string; sablonId: number }>(`${baza}/${docId}/izvestaj${q}`)
      .then((r) => {
        setHtml(r.html);
        setAktivni(r.sablonId);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Greška pri generisanju"));
  }, [docId, aktivni]);

  // window.open ne radi u Tauri webview-u (i popup blockeri ga gutaju) - preuzimanje kroz blob
  async function eksport(format: string) {
    setError("");
    const q = new URLSearchParams({ format, ...(aktivni ? { sablon: String(aktivni) } : {}) });
    try {
      const res = await apiFetch(`${baza}/${docId}/izvestaj-eksport?${q}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Greska ${res.status}`);
      }
      const blob = await res.blob();
      await sacuvajFajl(`${broj.replace(/[^\w-]/g, "_")}.${format}`, blob);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Izvoz nije uspeo");
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: "min(900px, 94vw)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, marginRight: "auto" }}>Izveštaj {broj}</h2>
          <select className="input" style={{ width: 160 }} value={aktivni ?? ""} onChange={(e) => setAktivni(Number(e.target.value))}>
            {sabloni.map((s) => (
              <option key={s.id} value={s.id}>
                {s.naziv}
                {s.isDefault ? " (podrazumevani)" : ""}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => eksport("pdf")}>PDF</button>
          <button className="btn" onClick={() => eksport("docx")}>Word</button>
          <button className="btn" onClick={() => eksport("png")}>PNG</button>
          {baza === "/api/dokumenti" && (
            <button className="btn primary" onClick={() => setMail(true)}>Pošalji mail</button>
          )}
          <button className="btn" onClick={onClose}>Zatvori</button>
        </div>
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--line)", background: "#888" }}>
          <iframe title="izvestaj" sandbox="" srcDoc={html} style={{ width: "100%", height: "70vh", border: 0, background: "#fff" }} />
        </div>
        {mail && (
          <MailPopup docId={docId} broj={broj} tip={tip} kontaktEmail={kontaktEmail} sablon={aktivni ?? null} onClose={() => setMail(false)} />
        )}
      </div>
    </div>
  );
}

function MailRed({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
      <span style={{ width: 52, fontSize: 12 }}>{label}</span>
      <input className="input" style={{ flex: 1 }} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Klasican mail prozor (brief 7.8): To/BCC/subject/body + prilozi
function MailPopup({
  docId,
  broj,
  tip,
  kontaktEmail,
  sablon,
  onClose,
}: {
  docId: number;
  broj: string;
  tip: string;
  kontaktEmail: string;
  sablon: number | null;
  onClose: () => void;
}) {
  const [to, setTo] = useState(kontaktEmail);
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(`${tip === "predracun" ? "Predračun" : tip.charAt(0).toUpperCase() + tip.slice(1)} ${broj}`);
  const [body, setBody] = useState("");
  const [prilozi, setPrilozi] = useState<Prilog[]>([]);
  const [fajlovi, setFajlovi] = useState<File[]>([]);
  const [izabrani, setIzabrani] = useState<Set<number>>(new Set());
  const [biranje, setBiranje] = useState(false);
  const [status, setStatus] = useState<"" | "saljem" | "poslato">("");
  const [error, setError] = useState("");

  useEffect(() => {
    // BCC i body template iz profila (podesavanja, brief 7.8)
    api<{ smtp: { bcc?: string; bodyTemplate?: string } | null }>("/api/moj-profil")
      .then((p) => {
        setBcc(p.smtp?.bcc ?? "");
        setBody(p.smtp?.bodyTemplate ?? "");
      })
      .catch(() => undefined);
    api<Prilog[]>(`/api/dokumenti/${docId}/prilozi`)
      .then((p) => {
        setPrilozi(p);
        setIzabrani(new Set(p.filter((x) => x.autoAttach).map((x) => x.id)));
      })
      .catch(() => setPrilozi([]));
  }, [docId]);

  async function posalji() {
    setError("");
    setStatus("saljem");
    try {
      const fd = new FormData();
      fd.append("to", to);
      fd.append("bcc", bcc);
      fd.append("subject", subject);
      fd.append("body", body);
      if (sablon !== null) fd.append("sablon", String(sablon));
      fd.append("prilogIds", JSON.stringify([...izabrani]));
      for (const f of fajlovi) fd.append("fajlovi", f);
      const res = await apiFetch(`/api/dokumenti/${docId}/posalji-mail`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, data?.error ?? "Slanje nije uspelo");
      }
      setStatus("poslato");
    } catch (e) {
      setStatus("");
      setError(e instanceof ApiError ? e.message : "Slanje nije uspelo");
    }
  }

  const brojPriloga = izabrani.size + fajlovi.length + 1; // +1 za PDF izvestaja

  return (
    <div className="overlay" style={{ zIndex: 30 }}>
      <div className="popup" style={{ width: "min(560px, 92vw)", maxHeight: "88vh", overflow: "auto" }}>
        <h2>Novi mail</h2>
        <MailRed label="To" value={to} onChange={setTo} />
        <MailRed label="BCC" value={bcc} onChange={setBcc} />
        <MailRed label="Naslov" value={subject} onChange={setSubject} />
        <textarea
          className="input"
          style={{ width: "100%", minHeight: 160, resize: "vertical", marginBottom: 8 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p style={{ fontSize: 12, margin: "0 0 8px" }}>
          Prilozi: PDF izveštaja{izabrani.size > 0 && ` + ${izabrani.size} dok.`}
          {fajlovi.length > 0 && ` + ${fajlovi.length} fajl`} ({brojPriloga}){" "}
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setBiranje(true)}>
            Okači dokumente
          </button>
          <label className="btn" style={{ marginLeft: 6, cursor: "pointer" }}>
            Dodaj fajl
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                setFajlovi([...fajlovi, ...Array.from(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </label>
        </p>
        {fajlovi.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px", fontSize: 12 }}>
            {fajlovi.map((f, i) => (
              <li key={i} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                <span style={{ flex: 1 }}>{f.name}</span>
                <button className="btn" onClick={() => setFajlovi(fajlovi.filter((_, j) => j !== i))}>
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        {status === "poslato" && <p style={{ fontSize: 12, color: "green" }}>Mail poslat.</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>{status === "poslato" ? "Zatvori" : "Otkaži"}</button>
          <button className="btn primary" disabled={status === "saljem"} onClick={posalji}>
            {status === "saljem" ? "Slanje..." : "Pošalji"}
          </button>
        </div>
        {biranje && (
          <div className="overlay" style={{ zIndex: 40 }}>
            <div className="popup" style={{ width: "min(480px, 90vw)", maxHeight: "80vh", overflow: "auto" }}>
              <h2>Dokumenti artikala</h2>
              {prilozi.length === 0 && <p style={{ fontSize: 12 }}>Artikli sa dokumenta nemaju dokumenata.</p>}
              {prilozi.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={izabrani.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(izabrani);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setIzabrani(next);
                    }}
                  />
                  {p.filename} <span className="subtle">({p.artikal})</span>
                </label>
              ))}
              <div className="actions">
                <button className="btn primary" onClick={() => setBiranje(false)}>U redu</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
