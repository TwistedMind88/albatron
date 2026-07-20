import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api";
import { useTabs } from "../../../store/tabs";
import { TIP_INFO, TIP_SEKCIJA } from "../../dokumenti/common";
import type { WidgetConfigProps, WidgetProps } from "../registry";

interface Red {
  id: number;
  broj: string;
  datum: string;
  klijentNaziv: string;
}

function cfg(c: Record<string, unknown>) {
  return {
    tip: typeof c.tip === "string" ? c.tip : "predracun",
    limit: typeof c.limit === "number" ? c.limit : 5,
  };
}

export function DokumentiListaWidget({ config }: WidgetProps) {
  const { tip, limit } = cfg(config);
  const openTab = useTabs((s) => s.open);
  const q = useQuery({
    queryKey: ["dokumenti", tip],
    queryFn: () => api<Red[]>(`/api/dokumenti?tip=${tip}`),
  });
  const rows = (q.data ?? []).slice(0, limit);

  function otvori(r: Red) {
    const sekcija = TIP_SEKCIJA[tip];
    if (sekcija) openTab(sekcija, r.broj, { forceNew: true, payload: { openId: r.id } });
  }

  return (
    <div>
      {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema dokumenata.</div>}
      {rows.map((r) => (
        <div
          key={r.id}
          onClick={() => otvori(r)}
          style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 12.5 }}
        >
          <span className="link">{r.broj}</span>
          <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{new Date(r.datum).toLocaleDateString("sr-RS")}</span>
        </div>
      ))}
    </div>
  );
}

export function DokumentiListaConfig({ config, onChange }: WidgetConfigProps) {
  const { tip, limit } = cfg(config);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12 }}>
        Tip:{" "}
        <select value={tip} onChange={(e) => onChange({ ...config, tip: e.target.value })}>
          {Object.entries(TIP_INFO).map(([k, v]) => (
            <option key={k} value={k}>{v.mnozina}</option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 12 }}>
        Prikaži:{" "}
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          style={{ width: 56 }}
          onChange={(e) => onChange({ ...config, limit: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
        />
      </label>
    </div>
  );
}
