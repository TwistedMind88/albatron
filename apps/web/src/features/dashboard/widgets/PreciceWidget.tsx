import { useTabs } from "../../../store/tabs";
import { DEFAULT_GROUPS, type NavItem } from "../../../shell/sections";
import type { WidgetConfigProps, WidgetProps } from "../registry";

// Sve stavke menija tipa dokumenta ("+") - kandidati za precicu.
const NOVI_STAVKE: NavItem[] = DEFAULT_GROUPS.flatMap((g) => g.items.filter((i) => i.novi));

function items(c: Record<string, unknown>): string[] {
  return Array.isArray(c.items) ? (c.items as string[]) : [];
}

export function PreciceWidget({ config }: WidgetProps) {
  const open = useTabs((s) => s.open);
  const izabrane = items(config)
    .map((id) => NOVI_STAVKE.find((i) => i.id === id))
    .filter((i): i is NavItem => !!i);

  if (izabrane.length === 0) {
    return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema prečica. Podesite ih zupčanikom.</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {izabrane.map((i) => (
        <button
          key={i.id}
          type="button"
          className="btn"
          onClick={() => open(i.id, i.label, { forceNew: true, payload: { novi: true } })}
        >
          + {i.label}
        </button>
      ))}
    </div>
  );
}

export function PreciceConfig({ config, onChange }: WidgetConfigProps) {
  const izabrane = items(config);
  function toggle(id: string) {
    const next = izabrane.includes(id) ? izabrane.filter((x) => x !== id) : [...izabrane, id];
    onChange({ ...config, items: next });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {NOVI_STAVKE.map((i) => (
        <label key={i.id} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={izabrane.includes(i.id)} onChange={() => toggle(i.id)} />
          {i.label}
        </label>
      ))}
    </div>
  );
}
