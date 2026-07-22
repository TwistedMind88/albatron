import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";

// Konfiguracija rezervnih kopija. Cron na serveru (scripts/backup.sh) cita ovo iz
// baze pa pravi pg_dump baze + tar storage foldera, lokalno i (opciono) na mrezni
// share preko SMB ili NFS protokola.

interface Mreza {
  tip: "" | "smb" | "nfs";
  server: string;
  deo: string;
  folder: string;
  korisnik: string;
  lozinka: string;
}
interface Konfig {
  ukljucen: boolean;
  sat: number;
  cuvajDana: number;
  lokalniDir: string;
  mreza: Mreza;
}

export function Backup() {
  const q = useQuery({ queryKey: ["backup"], queryFn: () => api<Konfig>("/api/podesavanja/backup") });
  const [k, setK] = useState<Konfig | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (q.data) setK(q.data);
  }, [q.data]);

  if (!k) return <div style={{ opacity: 0.6 }}>Učitavanje...</div>;

  function set(delta: Partial<Konfig>) {
    setK((prev) => (prev ? { ...prev, ...delta } : prev));
  }
  function setMreza(delta: Partial<Mreza>) {
    setK((prev) => (prev ? { ...prev, mreza: { ...prev.mreza, ...delta } } : prev));
  }

  async function sacuvaj() {
    setStatus("Čuvanje...");
    try {
      await api("/api/podesavanja/backup", { method: "PUT", body: k });
      setStatus("Sačuvano.");
    } catch {
      setStatus("Greška pri čuvanju.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Rezervne kopije</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
        Server u izabrano vreme pravi rezervnu kopiju baze podataka i fajlova (folder storage) u
        lokalni folder, i po želji je kopira na mrežni folder (SMB ili NFS). Starije kopije od
        zadatog broja dana se brišu.
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={k.ukljucen} onChange={(e) => set({ ukljucen: e.target.checked })} />
        Rezervne kopije uključene
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        Vreme
        <select
          className="input"
          style={{ width: "auto" }}
          value={k.sat}
          disabled={!k.ukljucen}
          onChange={(e) => set({ sat: Number(e.target.value) })}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>

      <label className="field" style={{ fontSize: 12 }}>
        Čuvaj kopije (dana)
        <input
          className="input"
          type="number"
          min={1}
          max={365}
          value={k.cuvajDana}
          onChange={(e) => set({ cuvajDana: Number(e.target.value) })}
        />
      </label>

      <label className="field" style={{ fontSize: 12 }}>
        Lokalni folder
        <input className="input" value={k.lokalniDir} onChange={(e) => set({ lokalniDir: e.target.value })} />
      </label>

      <h2 style={{ fontSize: 14, margin: "8px 0 0" }}>Mrežni folder (opciono)</h2>
      <label className="field" style={{ fontSize: 12 }}>
        Protokol
        <select
          className="input"
          value={k.mreza.tip}
          onChange={(e) => setMreza({ tip: e.target.value as Mreza["tip"] })}
        >
          <option value="">- bez mreže -</option>
          <option value="smb">SMB (Windows share)</option>
          <option value="nfs">NFS</option>
        </select>
      </label>

      {k.mreza.tip !== "" && (
        <>
          <label className="field" style={{ fontSize: 12 }}>
            Server (IP ili naziv)
            <input className="input" value={k.mreza.server} onChange={(e) => setMreza({ server: e.target.value })} />
          </label>
          <label className="field" style={{ fontSize: 12 }}>
            {k.mreza.tip === "smb" ? "Share (naziv deljenog foldera)" : "Izvoz (npr. /export/backup)"}
            <input className="input" value={k.mreza.deo} onChange={(e) => setMreza({ deo: e.target.value })} />
          </label>
          <label className="field" style={{ fontSize: 12 }}>
            Podfolder na share-u (opciono)
            <input className="input" value={k.mreza.folder} onChange={(e) => setMreza({ folder: e.target.value })} />
          </label>
          {k.mreza.tip === "smb" && (
            <>
              <label className="field" style={{ fontSize: 12 }}>
                Korisničko ime
                <input className="input" value={k.mreza.korisnik} onChange={(e) => setMreza({ korisnik: e.target.value })} />
              </label>
              <label className="field" style={{ fontSize: 12 }}>
                Lozinka
                <input
                  className="input"
                  type="password"
                  value={k.mreza.lozinka}
                  onChange={(e) => setMreza({ lozinka: e.target.value })}
                />
              </label>
            </>
          )}
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <button type="button" className="btn primary" onClick={sacuvaj}>
          Sačuvaj
        </button>
        {status && <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{status}</span>}
      </div>
    </div>
  );
}
