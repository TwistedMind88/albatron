import { useEffect, useState } from "react";
import { api } from "../../api";
import Toggle from "../../components/Toggle";

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  bcc: string;
  bodyTemplate: string;
}

const EMPTY_SMTP: Smtp = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  fromName: "",
  fromEmail: "",
  bcc: "",
  bodyTemplate: "",
};

interface Imap {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  folder: string;
}

const EMPTY_IMAP: Imap = {
  host: "",
  port: 993,
  secure: true,
  user: "",
  pass: "",
  folder: "INBOX",
};

export function MojProfil() {
  const [fullName, setFullName] = useState("");
  const [smtp, setSmtp] = useState<Smtp>(EMPTY_SMTP);
  const [imap, setImap] = useState<Imap>(EMPTY_IMAP);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ status: "slanje" | "ok" | "greska"; poruka?: string } | null>(null);
  const [imapTest, setImapTest] = useState<{ status: "provera" | "ok" | "greska"; poruka?: string } | null>(null);

  useEffect(() => {
    api<{ fullName: string; smtp: Smtp | null; imap: Imap | null }>("/api/moj-profil").then((p) => {
      setFullName(p.fullName);
      if (p.smtp) setSmtp({ ...EMPTY_SMTP, ...p.smtp });
      if (p.imap) setImap({ ...EMPTY_IMAP, ...p.imap });
    });
  }, []);

  async function save() {
    await api("/api/moj-profil", { method: "PUT", body: { fullName, smtp, imap } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // proverava TRENUTNE vrednosti forme konekcijom, bez prethodnog snimanja
  async function testImap() {
    setImapTest({ status: "provera" });
    try {
      await api("/api/moj-profil/imap-test", { method: "POST", body: imap });
      setImapTest({ status: "ok" });
    } catch (e) {
      setImapTest({ status: "greska", poruka: e instanceof Error ? e.message : "Prijava nije uspela" });
    }
  }

  // salje TRENUTNE vrednosti forme, bez prethodnog snimanja (faza 15, RP1.5)
  async function testSmtp() {
    setTest({ status: "slanje" });
    try {
      await api("/api/moj-profil/smtp-test", { method: "POST", body: smtp });
      setTest({ status: "ok" });
    } catch (e) {
      setTest({ status: "greska", poruka: e instanceof Error ? e.message : "Slanje nije uspelo" });
    }
  }

  return (
    <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Profil</h1>
      <label className="field">
        Ime i prezime
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <h2 style={{ fontSize: 14, margin: "8px 0 0" }}>SMTP podešavanja (slanje mailova)</h2>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 2 }}>
          Server
          <input className="input" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Port
          <input
            className="input"
            inputMode="numeric"
            value={smtp.port}
            onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value.replace(/\D/g, "")) })}
          />
        </label>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
        <Toggle checked={smtp.secure} onChange={(v) => setSmtp({ ...smtp, secure: v })} />
        SSL/TLS
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          Korisničko ime
          <input className="input" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Lozinka
          <input
            className="input"
            type="password"
            value={smtp.pass}
            onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          Ime pošiljaoca
          <input
            className="input"
            value={smtp.fromName}
            onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Mail pošiljaoca
          <input
            className="input"
            value={smtp.fromEmail}
            onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        BCC (kopija svakog poslatog maila)
        <input className="input" value={smtp.bcc} onChange={(e) => setSmtp({ ...smtp, bcc: e.target.value })} />
      </label>
      <label className="field">
        Podrazumevani tekst maila
        <textarea
          className="input"
          style={{ minHeight: 100, resize: "vertical" }}
          value={smtp.bodyTemplate}
          onChange={(e) => setSmtp({ ...smtp, bodyTemplate: e.target.value })}
        />
      </label>
      <h2 style={{ fontSize: 14, margin: "8px 0 0" }}>IMAP podešavanja (čitanje pošte)</h2>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 2 }}>
          Server
          <input className="input" value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Port
          <input
            className="input"
            inputMode="numeric"
            value={imap.port}
            onChange={(e) => setImap({ ...imap, port: Number(e.target.value.replace(/\D/g, "")) })}
          />
        </label>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
        <Toggle checked={imap.secure} onChange={(v) => setImap({ ...imap, secure: v })} />
        SSL/TLS
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          Korisničko ime
          <input className="input" value={imap.user} onChange={(e) => setImap({ ...imap, user: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Lozinka
          <input
            className="input"
            type="password"
            value={imap.pass}
            onChange={(e) => setImap({ ...imap, pass: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        Folder
        <input className="input" value={imap.folder} onChange={(e) => setImap({ ...imap, folder: e.target.value })} />
      </label>
      <div style={{ fontSize: 11.5, opacity: 0.7 }}>
        Napomena: ne radi sa nalozima koji traže OAuth2 (Gmail, Microsoft 365 modern auth) - samo IMAP sa lozinkom.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn"
          disabled={!imap.host || !imap.user || imapTest?.status === "provera"}
          onClick={testImap}
        >
          Proveri IMAP
        </button>
        {imapTest?.status === "provera" && <span className="subtle" style={{ fontSize: 12 }}>Provera...</span>}
        {imapTest?.status === "ok" && <span style={{ color: "var(--ok)", fontSize: 12 }}>Konekcija uspešna</span>}
        {imapTest?.status === "greska" && <span style={{ color: "var(--danger)", fontSize: 12 }}>{imapTest.poruka}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
        <button className="btn" disabled={!smtp.host || !smtp.fromEmail || test?.status === "slanje"} onClick={testSmtp}>
          Pošalji test mail
        </button>
        {test?.status === "slanje" && <span className="subtle" style={{ fontSize: 12 }}>Slanje...</span>}
        {test?.status === "ok" && <span style={{ color: "var(--ok)", fontSize: 12 }}>Test mail poslat na {smtp.fromEmail}</span>}
        {test?.status === "greska" && <span style={{ color: "var(--danger)", fontSize: 12 }}>{test.poruka}</span>}
      </div>
    </div>
  );
}
