import { DEFAULT_GROUPS, type NavGroup, type NavItem } from "./sections";

// Per-korisnik raspored levog menija (users.sidebarLayout JSONB), format v2:
// korisnicke grupe (naziv, redosled, sadrzaj, collapse) referenciraju kanonske
// stavke iz sections.ts po id-u. Label/ikona/novi se UVEK resavaju iz
// DEFAULT_GROUPS pri renderu, pa raspored prezivljava izmene programa;
// nepoznati id-jevi se tiho odbacuju. Nerasporedjene stavke se ne prikazuju.

export interface LayoutGrupa {
  id: string;
  label: string;
  collapsed: boolean;
  items: string[];
}

export interface LayoutV2 {
  v: 2;
  sidebarCollapsed: boolean;
  groups: LayoutGrupa[];
}

const ITEM_MAP = new Map<string, NavItem>(DEFAULT_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i])));
const GROUP_IKONA = new Map<string, string>(DEFAULT_GROUPS.map((g) => [g.id, g.ikona]));

export function defaultLayout(): LayoutV2 {
  return {
    v: 2,
    sidebarCollapsed: false,
    groups: DEFAULT_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      collapsed: false,
      items: g.items.map((i) => i.id),
    })),
  };
}

// legacy oblici: niz id-jeva grupa, ili { order, collapsed } (faza 15, RP6.2)
function izRedosleda(order: unknown[], sidebarCollapsed: boolean): LayoutV2 {
  const def = defaultLayout();
  const byId = new Map(def.groups.map((g) => [g.id, g]));
  const groups: LayoutGrupa[] = [];
  for (const id of order) {
    const g = byId.get(id as string);
    if (g) {
      groups.push(g);
      byId.delete(id as string);
    }
  }
  groups.push(...byId.values());
  return { v: 2, sidebarCollapsed, groups };
}

export function resolveLayout(raw: unknown): LayoutV2 {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { v?: unknown }).v === 2) {
    const r = raw as { sidebarCollapsed?: unknown; groups?: unknown };
    const groups: LayoutGrupa[] = Array.isArray(r.groups)
      ? r.groups
          .filter(
            (g): g is { id: string; label: string; collapsed?: unknown; items?: unknown } =>
              !!g && typeof g === "object" && typeof (g as { id?: unknown }).id === "string" &&
              typeof (g as { label?: unknown }).label === "string",
          )
          .map((g) => ({
            id: g.id,
            label: g.label,
            collapsed: g.collapsed === true,
            items: Array.isArray(g.items) ? g.items.filter((s): s is string => typeof s === "string") : [],
          }))
      : [];
    return { v: 2, sidebarCollapsed: r.sidebarCollapsed === true, groups: groups.length ? groups : defaultLayout().groups };
  }
  if (Array.isArray(raw)) return izRedosleda(raw, false);
  if (raw && typeof raw === "object") {
    const r = raw as { order?: unknown; collapsed?: unknown };
    return izRedosleda(Array.isArray(r.order) ? r.order : [], r.collapsed === true);
  }
  return defaultLayout();
}

// grupe spremne za render: stavke resene iz kanonske mape, ikona grupe je
// kanonska (default grupe) ili ikona prve stavke (korisnicke grupe)
export interface RenderGrupa extends NavGroup {
  collapsed: boolean;
}

export function renderGroups(layout: LayoutV2): RenderGrupa[] {
  return layout.groups.map((g) => {
    const items = g.items.map((id) => ITEM_MAP.get(id)).filter((i): i is NavItem => i !== undefined);
    return {
      id: g.id,
      label: g.label,
      ikona: GROUP_IKONA.get(g.id) ?? items[0]?.ikona ?? "folder",
      items,
      collapsed: g.collapsed,
    };
  });
}

export function sveStavke(): NavItem[] {
  return [...ITEM_MAP.values()];
}

export function nerasporedjene(layout: LayoutV2): NavItem[] {
  const placed = new Set(layout.groups.flatMap((g) => g.items));
  return sveStavke().filter((i) => !placed.has(i.id));
}

// editor menija (Podesavanja) javlja sidebaru da je raspored promenjen
export const LAYOUT_EVENT = "albatron-sidebar-layout";

export function objaviLayout(layout: LayoutV2) {
  window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: layout }));
}
