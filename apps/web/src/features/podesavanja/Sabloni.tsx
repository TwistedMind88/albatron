import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PLACEHOLDERS, PLACEHOLDER_GRUPE } from "@albatron/shared";
import { api, ApiError } from "../../api";
import { TIP_INFO } from "../dokumenti/common";
import { TabeleStavki, SabloniSlike, type TabelaDef } from "./SabloniDodaci";

// Sabloni izvestaja (brief 7.7): po tipu dokumenta, vise izvestaja, izbor podrazumevanog,
// editor HTML-a sa {placeholder} poljima. Stavka 40: preview + interaktivni editor.
// Faza 15 RP5: svih 10 tipova + imenovane tabele stavki + slike.

// prenos nije u TIP_INFO (nije u documents tabeli) ali ima sablone (faza 16, RP2)
const TIPOVI = [...Object.entries(TIP_INFO).map(([id, t]) => ({ id, label: t.label })), { id: "prenos", label: "Prenos" }];

interface Sablon {
  id: number;
  docType: string;
  naziv: string;
  html: string;
  isDefault: boolean;
}

// Debounced render kroz backend engine (isti kao pravi izvestaj)
function usePreview(tip: string, html: string, aktivno: boolean) {
  const [preview, setPreview] = useState<{ html: string; demo: boolean } | null>(null);
  useEffect(() => {
    if (!aktivno) return;
    const t = setTimeout(() => {
      api<{ html: string; demo: boolean }>("/api/sabloni/preview", { method: "POST", body: { docType: tip, html } })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [tip, html, aktivno]);
  return preview;
}

function PreviewFrame({ preview, style }: { preview: { html: string; demo: boolean } | null; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", ...style }}>
      {preview?.demo && (
        <p className="subtle" style={{ fontSize: 11.5, margin: "0 0 4px" }}>
          Nema dokumenta ovog tipa - prikazane su demo vrednosti polja.
        </p>
      )}
      <div style={{ flex: 1, border: "1px solid var(--line)", background: "#888", overflow: "auto" }}>
        <iframe title="pregled" sandbox="" srcDoc={preview?.html ?? ""} style={{ width: "100%", height: "100%", minHeight: 300, border: 0, background: "#fff" }} />
      </div>
    </div>
  );
}

export function Sabloni() {
  const qc = useQueryClient();
  const [tip, setTip] = useState("ponuda");
  const [aktivni, setAktivni] = useState<number | null>(null);
  const [naziv, setNaziv] = useState("");
  const [html, setHtml] = useState("");
  const [poruka, setPoruka] = useState("");
  const [error, setError] = useState("");
  const [pregled, setPregled] = useState(false);
  const [editor, setEditor] = useState(false);

  const preview = usePreview(tip, html, pregled && !editor);

  const query = useQuery({
    queryKey: ["sabloni", tip],
    queryFn: () => api<Sablon[]>(`/api/sabloni?tip=${tip}`),
  });
  const lista = query.data ?? [];
  const izabrani = lista.find((s) => s.id === aktivni) ?? null;

  function otvori(s: Sablon) {
    setAktivni(s.id);
    setNaziv(s.naziv);
    setHtml(s.html);
    setPoruka("");
    setError("");
  }

  async function radnja(fn: () => Promise<unknown>, uspesno: string) {
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["sabloni"] });
      setPoruka(uspesno);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  return (
    <div style={{ maxWidth: pregled ? 1400 : 900 }}>
      <h1 style={{ fontSize: 17, margin: "0 0 12px" }}>Šabloni izveštaja</h1>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {TIPOVI.map((t) => (
          <button
            key={t.id}
            className={`btn${tip === t.id ? " primary" : ""}`}
            onClick={() => {
              setTip(t.id);
              setAktivni(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {lista.map((s) => (
            <div
              key={s.id}
              onClick={() => otvori(s)}
              style={{
                padding: "5px 8px",
                cursor: "pointer",
                borderRadius: "var(--radius)",
                fontSize: 12.5,
                background: s.id === aktivni ? "var(--accent-soft)" : undefined,
              }}
            >
              {s.naziv} {s.isDefault && <span className="subtle">(podrazumevani)</span>}
            </div>
          ))}
          <button
            className="btn"
            style={{ marginTop: 8 }}
            onClick={() =>
              radnja(async () => {
                const created = await api<Sablon>("/api/sabloni", {
                  method: "POST",
                  body: { docType: tip, naziv: "Novi šablon", html: izabrani?.html ?? "", isDefault: false },
                });
                otvori(created);
              }, "Šablon dodat")
            }
          >
            + Novi šablon
          </button>
        </div>

        {izabrani && (
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input className="input" style={{ width: 220 }} value={naziv} onChange={(e) => setNaziv(e.target.value)} />
              <button
                className="btn primary"
                onClick={() => radnja(() => api(`/api/sabloni/${izabrani.id}`, { method: "PUT", body: { naziv, html } }), "Sačuvano")}
              >
                Sačuvaj
              </button>
              <button className={`btn${pregled ? " primary" : ""}`} onClick={() => setPregled((p) => !p)}>
                Pregled
              </button>
              <button className="btn" onClick={() => setEditor(true)}>
                Interaktivni editor
              </button>
              {!izabrani.isDefault && (
                <button
                  className="btn"
                  onClick={() => radnja(() => api(`/api/sabloni/${izabrani.id}`, { method: "PUT", body: { isDefault: true } }), "Postavljen kao podrazumevani")}
                >
                  Postavi kao podrazumevani
                </button>
              )}
              {lista.length > 1 && (
                <button
                  className="btn"
                  onClick={() =>
                    radnja(async () => {
                      await api(`/api/sabloni/${izabrani.id}`, { method: "DELETE" });
                      setAktivni(null);
                    }, "Obrisan")
                  }
                >
                  Obriši
                </button>
              )}
            </div>
            {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
            {poruka && <p style={{ fontSize: 12, margin: "0 0 8px" }}>{poruka}</p>}
            <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
              <textarea
                className="input"
                spellCheck={false}
                style={{ flex: 1, minHeight: 380, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
              />
              {pregled && <PreviewFrame preview={preview} style={{ flex: 1, minHeight: 380 }} />}
            </div>
            <p className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
              HTML sa placeholder poljima poput {"{doc_broj}"} - kompletna lista polja je u sekciji Uputstvo.
            </p>
          </div>
        )}

        {editor && izabrani && (
          <InteraktivniEditor
            tip={tip}
            pocetniHtml={html}
            onClose={() => setEditor(false)}
            onPrimeni={(novi) => {
              setHtml(novi);
              setEditor(false);
            }}
          />
        )}
      </div>

      <TabeleStavki />
      <SabloniSlike />
    </div>
  );
}

// Stavka 40 MVP: bogatiji textarea editor sa listom placeholdera ("ubaci" na klik,
// na poziciju kursora) i zivim pregledom kroz backend engine. WYSIWYG van opsega.
function InteraktivniEditor({
  tip,
  pocetniHtml,
  onClose,
  onPrimeni,
}: {
  tip: string;
  pocetniHtml: string;
  onClose: () => void;
  onPrimeni: (html: string) => void;
}) {
  const [html, setHtml] = useState(pocetniHtml);
  const ta = useRef<HTMLTextAreaElement>(null);
  const preview = usePreview(tip, html, true);

  function ubaci(key: string) {
    const el = ta.current;
    const tag = `{${key}}`;
    if (!el) {
      setHtml((h) => h + tag);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setHtml(html.slice(0, start) + tag + html.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + tag.length;
    });
  }

  const grupe = Object.entries(PLACEHOLDER_GRUPE) as [keyof typeof PLACEHOLDER_GRUPE, string][];
  // imenovane tabele stavki (faza 15 RP5) - dostupne svim tipovima ili bas ovom tipu
  const tabeleQuery = useQuery({ queryKey: ["sabloni-tabele"], queryFn: () => api<TabelaDef[]>("/api/sabloni-tabele") });
  const tabele = (tabeleQuery.data ?? []).filter((d) => !d.docType || d.docType === tip);

  return (
    <div className="overlay">
      <div className="popup" style={{ width: "min(1300px, 96vw)", height: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0, marginRight: "auto" }}>Interaktivni editor šablona</h2>
          <button className="btn primary" onClick={() => onPrimeni(html)}>Primeni</button>
          <button className="btn" onClick={onClose}>Otkaži</button>
        </div>
        <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ width: 230, flexShrink: 0, overflow: "auto", fontSize: 12 }}>
            {grupe.map(([g, label]) => (
              <div key={g} style={{ marginBottom: 10 }}>
                <div className="subtle" style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                {PLACEHOLDERS.filter((p) => p.grupa === g).map((p) => (
                  <div key={p.key} title={p.opis} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                    <button className="btn" style={{ padding: "0 6px", fontSize: 11, flexShrink: 0 }} onClick={() => ubaci(p.key)}>
                      ubaci
                    </button>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                      {`{${p.key}}`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {tabele.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="subtle" style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 3 }}>Imenovane tabele</div>
                {tabele.map((d) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                    <button className="btn" style={{ padding: "0 6px", fontSize: 11, flexShrink: 0 }} onClick={() => ubaci(`stavke_tabela:${d.naziv}`)}>
                      ubaci
                    </button>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                      {`{stavke_tabela:${d.naziv}}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <textarea
            ref={ta}
            className="input"
            spellCheck={false}
            style={{ flex: 1, resize: "none", fontFamily: "monospace", fontSize: 12 }}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
          <PreviewFrame preview={preview} style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );
}
