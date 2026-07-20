import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Ikona } from "../../components/Ikona";
import { WIDGETS, widgetDef } from "./registry";

interface WidgetInstance {
  id: string;
  tip: string;
  config: Record<string, unknown>;
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

export function DashboardPage() {
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [picker, setPicker] = useState(false);
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api<{ dashboardLayout: unknown }>("/api/moj-profil")
      .then((p) => {
        const dl = p.dashboardLayout as { widgets?: WidgetInstance[] } | null;
        setWidgets(Array.isArray(dl?.widgets) ? dl!.widgets : []);
      })
      .catch(() => {});
  }, []);

  function sacuvaj(next: WidgetInstance[]) {
    setWidgets(next);
    // debounce - config se menja po tasteru; raspored retko (plan 20, faza 4)
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api("/api/moj-profil", { method: "PUT", body: { dashboardLayout: { widgets: next } } }).catch(() => {});
    }, 500);
  }

  function dodaj(tip: string) {
    const def = widgetDef(tip);
    if (!def) return;
    sacuvaj([...widgets, { id: crypto.randomUUID(), tip, config: { ...def.defaultConfig } }]);
    setPicker(false);
  }
  function ukloni(id: string) {
    sacuvaj(widgets.filter((w) => w.id !== id));
  }
  function pomeri(id: string, smer: -1 | 1) {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + smer;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    sacuvaj(next);
  }
  function postaviConfig(id: string, config: Record<string, unknown>) {
    sacuvaj(widgets.map((w) => (w.id === id ? { ...w, config } : w)));
  }

  return (
    <div className="dashboard" style={{ padding: 16, overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Početna</h2>
        <button type="button" className="btn" onClick={() => setPicker(true)}>+ Dodaj vidžet</button>
      </div>

      {widgets.length === 0 && (
        <div className="placeholder">Dashboard je prazan. Dodajte vidžet dugmetom gore desno.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
        {widgets.map((w, i) => {
          const def = widgetDef(w.tip);
          if (!def) return null;
          const Body = def.Component;
          const Config = def.Config;
          return (
            <div key={w.id} style={{ border: "1px solid var(--line)", borderRadius: 6, background: "var(--panel, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                <b style={{ fontSize: 13, flex: 1 }}>{def.label}</b>
                <button type="button" style={hdrBtn} title="Gore" disabled={i === 0} onClick={() => pomeri(w.id, -1)}>↑</button>
                <button type="button" style={hdrBtn} title="Dole" disabled={i === widgets.length - 1} onClick={() => pomeri(w.id, 1)}>↓</button>
                {Config && (
                  <button type="button" style={hdrBtn} title="Podešavanja" onClick={() => setConfigOpen(configOpen === w.id ? null : w.id)}>
                    <Ikona id="gear" size={14} />
                  </button>
                )}
                <button type="button" style={hdrBtn} title="Ukloni" onClick={() => ukloni(w.id)}>✕</button>
              </div>
              {Config && configOpen === w.id && (
                <div style={{ padding: "8px", borderBottom: "1px solid var(--line)", background: "var(--accent-soft)" }}>
                  <Config config={w.config} onChange={(c) => postaviConfig(w.id, c)} />
                </div>
              )}
              <div style={{ padding: "8px 10px" }}>
                <Body config={w.config} />
              </div>
            </div>
          );
        })}
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
