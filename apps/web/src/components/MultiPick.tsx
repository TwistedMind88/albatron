import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MultiPickOption {
  id: number | string;
  label: string;
}

// Interna checkbox lista sa tekst filterom - izvucena iz MultiPick (faza 15, RP6)
// da je koristi i FilterDugme u pregledu dokumenata.
export function CheckLista({
  options,
  value,
  onChange,
  autoFocus,
  onEscape,
}: {
  options: MultiPickOption[];
  value: (number | string)[];
  onChange: (ids: (number | string)[]) => void;
  autoFocus?: boolean;
  onEscape?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));

  function toggle(id: number | string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <>
      <input
        className="input"
        placeholder="Filter..."
        autoFocus={autoFocus}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEscape?.();
        }}
      />
      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        {filtered.map((o) => (
          <label
            key={o.id}
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              padding: "3px 4px",
              fontSize: "12.5px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.label}
          </label>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "4px 6px", fontSize: 12, opacity: 0.6 }}>Nema rezultata</div>
        )}
      </div>
    </>
  );
}

// MultiPick (faza 14.4, stavka 60): dugme koje otvara padajucu listu sa
// kompletnom listom opcija, checkbox multi-izborom i tekst filterom na vrhu.
// Dropdown je portal sa fixed pozicijom (kao TarifaAutocomplete) da ga ne
// isece overflow roditelja - npr. FilterDugme popup sa overflowY: auto.
export function MultiPick({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: MultiPickOption[];
  value: (number | string)[];
  onChange: (ids: (number | string)[]) => void;
  placeholder?: string; // tekst kad nista nije izabrano, npr. "Svi tipovi"
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    }
    function pozicioniraj() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 2, left: r.left, width: r.width });
    }
    pozicioniraj();
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", pozicioniraj, true);
    window.addEventListener("resize", pozicioniraj);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", pozicioniraj, true);
      window.removeEventListener("resize", pozicioniraj);
    };
  }, [open]);

  const izabrane = options.filter((o) => value.includes(o.id));
  const tekst =
    izabrane.length === 0
      ? (placeholder ?? "Sve")
      : izabrane.length <= 2
        ? izabrane.map((o) => o.label).join(", ")
        : `${izabrane.length} izabrano`;

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        className="input"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          overflow: "hidden",
        }}
        title={izabrane.map((o) => o.label).join(", ")}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tekst}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={dropRef}
            data-multipick-drop
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              minWidth: rect.width,
              zIndex: 200, // iznad .overlay (100) - MultiPick se koristi i u popup wizardima
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.08)",
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <CheckLista options={options} value={value} onChange={onChange} autoFocus onEscape={() => setOpen(false)} />
            {value.length > 0 && (
              <button type="button" className="btn" style={{ fontSize: 11 }} onClick={() => onChange([])}>
                Poništi izbor
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
