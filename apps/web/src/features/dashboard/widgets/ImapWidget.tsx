import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../api";
import type { WidgetConfigProps, WidgetProps } from "../registry";

interface Poruka {
  folder: string;
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
}

interface PorukaDetalj {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  html: string;
}

// vise foldera (nova opcija) uz kompatibilnost sa starim jednim folderom
function folders(c: Record<string, unknown>): string[] {
  if (Array.isArray(c.folders)) {
    const list = c.folders.filter((f): f is string => typeof f === "string" && !!f);
    if (list.length) return list;
  }
  return [typeof c.folder === "string" && c.folder ? c.folder : "INBOX"];
}

function PorukaModal({ fld, uid, onClose }: { fld: string; uid: number; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["imap-poruka", fld, uid],
    queryFn: () =>
      api<PorukaDetalj>(`/api/dashboard/imap/poruka?folder=${encodeURIComponent(fld)}&uid=${uid}`),
  });

  // popup ide na body (portal) da ga ne secu granice/overflow vidzeta na dashboardu
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="popup" style={{ maxWidth: 760, width: "90%" }} onClick={(e) => e.stopPropagation()}>
        {q.isLoading && <div style={{ opacity: 0.6 }}>Učitavanje...</div>}
        {q.isError && <div style={{ color: "var(--danger)" }}>Poruka nije dostupna.</div>}
        {q.data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{q.data.subject}</div>
            <div style={{ fontSize: 12.5, opacity: 0.8 }}>
              Od: {q.data.from}
              {q.data.to && <> · Za: {q.data.to}</>}
              {q.data.date && <> · {new Date(q.data.date).toLocaleString("sr-RS")}</>}
            </div>
            {q.data.html ? (
              // HTML se prikazuje u sandbox iframe-u: slike i linkovi rade, ali
              // bez allow-scripts skripte iz poruke ne mogu da se izvrse (XSS zastita).
              // <base target=_blank> tera linkove da se otvaraju u novom tabu.
              <iframe
                title="Poruka"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={`<base target="_blank"><div style="font-family:sans-serif;font-size:13px">${q.data.html}</div>`}
                style={{ width: "100%", height: "60vh", border: "1px solid var(--line)", borderRadius: 4, background: "#fff" }}
              />
            ) : (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, maxHeight: "60vh", overflow: "auto" }}>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, margin: 0 }}>
                  {q.data.text || "(prazna poruka)"}
                </pre>
              </div>
            )}
          </div>
        )}
        <div style={{ marginTop: 10, textAlign: "right" }}>
          <button className="btn" onClick={onClose}>Zatvori</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ImapWidget({ config }: WidgetProps) {
  const flds = folders(config);
  const viseFoldera = flds.length > 1;
  const [otvoren, setOtvoren] = useState<{ folder: string; uid: number } | null>(null);
  const q = useQuery({
    queryKey: ["imap-poruke", flds],
    queryFn: () =>
      api<Poruka[]>(`/api/dashboard/imap/poruke?folders=${encodeURIComponent(flds.join(","))}&limit=20`),
    staleTime: 60 * 1000,
  });

  if (q.isLoading) return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Učitavanje...</div>;
  if (q.isError || !q.data)
    return <div style={{ color: "var(--danger)", fontSize: 12.5 }}>Pošta nije dostupna. Proverite IMAP podešavanja u profilu.</div>;
  if (q.data.length === 0) return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Folder je prazan.</div>;

  return (
    <div>
      {q.data.map((m) => (
        <button
          key={`${m.folder}:${m.uid}`}
          onClick={() => setOtvoren({ folder: m.folder, uid: m.uid })}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "5px 0",
            borderBottom: "1px solid var(--line)",
            fontSize: 12.5,
            background: "none",
            border: "none",
            borderBottomStyle: "solid",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ flex: 1, fontWeight: m.seen ? 400 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.subject}
            </span>
            {m.date && (
              <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>
                {new Date(m.date).toLocaleDateString("sr-RS")}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, opacity: 0.7, overflow: "hidden" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
            {viseFoldera && <span style={{ whiteSpace: "nowrap", opacity: 0.8 }}>{m.folder}</span>}
          </div>
        </button>
      ))}
      {otvoren && (
        <PorukaModal fld={otvoren.folder} uid={otvoren.uid} onClose={() => setOtvoren(null)} />
      )}
    </div>
  );
}

export function ImapConfig({ config, onChange }: WidgetConfigProps) {
  const izabrani = folders(config);
  const q = useQuery({
    queryKey: ["imap-folders"],
    queryFn: () => api<{ path: string; delimiter: string }[]>("/api/dashboard/imap/folders"),
    staleTime: 5 * 60 * 1000,
  });

  function toggle(path: string, on: boolean) {
    const set = new Set(izabrani);
    if (on) set.add(path);
    else set.delete(path);
    // ukloni stari jednostruki folder kljuc - od sada radi lista folders
    const { folder: _staro, ...rest } = config;
    void _staro;
    onChange({ ...rest, folders: [...set] });
  }

  return (
    <div className="field" style={{ fontSize: 12 }}>
      Folderi (možete izabrati više)
      {q.isLoading && <div style={{ opacity: 0.6, marginTop: 4 }}>Učitavanje foldera...</div>}
      {q.isError && (
        <div style={{ color: "var(--danger)", marginTop: 4 }}>
          Folderi nedostupni. Proverite IMAP podešavanja u profilu.
        </div>
      )}
      {q.data && (
        <div style={{ maxHeight: 180, overflow: "auto", marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
          {q.data.map((f) => {
            // uvlacenje po dubini podfoldera (delimiter servera: "/" ili ".")
            const dubina = f.path.split(f.delimiter).length - 1;
            const naziv = f.path.split(f.delimiter).pop() || f.path;
            return (
              <label key={f.path} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: dubina * 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={izabrani.includes(f.path)}
                  onChange={(e) => toggle(f.path, e.target.checked)}
                />
                {naziv}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
