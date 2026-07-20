import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { Ikona } from "../../components/Ikona";
import { ObavestenjaLista } from "./ObavestenjaLista";

// Zvonce sa badge-om (broj nepročitanih), polling na 30s. Klik otvara popover
// sa ObavestenjaLista (isti portal-popup obrazac kao FilterDugme).
export function ObavestenjaZvonce({ collapsed }: { collapsed?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  const broj = useQuery({
    queryKey: ["obavestenja-broj"],
    queryFn: () => api<{ n: number }>("/api/obavestenja/broj-nepr"),
    refetchInterval: 30000,
  });
  const n = broj.data?.n ?? 0;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!btnRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function pozicioniraj() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.top, left: r.right + 4 });
    }
    pozicioniraj();
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", pozicioniraj);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", pozicioniraj);
    };
  }, [open]);

  async function procitanoSve() {
    await api("/api/obavestenja/procitano-sve", { method: "POST" });
    void qc.invalidateQueries({ queryKey: ["obavestenja"] });
    void qc.invalidateQueries({ queryKey: ["obavestenja-broj"] });
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="obav-zvonce"
        title="Obaveštenja"
        onClick={() => setOpen((o) => !o)}
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}
      >
        <Ikona id="bell" size={16} />
        {!collapsed && <span>Obaveštenja</span>}
        {n > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              left: 10,
              minWidth: 15,
              height: 15,
              padding: "0 3px",
              borderRadius: 8,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 10,
              lineHeight: "15px",
              textAlign: "center",
            }}
          >
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={dropRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 200,
              width: 340,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 16px rgba(0,0,0,.15)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
              <b style={{ fontSize: 13 }}>Obaveštenja</b>
              <button className="btn" style={{ fontSize: 11 }} onClick={() => void procitanoSve()}>
                Označi sve
              </button>
            </div>
            <div style={{ overflowY: "auto" }}>
              <ObavestenjaLista onNavigate={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
