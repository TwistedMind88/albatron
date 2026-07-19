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
import { DEFAULT_GROUPS, type NavGroup } from "./sections";

// ponytail: DnD preuredjuje redosled GRUPA; redosled stavki unutar grupe
// dodati kad zatreba (isti SortableContext obrazac, ugnjezden)
function orderedGroups(savedOrder: unknown): NavGroup[] {
  if (!Array.isArray(savedOrder)) return DEFAULT_GROUPS;
  const byId = new Map(DEFAULT_GROUPS.map((g) => [g.id, g]));
  const result: NavGroup[] = [];
  for (const id of savedOrder) {
    const g = byId.get(id as string);
    if (g) {
      result.push(g);
      byId.delete(id as string);
    }
  }
  result.push(...byId.values()); // nove grupe koje nisu u sacuvanom rasporedu
  return result;
}

function SortableGroup({ group, activeSection }: { group: NavGroup; activeSection: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: group.id,
  });
  const open = useTabs((s) => s.open);

  return (
    <div
      ref={setNodeRef}
      className="nav-group"
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
    >
      <span {...attributes} {...listeners}>
        <Ikona id={group.ikona} size={13} />
        {group.label}
      </span>
      {group.items.map((item) => (
        <a
          key={item.id}
          className={activeSection === item.id ? "active" : ""}
          onClick={() => open(item.id, item.label)}
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
          {item.novi && <PlusNovi item={item} />}
        </a>
      ))}
    </div>
  );
}

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

// Ikonica grupe u collapsed rezimu (faza 15, RP6.2): hover (150ms delay) ili
// klik otvara flyout panel desno od ikonice sa punim nazivima stavki grupe.
function CollapsedGroup({ group, activeSection }: { group: NavGroup; activeSection: string | null }) {
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const open = useTabs((s) => s.open);
  const aktivna = group.items.some((i) => i.id === activeSection);

  function pozicija() {
    const r = btnRef.current?.getBoundingClientRect();
    return r ? { top: r.top, left: r.right + 2 } : null;
  }
  function otvori() {
    otkaziZatvaranje();
    setFlyout(pozicija());
  }
  function zakazi() {
    otkaziZatvaranje();
    hoverTimer.current = window.setTimeout(otvori, 150);
  }
  function otkazi() {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }
  function otkaziZatvaranje() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  // kratak grejs-period da mis stigne sa ikonice do flyout panela
  function zakaziZatvaranje() {
    otkazi();
    otkaziZatvaranje();
    closeTimer.current = window.setTimeout(() => setFlyout(null), 120);
  }

  useEffect(
    () => () => {
      otkazi();
      otkaziZatvaranje();
    },
    [],
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"nav-ikona" + (aktivna ? " active" : "")}
        title={group.label}
        onClick={() => setFlyout((f) => (f ? null : pozicija()))}
        onMouseEnter={zakazi}
        onMouseLeave={zakaziZatvaranje}
      >
        <Ikona id={group.ikona} size={17} />
      </button>
      {flyout &&
        createPortal(
          <div
            className="nav-flyout"
            style={{
              position: "fixed",
              top: flyout.top,
              left: flyout.left,
              zIndex: 70,
              // flyout max-height + scroll pri dnu ekrana
              maxHeight: `calc(100vh - ${flyout.top}px - 8px)`,
              overflowY: "auto",
            }}
            onMouseEnter={otkaziZatvaranje}
            onMouseLeave={() => setFlyout(null)}
          >
            <div className="nav-flyout-naslov">{group.label}</div>
            {group.items.map((item) => (
              <a
                key={item.id}
                className={activeSection === item.id ? "active" : ""}
                onClick={() => {
                  open(item.id, item.label);
                  setFlyout(null);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) open(item.id, item.label, { forceNew: true });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  open(item.id, item.label, { forceNew: true });
                }}
              >
                <span className="nav-l">
                  <Ikona id={item.ikona} />
                  {item.label}
                </span>
                {item.novi && <PlusNovi item={item} onOpened={() => setFlyout(null)} />}
              </a>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Sidebar({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [groups, setGroups] = useState<NavGroup[]>(DEFAULT_GROUPS);
  const [collapsed, setCollapsed] = useState(false);
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const activeSection = tabs.find((t) => t.id === activeId)?.sectionId ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<Record<ModulId, boolean>>("/api/moduli") });

  useEffect(() => {
    api<{ sidebarLayout: unknown }>("/api/moj-profil")
      .then((p) => {
        // stari format: niz id-jeva grupa; novi (faza 15, RP6.2): { order, collapsed }
        const l = p.sidebarLayout as { order?: unknown; collapsed?: unknown } | unknown[] | null;
        if (Array.isArray(l)) {
          setGroups(orderedGroups(l));
        } else if (l && typeof l === "object") {
          setGroups(orderedGroups((l as { order?: unknown }).order));
          setCollapsed((l as { collapsed?: unknown }).collapsed === true);
        }
      })
      .catch(() => {});
  }, []);

  function sacuvajLayout(order: string[], coll: boolean) {
    // optimistic update - state je vec promenjen pre poziva
    api("/api/moj-profil", {
      method: "PUT",
      body: { sidebarLayout: { order, collapsed: coll } },
    }).catch(() => {});
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setGroups((gs) => {
      const next = arrayMove(
        gs,
        gs.findIndex((g) => g.id === active.id),
        gs.findIndex((g) => g.id === over.id),
      );
      sacuvajLayout(next.map((g) => g.id), collapsed);
      return next;
    });
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    sacuvajLayout(groups.map((g) => g.id), next);
  }

  const visibleGroups = groups
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={visibleGroups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              {visibleGroups.map((g) => (
                <SortableGroup key={g.id} group={g} activeSection={activeSection} />
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
