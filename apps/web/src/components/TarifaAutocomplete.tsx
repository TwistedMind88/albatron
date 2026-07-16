import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TarifaOpcija {
  id: number;
  internalValue: string; // sifra tarife
  externalValue?: string | null;
  rate: string | null; // procenat carine
}

// Carinska tarifa (faza 16, RP4): MultiPick-stil - dropdown sa KOMPLETNOM listom
// sifra - naziv - stopa i tekst filterom na vrhu, single-select. Rucni unos
// sifre van liste ostaje moguc (izbor iz liste popunjava i sifru i procenat).
// Portal tehnika - radi i u celijama tabele.
export function TarifaAutocomplete({
  value,
  tarife,
  onCommit,
  width,
  dataAttrs,
}: {
  value: string;
  tarife: TarifaOpcija[];
  // stopa === undefined: rucni unos sifre, procenat se ne dira
  onCommit: (sifra: string, stopa?: number | null) => void;
  width?: number;
  dataAttrs?: Record<string, number>;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setDraft(value), [value]);

  const filtered = filter
    ? tarife.filter(
        (t) =>
          t.internalValue.toLowerCase().includes(filter.toLowerCase()) ||
          (t.externalValue ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : tarife;

  function show() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 2, left: r.left });
    setFilter("");
    setHighlight(0);
    setOpen(true);
  }

  // rucni unos: menja samo sifru, procenat ostaje (dozvoljen unos neunesene tarife)
  // posle pick-a open je false, pa blur ne salje dupli commit
  function commitRucno() {
    if (!open) return;
    setOpen(false);
    if (draft !== value) onCommit(draft);
  }

  function pick(t: TarifaOpcija) {
    setDraft(t.internalValue);
    setOpen(false);
    onCommit(t.internalValue, t.rate !== null ? Number(t.rate) : null);
  }

  // klik van inputa i van dropdown-a: rucni commit + zatvaranje
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (t === inputRef.current || boxRef.current?.contains(t)) return;
      commitRucno();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        style={{ width: width ?? "100%" }}
        placeholder="tarifa..."
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!open) show();
        }}
        onFocus={show}
        onBlur={(e) => {
          // Tab/fokus dalje = rucni commit, osim kad fokus prelazi u dropdown (filter)
          if (!boxRef.current?.contains(e.relatedTarget as Node)) commitRucno();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            // Enter bira iz liste samo ako korisnik nije kucao sifru (rucni unos ima prednost)
            if (open && draft === value && filtered[highlight]) pick(filtered[highlight]);
            else commitRucno();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        {...dataAttrs}
      />
      {open && rect &&
        createPortal(
          <div
            ref={boxRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              minWidth: 280,
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <input
              className="input"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter") {
                  if (filtered[highlight]) pick(filtered[highlight]);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              <table className="data" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>Šifra</th>
                    <th>Naziv</th>
                    <th style={{ textAlign: "right" }}>Carina %</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => (
                    <tr
                      key={t.id}
                      onMouseDown={() => pick(t)}
                      onMouseEnter={() => setHighlight(i)}
                      style={{ cursor: "pointer", background: i === highlight ? "var(--accent-soft)" : undefined }}
                    >
                      <td>{t.internalValue}</td>
                      <td>{t.externalValue ?? ""}</td>
                      <td style={{ textAlign: "right" }}>{t.rate !== null ? `${Number(t.rate)}%` : ""}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ opacity: 0.6 }}>Nema rezultata</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
