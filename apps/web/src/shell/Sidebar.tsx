import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { NAV_MODUL, type ModulId, type SessionUser } from "@albatron/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useTabs } from "../store/tabs";
import { Ikona } from "../components/Ikona";
import type { NavItem } from "./sections";
import {
  LAYOUT_EVENT,
  defaultLayout,
  renderGroups,
  resolveLayout,
  type LayoutV2,
  type RenderGrupa,
} from "./sidebarLayout";

// "+" na hover stavke tipa dokumenta: nov tab sa NOVIM dokumentom (faza 16, st. 46)
function PlusNovi({ item, onOpened }: { item: { id: string; label: string }; onOpened?: () => void }) {
  const open = useTabs((s) => s.open);
  return (
    <button
      type="button"
      className="nav-plus"
      title={`Novi dokument - ${item.label}`}
      onClick={(e) => {
        e.stopPropagation();
        open(item.id, item.label, { forceNew: true, payload: { novi: true } });
        onOpened?.();
      }}
    >
      +
    </button>
  );
}

// jedna stavka menija - deli je siroki meni i flyout panel
function NavLink({
  item,
  activeSection,
  posleOtvaranja,
}: {
  item: NavItem;
  activeSection: string | null;
  posleOtvaranja?: () => void;
}) {
  const open = useTabs((s) => s.open);
  return (
    <a
      className={activeSection === item.id ? "active" : ""}
      onClick={() => {
        open(item.id, item.label);
        posleOtvaranja?.();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) open(item.id, item.label, { forceNew: true });
      }}
      onContextMenu={(e) => {
        // desni klik: otvori u novom tabu (brief 3.2)
        e.preventDefault();
        open(item.id, item.label, { forceNew: true });
      }}
    >
      <span className="nav-l">
        <Ikona id={item.ikona} />
        {item.label}
      </span>
      {item.novi && <PlusNovi item={item} onOpened={posleOtvaranja} />}
    </a>
  );
}

// hover (150ms delay) otvara flyout desno od ankera; grejs-period pri zatvaranju
// da mis stigne do panela. Dele ga suzeni meni i skupljene grupe sirokog menija.
function useFlyout() {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  function pozicija() {
    const r = anchorRef.current?.getBoundingClientRect();
    return r ? { top: r.top, left: r.right + 2 } : null;
  }
  function otkazi() {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }
  function otkaziZatvaranje() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function otvori() {
    otkaziZatvaranje();
    setPos(pozicija());
  }
  function zakazi() {
    otkaziZatvaranje();
    hoverTimer.current = window.setTimeout(otvori, 150);
  }
  function zakaziZatvaranje() {
    otkazi();
    otkaziZatvaranje();
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  }
  function zatvori() {
    setPos(null);
  }
  useEffect(
    () => () => {
      otkazi();
      otkaziZatvaranje();
    },
    [],
  );
  return { pos, anchorRef, pozicija, otvori, zakazi, zakaziZatvaranje, otkaziZatvaranje, zatvori, setPos };
}

function FlyoutPanel({
  group,
  pos,
  activeSection,
  onMouseEnter,
  onMouseLeave,
  zatvori,
}: {
  group: RenderGrupa;
  pos: { top: number; left: number };
  activeSection: string | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  zatvori: () => void;
}) {
  return createPortal(
    <div
      className="nav-flyout"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 70,
        // flyout max-height + scroll pri dnu ekrana
        maxHeight: `calc(100vh - ${pos.top}px - 8px)`,
        overflowY: "auto",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="nav-flyout-naslov">{group.label}</div>
      {group.items.map((item) => (
        <NavLink key={item.id} item={item} activeSection={activeSection} posleOtvaranja={zatvori} />
      ))}
    </div>,
    document.body,
  );
}

function SortableGroup({
  group,
  activeSection,
  onToggle,
}: {
  group: RenderGrupa;
  activeSection: string | null;
  onToggle: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: group.id,
  });
  const fly = useFlyout();

  return (
    <div
      ref={setNodeRef}
      className="nav-group"
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        ref={(el) => {
          fly.anchorRef.current = el;
        }}
        title={group.collapsed ? "Klik: prikaži grupu" : "Klik: sakrij grupu"}
        onClick={() => {
          fly.zatvori();
          onToggle(group.id);
        }}
        onMouseEnter={group.collapsed ? fly.zakazi : undefined}
        onMouseLeave={group.collapsed ? fly.zakaziZatvaranje : undefined}
      >
        <Ikona id={group.ikona} size={13} />
        {group.label}
      </span>
      {!group.collapsed &&
        group.items.map((item) => <NavLink key={item.id} item={item} activeSection={activeSection} />)}
      {group.collapsed && fly.pos && (
        <FlyoutPanel
          group={group}
          pos={fly.pos}
          activeSection={activeSection}
          onMouseEnter={fly.otkaziZatvaranje}
          onMouseLeave={fly.zatvori}
          zatvori={fly.zatvori}
        />
      )}
    </div>
  );
}

// Ikonica grupe u collapsed rezimu (faza 15, RP6.2): hover ili klik otvara
// flyout panel desno od ikonice sa punim nazivima stavki grupe.
function CollapsedGroup({ group, activeSection }: { group: RenderGrupa; activeSection: string | null }) {
  const fly = useFlyout();
  const aktivna = group.items.some((i) => i.id === activeSection);

  return (
    <>
      <button
        ref={(el) => {
          fly.anchorRef.current = el;
        }}
        type="button"
        className={"nav-ikona" + (aktivna ? " active" : "")}
        title={group.label}
        onClick={() => (fly.pos ? fly.zatvori() : fly.otvori())}
        onMouseEnter={fly.zakazi}
        onMouseLeave={fly.zakaziZatvaranje}
      >
        <Ikona id={group.ikona} size={17} />
      </button>
      {fly.pos && (
        <FlyoutPanel
          group={group}
          pos={fly.pos}
          activeSection={activeSection}
          onMouseEnter={fly.otkaziZatvaranje}
          onMouseLeave={fly.zatvori}
          zatvori={fly.zatvori}
        />
      )}
    </>
  );
}

export function Sidebar({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [layout, setLayout] = useState<LayoutV2>(defaultLayout());
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const activeSection = tabs.find((t) => t.id === activeId)?.sectionId ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<Record<ModulId, boolean>>("/api/moduli") });
  // klik na naslov grupe posle DnD prevlacenja ne sme da toggluje collapse
  const drag = useRef(false);

  useEffect(() => {
    api<{ sidebarLayout: unknown }>("/api/moj-profil")
      .then((p) => setLayout(resolveLayout(p.sidebarLayout)))
      .catch(() => {});
    // editor menija u Podesavanjima javlja izmene bez reload-a
    const onLayout = (e: Event) => setLayout((e as CustomEvent<LayoutV2>).detail);
    window.addEventListener(LAYOUT_EVENT, onLayout);
    return () => window.removeEventListener(LAYOUT_EVENT, onLayout);
  }, []);

  function sacuvaj(next: LayoutV2) {
    // optimistic update - state se menja odmah, snimanje u pozadini
    setLayout(next);
    api("/api/moj-profil", { method: "PUT", body: { sidebarLayout: next } }).catch(() => {});
  }

  function onDragEnd(e: DragEndEvent) {
    window.setTimeout(() => {
      drag.current = false;
    }, 0);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(
      layout.groups,
      layout.groups.findIndex((g) => g.id === active.id),
      layout.groups.findIndex((g) => g.id === over.id),
    );
    sacuvaj({ ...layout, groups: next });
  }

  function toggleCollapsed() {
    sacuvaj({ ...layout, sidebarCollapsed: !layout.sidebarCollapsed });
  }

  function toggleGrupa(id: string) {
    if (drag.current) return;
    sacuvaj({
      ...layout,
      groups: layout.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    });
  }

  const collapsed = layout.sidebarCollapsed;
  const visibleGroups = renderGroups(layout)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        // sakrij stavke iskljucenih modula (stavka 2-4); dok se moduli ucitavaju prikazi sve
        const mod = NAV_MODUL[i.id];
        if (mod && moduli.data && !moduli.data[mod]) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="brand">
        {collapsed ? "A" : (
          <>
            Albatron
            <small>poslovni sistem</small>
          </>
        )}
      </div>
      <button
        type="button"
        className="side-collapse-btn"
        title={collapsed ? "Proširi meni" : "Skupi meni"}
        onClick={toggleCollapsed}
      >
        {collapsed ? "»" : "«"}
      </button>
      <nav className="nav">
        {collapsed ? (
          // DnD reorder ISKLJUCEN u collapsed rezimu; redosled iz snimljenog layouta
          visibleGroups.map((g) => (
            <CollapsedGroup key={g.id} group={g} activeSection={activeSection} />
          ))
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => {
              drag.current = true;
            }}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={visibleGroups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              {visibleGroups.map((g) => (
                <SortableGroup key={g.id} group={g} activeSection={activeSection} onToggle={toggleGrupa} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </nav>
      <div className="user">
        {!collapsed && (
          <>
            <b>{user.fullName}</b>
            <span>{user.isAdmin ? "Administrator" : user.username}</span>
          </>
        )}
        <div>
          <button onClick={onLogout} title="Odjava">
            {collapsed ? "⏻" : "Odjava"}
          </button>
        </div>
      </div>
    </aside>
  );
}
