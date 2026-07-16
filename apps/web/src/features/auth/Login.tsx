import { useState } from "react";
import type { SessionUser } from "@albatron/shared";
import { api, apiBase, ApiError, setApiToken } from "../../api";
import { aktivirajSesiju, napraviUrl, sacuvajSesije, ucitajSesije, type ServerSesija } from "./serverSesije";

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [serveri, setServeri] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await api<SessionUser & { token: string }>("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      setApiToken(user.token); // remote rezim - Bearer umesto cookie (stavke 21-23)
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server nije dostupan");
    } finally {
      setBusy(false);
    }
  }

  const aktivna = ucitajSesije().find((s) => s.url === apiBase);

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>Albatron</h1>
        {apiBase && (
          <p className="subtle" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
            Server: {aktivna ? aktivna.naziv : apiBase}
          </p>
        )}
        <label className="field">
          Korisnicko ime
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          Lozinka
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" disabled={busy} style={{ justifyContent: "center" }}>
          Prijava
        </button>
        <a
          className="subtle"
          style={{ fontSize: 11, marginTop: 10, textAlign: "center", cursor: "pointer", display: "block" }}
          onClick={() => setServeri(true)}
        >
          Podešavanja servera
        </a>
      </form>
      {serveri && <ServerPodesavanja onClose={() => setServeri(false)} />}
    </div>
  );
}

// Stavke 21-23: adresa+port, pamcenje poslednjih parametara, Test veze sa izborom baze,
// snimanje sesije sa auto-predlogom naziva "adresa - baza", lokalna lista sesija
function ServerPodesavanja({ onClose }: { onClose: () => void }) {
  const [sesije, setSesije] = useState<ServerSesija[]>(ucitajSesije);
  const [adresa, setAdresa] = useState(localStorage.getItem("serverAdresa") ?? "");
  const [port, setPort] = useState(localStorage.getItem("serverPort") ?? "3000");
  const [status, setStatus] = useState<{ tip: "ok" | "greska"; tekst: string } | null>(null);
  const [baze, setBaze] = useState<string[]>([]);
  const [baza, setBaza] = useState("");
  const [naziv, setNaziv] = useState<string | null>(null); // != null -> popup za naziv sesije
  const [testBusy, setTestBusy] = useState(false);

  const url = napraviUrl(adresa, port);
  // upozorenje na nesifrovan saobracaj van lokalne masine (security review)
  const nesifrovan = /^http:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(url);

  async function test() {
    setStatus(null);
    setBaze([]);
    setTestBusy(true);
    localStorage.setItem("serverAdresa", adresa);
    localStorage.setItem("serverPort", port);
    try {
      const res = await fetch(`${url}/api/server-info`);
      const info = (await res.json()) as { ok?: boolean; baze?: string[] };
      if (!info.ok) throw new Error();
      setBaze(info.baze ?? []);
      setBaza(info.baze?.[0] ?? "");
      setStatus({ tip: "ok", tekst: "Veza uspešna" });
    } catch {
      setStatus({ tip: "greska", tekst: "Server nije dostupan na datoj adresi/portu" });
    } finally {
      setTestBusy(false);
    }
  }

  function snimi() {
    const nove = [...sesije.filter((s) => s.url !== url), { naziv: naziv!.trim() || `${adresa} - ${baza}`, url, baza }];
    setSesije(nove);
    sacuvajSesije(nove);
    setNaziv(null);
  }

  function obrisi(s: ServerSesija) {
    const nove = sesije.filter((x) => x.url !== s.url);
    setSesije(nove);
    sacuvajSesije(nove);
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: "min(460px, 92vw)", maxHeight: "88vh", overflow: "auto" }}>
        <h2>Podešavanja servera</h2>

        <p style={{ fontSize: 12, margin: "0 0 4px", fontWeight: 600 }}>Sačuvane sesije</p>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 12.5,
            padding: "3px 0",
          }}
        >
          <span style={{ flex: 1 }}>Lokalni server (podrazumevano)</span>
          {apiBase === "" ? (
            <span className="subtle">aktivan</span>
          ) : (
            <button type="button" className="btn" onClick={() => aktivirajSesiju("")}>Koristi</button>
          )}
        </div>
        {sesije.map((s) => (
          <div key={s.url} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, padding: "3px 0" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.url}>
              {s.naziv}
            </span>
            {apiBase === s.url ? (
              <span className="subtle">aktivan</span>
            ) : (
              <button type="button" className="btn" onClick={() => aktivirajSesiju(s.url)}>Koristi</button>
            )}
            <button type="button" className="btn" onClick={() => obrisi(s)}>Obriši</button>
          </div>
        ))}

        <p style={{ fontSize: 12, margin: "12px 0 4px", fontWeight: 600 }}>Novi server</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Adresa (IP ili domen, npr. 192.168.1.10 ili https://erp.firma.com)"
            value={adresa}
            onChange={(e) => setAdresa(e.target.value)}
          />
          <input
            className="input"
            style={{ width: 80 }}
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          <button type="button" className="btn" disabled={!url || testBusy} onClick={test}>
            {testBusy ? "..." : "Test"}
          </button>
        </div>
        {status && (
          <p style={{ fontSize: 12, margin: "0 0 8px", color: status.tip === "greska" ? "var(--danger, #c33)" : "green" }}>
            {status.tekst}
          </p>
        )}
        {nesifrovan && baze.length > 0 && (
          <p style={{ fontSize: 11.5, margin: "0 0 8px", color: "var(--danger, #c33)" }}>
            Upozorenje: veza je nešifrovana (http) - lozinka i podaci putuju kao čist tekst.
            Koristiti samo u pouzdanoj lokalnoj mreži; za pristup preko interneta obavezno https.
          </p>
        )}
        {baze.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12 }}>Baza</span>
            <select className="input" style={{ flex: 1 }} value={baza} onChange={(e) => setBaza(e.target.value)}>
              {baze.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <button type="button" className="btn primary" onClick={() => setNaziv(`${adresa.trim()} - ${baza}`)}>
              Sačuvaj sesiju
            </button>
          </div>
        )}

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Zatvori</button>
        </div>

        {naziv !== null && (
          <div className="overlay" style={{ zIndex: 30 }}>
            <div className="popup" style={{ width: "min(380px, 90vw)" }}>
              <h2>Naziv sesije</h2>
              <input className="input" style={{ width: "100%" }} value={naziv} onChange={(e) => setNaziv(e.target.value)} autoFocus />
              <div className="actions">
                <button type="button" className="btn" onClick={() => setNaziv(null)}>Otkaži</button>
                <button type="button" className="btn primary" onClick={snimi}>Sačuvaj</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
