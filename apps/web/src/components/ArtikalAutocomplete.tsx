import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmt } from "../features/dokumenti/common";

export interface ArtikalOpcija {
  id: number;
  ident: string;
  naziv: string;
  prodajnaCena?: string | null;
  stanjePrimarno?: number;
  serijskiBrojevi?: boolean;
  // zbirna JM - za preracun kolete na nabavnim stavkama (faza 17, RP5)
  zbirnaNasaKolicina?: string | null;
  zbirnaDobKolicina?: string | null;
}

// Tabelaran autocomplete za izbor artikla u stavkama (faza 14.2): renderuje se
// kroz portal da ga ne isece overflow tabele; 10 redova pa scroll; kolone
// ident, naziv, stanje na primarnom skladistu, cena bez PDV
export function ArtikalAutocomplete({
  artikli,
  polje,
  placeholder,
  onIzbor,
}: {
  artikli: ArtikalOpcija[];
  polje: "ident" | "naziv";
  placeholder: string;
  onIzbor: (id: number) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  const filtered = text
    ? artikli.filter((a) => a[polje].toLowerCase().includes(text.toLowerCase()))
    : [];

  function show() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 2, left: r.left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (e.target !== inputRef.current) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setHighlight(0);
          show();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && filtered[highlight]) {
            e.preventDefault();
            onIzbor(filtered[highlight]!.id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && rect && filtered.length > 0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              maxHeight: 10 * 27 + 29, // 10 redova + header
              overflowY: "auto",
              minWidth: 460,
            }}
          >
            <table className="data" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>Ident</th>
                  <th>Naziv</th>
                  <th style={{ textAlign: "right" }}>Na stanju</th>
                  <th style={{ textAlign: "right" }}>Cena bez PDV</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => (
                  <tr
                    key={a.id}
                    onMouseDown={() => onIzbor(a.id)}
                    onMouseEnter={() => setHighlight(i)}
                    style={{ cursor: "pointer", background: i === highlight ? "var(--accent-soft)" : undefined }}
                  >
                    <td className="subtle">{a.ident}</td>
                    <td>{a.naziv}</td>
                    <td style={{ textAlign: "right" }}>{a.stanjePrimarno ?? 0}</td>
                    <td style={{ textAlign: "right" }}>{a.prodajnaCena !== null && a.prodajnaCena !== undefined ? fmt(Number(a.prodajnaCena)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          document.body,
        )}
    </>
  );
}
