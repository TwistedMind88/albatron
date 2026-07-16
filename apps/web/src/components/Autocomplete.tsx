import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface AutocompleteOption {
  id: number | string;
  label: string;
}

// Globalna autocomplete komponenta (brief 3.4): kuca se od prvog karaktera,
// lista iskace ispod i filtrira se u realnom vremenu, strelice + Enter + klik.
export function Autocomplete({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: AutocompleteOption[];
  value: AutocompleteOption | null;
  onChange: (opt: AutocompleteOption | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // pozicija dropdown-a (portal + fixed, da ga overflow roditelja ne isece)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => setText(value?.label ?? ""), [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(text.toLowerCase()));

  function pick(opt: AutocompleteOption) {
    onChange(opt);
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (e.target.value === "") onChange(null);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && filtered[highlight]) {
            e.preventDefault();
            pick(filtered[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && filtered.length > 0 && rect &&
        createPortal(
        <div
          ref={listRef}
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            minWidth: rect.width,
            zIndex: 200,
            background: "var(--surface)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius)",
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,.08)",
          }}
        >
          {filtered.map((o, i) => (
            <div
              key={o.id}
              onMouseDown={() => pick(o)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: "12.5px",
                background: i === highlight ? "var(--accent-soft)" : undefined,
              }}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
