import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { api } from "../../api";
import { Ikona } from "../../components/Ikona";
import { WIDGETS, widgetDef } from "./registry";

const COLS = 12;
const ROW_H = 40;

interface WidgetInstance {
  id: string;
  tip: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
}

const hdrBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "0 4px",
  fontSize: 13,
  lineHeight: 1,
  color: "inherit",
};

// Stari zapis (faze 4/5) nije imao x/y/w/h - dodeli podrazumevane dimenzije
// i naslazi widgete jedan ispod drugog da migracija ne izgubi raspored.
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function normalizuj(raw: unknown): WidgetInstance[] {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  let y = 0;
  const out: WidgetInstance[] = [];
  for (const w of arr) {
    const def = typeof w?.tip === "string" ? widgetDef(w.tip) : undefined;
    if (typeof w?.id !== "string" || !def) continue;
    const size = def.defaultSize ?? { w: 4, h: 6 };
    const item: WidgetInstance = {
      id: w.id,
      tip: w.tip as string,
      config: (w.config as Record<string, unknown>) ?? {},
      w: num(w.w, size.w),
      h: num(w.h, size.h),
      x: num(w.x, 0),
      y: num(w.y, y),
    };
    y = item.y + item.h;
    out.push(item);
  }
  return out;
}

export function DashboardPage() {
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [picker, setPicker] = useState(false);
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const { width, containerRef, mounted } = useContainerWidth();

  useEffect(() => {
    api<{ dashboardLayout: unknown }>("/api/moj-profil")
      .then((p) => {
        const dl = p.dashboardLayout as { widgets?: unknown } | null;
        setWidgets(normalizuj(dl?.widgets));
      })
      .catch(() => {});
  }, []);

  function sacuvaj(next: WidgetInstance[]) {
    setWidgets(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api("/api/moj-profil", { method: "PUT", body: { dashboardLayout: { widgets: next } } }).catch(() => {});
    }, 500);
  }

  const layout = useMemo<Layout>(
    () => widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 3 })),
    [widgets],
  );

  function onLayoutChange(next: Layout) {
    const poId = new Map(next.map((l) => [l.i, l]));
    let promena = false;
    const merged = widgets.map((w) => {
      const l = poId.get(w.id);
      if (!l) return w;
      if (l.x !== w.x || l.y !== w.y || l.w !== w.w || l.h !== w.h) promena = true;
      return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
    });
    if (promena) sacuvaj(merged);
  }

  function dodaj(tip: string) {
    const def = widgetDef(tip);
    if (!def) return;
    const size = def.defaultSize ?? { w: 4, h: 6 };
    const y = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    sacuvaj([...widgets, { id: crypto.randomUUID(), tip, config: { ...def.defaultConfig }, x: 0, y, ...size }]);
    setPicker(false);
  }
  function ukloni(id: string) {
    sacuvaj(widgets.filter((w) => w.id !== id));
  }
  function postaviConfig(id: string, config: Record<string, unknown>) {
    sacuvaj(widgets.map((w) => (w.id === id ? { ...w, config } : w)));
  }

  return (
    <div className="dashboard" style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Početna</h2>
        <button type="button" className="btn" onClick={() => setPicker(true)}>+ Dodaj vidžet</button>
      </div>

      {widgets.length === 0 && (
        <div className="placeholder">Dashboard je prazan. Dodajte vidžet dugmetom gore desno.</div>
      )}

      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            className="layout"
            layout={layout}
            width={width}
            gridConfig={{ cols: COLS, rowHeight: ROW_H, margin: [12, 12] }}
            dragConfig={{ enabled: true, handle: ".wdg-drag", bounded: false }}
            resizeConfig={{ enabled: true, handles: ["se"] }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => {
          const def = widgetDef(w.tip);
          if (!def) return null;
          const Body = def.Component;
          const Config = def.Config;
          return (
            <div
              key={w.id}
              style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--line)",
                borderRadius: 6,
                background: "var(--panel, transparent)",
                overflow: "hidden",
              }}
            >
              <div
                className="wdg-drag"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 8px",
                  borderBottom: "1px solid var(--line)",
                  cursor: "move",
                }}
              >
                <b style={{ fontSize: 13, flex: 1 }}>{def.label}</b>
                {Config && (
                  <button
                    type="button"
                    style={hdrBtn}
                    title="Podešavanja"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setConfigOpen(configOpen === w.id ? null : w.id)}
                  >
                    <Ikona id="gear" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  style={hdrBtn}
                  title="Ukloni"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => ukloni(w.id)}
                >
                  ✕
                </button>
              </div>
              {Config && configOpen === w.id && (
                <div style={{ padding: "8px", borderBottom: "1px solid var(--line)", background: "var(--accent-soft)" }}>
                  <Config config={w.config} onChange={(c) => postaviConfig(w.id, c)} />
                </div>
              )}
              <div style={{ padding: "8px 10px", flex: 1, overflow: "auto" }}>
                <Body config={w.config} />
              </div>
            </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      {picker && (
        <div className="overlay" onClick={() => setPicker(false)}>
          <div className="popup" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Dodaj vidžet</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {WIDGETS.map((def) => (
                <button key={def.tip} type="button" className="btn" onClick={() => dodaj(def.tip)}>
                  {def.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
