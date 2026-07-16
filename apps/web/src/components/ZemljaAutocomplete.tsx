import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ZEMLJE } from "@albatron/shared";

// Zemlja porekla / drzava (faza 15, RP7.2): slobodan unos, lista ZEMLJE samo predlaze.
// Portal tehnika kao ArtikalAutocomplete - upotrebljivo i u celijama tabele.
export function ZemljaAutocomplete({
  value,
  onChange,
  width,
  placeholder = "kucaj zemlju...",
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setDraft(value), [value]);

  const filtered = draft
    ? ZEMLJE.filter((z) => z.naziv.toLowerCase().includes(draft.toLowerCase())).slice(0, 12)
    : [];

  function show() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 2, left: r.left });
    setOpen(true);
  }

  function commit(v: string) {
    setOpen(false);
    if (v !== value) onChange(v);
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
        style={{ width: width ?? "100%" }}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setHighlight(0);
          show();
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            const izbor = open && filtered[highlight] ? filtered[highlight].naziv : draft;
            setDraft(izbor);
            commit(izbor);
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
              maxHeight: 260,
              overflowY: "auto",
              minWidth: 220,
            }}
          >
            {filtered.map((z, i) => (
              <div
                key={z.kod}
                onMouseDown={() => {
                  setDraft(z.naziv);
                  commit(z.naziv);
                }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: "5px 10px",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  background: i === highlight ? "var(--accent-soft)" : undefined,
                }}
              >
                {z.naziv} ({z.kod})
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
