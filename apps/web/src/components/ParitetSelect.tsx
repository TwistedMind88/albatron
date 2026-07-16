import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ParitetOpcija {
  id: number;
  internalValue: string; // skraceni naziv (npr. FCA)
  externalValue: string; // pun naziv
}

// Paritet (RP9, st.27): dropdown mini-tabela sa 2 kolone - skraceni + pun naziv.
// Klik bira; u polju posle izbora ostaje skraceni naziv. Portal - radi i u celiji.
export function ParitetSelect({
  value,
  opcije,
  onChange,
  width,
}: {
  value: string;
  opcije: ParitetOpcija[];
  onChange: (internalValue: string) => void;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  function show() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 2, left: r.left, width: r.width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (t === btnRef.current || boxRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  function pick(o: ParitetOpcija | null) {
    onChange(o?.internalValue ?? "");
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="input"
        style={{ width: width ?? "100%", textAlign: "left", cursor: "pointer" }}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {value || " "}
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={boxRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 200,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              minWidth: Math.max(rect.width, 280),
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            <table className="data" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Oznaka</th>
                  <th>Naziv</th>
                </tr>
              </thead>
              <tbody>
                <tr onMouseDown={() => pick(null)} style={{ cursor: "pointer" }}>
                  <td colSpan={2} style={{ opacity: 0.6 }}>(prazno)</td>
                </tr>
                {opcije.map((o) => (
                  <tr
                    key={o.id}
                    onMouseDown={() => pick(o)}
                    style={{ cursor: "pointer", background: o.internalValue === value ? "var(--accent-soft)" : undefined }}
                  >
                    <td>{o.internalValue}</td>
                    <td>{o.externalValue}</td>
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
