import { useEffect, useState } from "react";
import { api } from "../../api";
import { Ikona } from "../../components/Ikona";
import { findItem } from "../../shell/sections";
import {
  defaultLayout,
  nerasporedjene,
  objaviLayout,
  resolveLayout,
  type LayoutV2,
} from "../../shell/sidebarLayout";

// Detaljno podesavanje levog menija po korisniku: sopstvene grupe (naziv,
// redosled, sadrzaj), redosled stavki, sakrivanje nekoriscenih stavki.
// ponytail: pomeranje strelicama umesto drag-and-drop izmedju grupa - dnd sa
// vise kontejnera je znatno slozeniji, dodati ako se pokaze potreba.

const dugmeMini: React.CSSProperties = { padding: "1px 7px", fontSize: 12, lineHeight: 1.4 };

export function MeniEditor() {
  const [layout, setLayout] = useState<LayoutV2 | null>(null);
  const [izabrana, setIzabrana] = useState<string | null>(null);

  useEffect(() => {
    api<{ sidebarLayout: unknown }>("/api/moj-profil")
      .then((p) => {
        const l = resolveLayout(p.sidebarLayout);
        setLayout(l);
        setIzabrana(l.groups[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  if (!layout) return null;

  function sacuvaj(next: LayoutV2) {
    setLayout(next);
    objaviLayout(next); // sidebar se odmah osvezi
    api("/api/moj-profil", { method: "PUT", body: { sidebarLayout: next } }).catch(() => {});
  }

  const l = layout;

  function pomeriGrupu(idx: number, smer: -1 | 1) {
    const next = [...l.groups];
    const cilj = idx + smer;
    if (cilj < 0 || cilj >= next.length) return;
    [next[idx], next[cilj]] = [next[cilj]!, next[idx]!];
    sacuvaj({ ...l, groups: next });
  }

  function preimenuj(id: string, label: string) {
    sacuvaj({ ...l, groups: l.groups.map((g) => (g.id === id ? { ...g, label } : g)) });
  }

  function obrisiGrupu(id: string) {
    sacuvaj({ ...l, groups: l.groups.filter((g) => g.id !== id) });
    if (izabrana === id) setIzabrana(l.groups.find((g) => g.id !== id)?.id ?? null);
  }

  function novaGrupa() {
    const grupa = { id: crypto.randomUUID(), label: "Nova grupa", collapsed: false, items: [] };
    sacuvaj({ ...l, groups: [...l.groups, grupa] });
    setIzabrana(grupa.id);
  }

  function pomeriStavku(gid: string, idx: number, smer: -1 | 1) {
    const g = l.groups.find((x) => x.id === gid)!;
    const cilj = idx + smer;
    if (cilj < 0 || cilj >= g.items.length) return;
    const items = [...g.items];
    [items[idx], items[cilj]] = [items[cilj]!, items[idx]!];
    sacuvaj({ ...l, groups: l.groups.map((x) => (x.id === gid ? { ...x, items } : x)) });
  }

  function izbaciStavku(gid: string, itemId: string) {
    sacuvaj({
      ...l,
      groups: l.groups.map((x) => (x.id === gid ? { ...x, items: x.items.filter((i) => i !== itemId) } : x)),
    });
  }

  function dodajStavku(itemId: string) {
    if (!izabrana) return;
    sacuvaj({
      ...l,
      groups: l.groups.map((x) => (x.id === izabrana ? { ...x, items: [...x.items, itemId] } : x)),
    });
  }

  function vratiPodrazumevano() {
    const def = defaultLayout();
    sacuvaj(def);
    setIzabrana(def.groups[0]?.id ?? null);
  }

  const pool = nerasporedjene(l);
  const izabranaGrupa = l.groups.find((g) => g.id === izabrana);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Levi meni</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
        Raspored se pamti po korisniku. Kreirajte grupe, imenujte ih po želji i rasporedite opcije; opcije koje
        ne rasporedite ne prikazuju se u meniju. Klik na naziv grupe u meniju sakriva/prikazuje njene opcije.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={novaGrupa}>
          Nova grupa
        </button>
        <button className="btn" onClick={vratiPodrazumevano}>
          Vrati podrazumevano
        </button>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ flex: 3, display: "flex", flexDirection: "column", gap: 8 }}>
          {l.groups.map((g, gi) => (
            <div
              key={g.id}
              className="card"
              onClick={() => setIzabrana(g.id)}
              style={{
                cursor: "pointer",
                outline: g.id === izabrana ? "2px solid var(--accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <input
                  className="input"
                  value={g.label}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => preimenuj(g.id, e.target.value)}
                  style={{ flex: 1, fontWeight: 600 }}
                />
                <button className="btn" style={dugmeMini} title="Gore" onClick={() => pomeriGrupu(gi, -1)}>
                  ↑
                </button>
                <button className="btn" style={dugmeMini} title="Dole" onClick={() => pomeriGrupu(gi, 1)}>
                  ↓
                </button>
                <button
                  className="btn"
                  style={{ ...dugmeMini, color: "var(--danger)" }}
                  title="Obriši grupu (opcije idu u nerasporedjene)"
                  onClick={(e) => {
                    e.stopPropagation();
                    obrisiGrupu(g.id);
                  }}
                >
                  ✕
                </button>
              </div>
              {g.items.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "2px 0" }}>
                  Prazna grupa - ne prikazuje se u meniju
                </div>
              )}
              {g.items.map((itemId, ii) => {
                const item = findItem(itemId);
                if (!item) return null;
                return (
                  <div
                    key={itemId}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0 2px 14px", fontSize: 13 }}
                  >
                    <Ikona id={item.ikona} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <button className="btn" style={dugmeMini} title="Gore" onClick={() => pomeriStavku(g.id, ii, -1)}>
                      ↑
                    </button>
                    <button className="btn" style={dugmeMini} title="Dole" onClick={() => pomeriStavku(g.id, ii, 1)}>
                      ↓
                    </button>
                    <button
                      className="btn"
                      style={dugmeMini}
                      title="Izbaci iz grupe"
                      onClick={() => izbaciStavku(g.id, itemId)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ flex: 2, position: "sticky", top: 0 }}>
          <div className="card">
            <b style={{ fontSize: 13 }}>Nerasporedjene opcije</b>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "2px 0 8px" }}>
              {izabranaGrupa
                ? `Klik dodaje na kraj grupe "${izabranaGrupa.label}"`
                : "Izaberite grupu klikom pa dodajte opcije"}
            </div>
            {pool.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Sve opcije su rasporedjene.</div>}
            {pool.map((item) => (
              <div
                key={item.id}
                onClick={() => dodajStavku(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 4px",
                  fontSize: 13,
                  cursor: izabranaGrupa ? "pointer" : "default",
                  borderRadius: "var(--radius)",
                }}
              >
                <Ikona id={item.ikona} />
                <span style={{ flex: 1 }}>{item.label}</span>
                <span style={{ color: "var(--accent)", fontSize: 12 }}>dodaj</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
