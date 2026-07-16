import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MultiPick } from "./MultiPick";
import type { FilterDef } from "../features/dokumenti/common";

// Vrednosti filtera: multi = lista izabranih vrednosti, opseg = od/do (ISO datum)
export type FilterVrednosti = Record<string, string[] | { od: string; do: string }>;

export function brojAktivnih(vrednosti: FilterVrednosti) {
  return Object.values(vrednosti).filter((v) =>
    Array.isArray(v) ? v.length > 0 : v.od !== "" || v.do !== "",
  ).length;
}

// Dugme "Filtriraj" sa badge-om broja aktivnih filtera; popup usidren uz dugme
// (position: fixed + getBoundingClientRect, isti pattern kao ArtikalAutocomplete
// portal), NE centriran modal (faza 15, RP6.1). Kontrolisan state - ponovno
// otvaranje prikazuje trenutno aktivne filtere.
export function FilterDugme({
  defs,
  opcije,
  vrednosti,
  onChange,
}: {
  defs: FilterDef[];
  opcije: Record<string, string[]>; // distinct vrednosti po key za multi filtere
  vrednosti: FilterVrednosti;
  onChange: (v: FilterVrednosti) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const aktivnih = brojAktivnih(vrednosti);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      // klik u MultiPick portal dropdown (van popupRef u DOM-u) ne zatvara popup
      if ((e.target as Element).closest?.("[data-multipick-drop]")) return;
      if (
        !popupRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      // popup sirina 260; ako dugme desno, poravnaj desnu ivicu popupa uz dugme
      // i drzi unutar viewporta (min 8px margina)
      if (r) {
        const left = Math.max(8, Math.min(r.left, window.innerWidth - 260 - 8));
        setRect({ top: r.bottom + 4, left });
      }
    }
    setOpen((o) => !o);
  }

  function ponistiSve() {
    onChange({});
  }

  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button ref={btnRef} type="button" className="btn" onClick={toggleOpen}>
          Filtriraj
          {aktivnih > 0 && (
            <span
              style={{
                marginLeft: 6,
                background: "var(--accent)",
                color: "#fff",
                borderRadius: 8,
                padding: "0 6px",
                fontSize: 11,
              }}
            >
              {aktivnih}
            </span>
          )}
        </button>
        {aktivnih > 0 && (
          <button
            type="button"
            className="btn"
            title="Poništi sve filtere"
            style={{ padding: "2px 7px" }}
            onClick={ponistiSve}
          >
            ✕
          </button>
        )}
      </span>
      {open && rect &&
        createPortal(
          <div
            ref={popupRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              width: 260,
              boxSizing: "border-box",
              maxHeight: "70vh",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {defs.map((def) => {
              const v = vrednosti[def.key];
              if (def.vrsta === "opseg") {
                const opseg = (v as { od: string; do: string } | undefined) ?? { od: "", do: "" };
                return (
                  <div key={def.key}>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{def.label}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="date"
                        className="input"
                        style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
                        value={opseg.od}
                        onChange={(e) => onChange({ ...vrednosti, [def.key]: { ...opseg, od: e.target.value } })}
                      />
                      -
                      <input
                        type="date"
                        className="input"
                        style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
                        value={opseg.do}
                        onChange={(e) => onChange({ ...vrednosti, [def.key]: { ...opseg, do: e.target.value } })}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={def.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{def.label}</div>
                  <MultiPick
                    options={(opcije[def.key] ?? []).map((o) => ({ id: o, label: o === "" ? "(prazno)" : o }))}
                    value={(v as string[] | undefined) ?? []}
                    onChange={(ids) => onChange({ ...vrednosti, [def.key]: ids as string[] })}
                    placeholder="Sve"
                  />
                </div>
              );
            })}
            <button type="button" className="btn" onClick={ponistiSve} disabled={aktivnih === 0}>
              Poništi sve filtere
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
