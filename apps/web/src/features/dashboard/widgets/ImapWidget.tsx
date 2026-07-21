import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../api";
import type { WidgetConfigProps, WidgetProps } from "../registry";

interface Poruka {
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

function folder(c: Record<string, unknown>): string {
  return typeof c.folder === "string" && c.folder ? c.folder : "INBOX";
}

function PorukaModal({ fld, uid, onClose }: { fld: string; uid: number; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["imap-poruka", fld, uid],
    queryFn: () =>
      api<PorukaDetalj>(`/api/dashboard/imap/poruka?folder=${encodeURIComponent(fld)}&uid=${uid}`),
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" style={{ maxWidth: 700, width: "90%" }} onClick={(e) => e.stopPropagation()}>
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
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, maxHeight: "60vh", overflow: "auto" }}>
              {q.data.html ? (
                // ponytail: prikaz kao tekst (dangerouslySetInnerHTML bi bio XSS bez sanitizacije)
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, margin: 0 }}>
                  {q.data.text || "(HTML poruka - tekst nije dostupan)"}
                </pre>
              ) : (
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, margin: 0 }}>
                  {q.data.text || "(prazna poruka)"}
                </pre>
              )}
            </div>
          </div>
        )}
        <div style={{ marginTop: 10, textAlign: "right" }}>
          <button className="btn" onClick={onClose}>Zatvori</button>
        </div>
      </div>
    </div>
  );
}

export function ImapWidget({ config }: WidgetProps) {
  const fld = folder(config);
  const [otvoren, setOtvoren] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["imap-poruke", fld],
    queryFn: () => api<Poruka[]>(`/api/dashboard/imap/poruke?folder=${encodeURIComponent(fld)}&limit=20`),
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
          key={m.uid}
          onClick={() => setOtvoren(m.uid)}
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
          <div style={{ opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</div>
        </button>
      ))}
      {otvoren !== null && <PorukaModal fld={fld} uid={otvoren} onClose={() => setOtvoren(null)} />}
    </div>
  );
}

export function ImapConfig({ config, onChange }: WidgetConfigProps) {
  return (
    <label className="field" style={{ fontSize: 12 }}>
      Folder
      <input
        className="input"
        value={folder(config)}
        onChange={(e) => onChange({ ...config, folder: e.target.value })}
      />
    </label>
  );
}
