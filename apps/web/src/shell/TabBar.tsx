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
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useTabs, type Tab } from "../store/tabs";

const jeTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Window kontrole (min/max/close) u redu sa tabovima - samo u desktop (Tauri)
// aplikaciji bez native title bara (stavka 53)
async function windowAkcija(akcija: "minimize" | "toggleMaximize" | "close") {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[akcija]();
}

function WindowControls() {
  return (
    <div className="wincontrols">
      <button className="winbtn" title="Minimizuj" onClick={() => void windowAkcija("minimize")}>
        &#x2013;
      </button>
      <button className="winbtn" title="Maksimizuj / vrati" onClick={() => void windowAkcija("toggleMaximize")}>
        &#x25a1;
      </button>
      <button className="winbtn danger" title="Zatvori" onClick={() => void windowAkcija("close")}>
        &#x2715;
      </button>
    </div>
  );
}

function TabEl({ tab, active }: { tab: Tab; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: tab.id,
  });
  const activate = useTabs((s) => s.activate);
  const requestClose = useTabs((s) => s.requestClose);

  return (
    <div
      ref={setNodeRef}
      className={`tab${active ? " active" : ""}`}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
      onClick={() => activate(tab.id)}
      onMouseUp={(e) => {
        // middle click zatvara tab (brief 3.2); auxclick se ne emituje jer
        // dnd-kit PointerSensor progura preventDefault na pointerdown
        if (e.button === 1) requestClose(tab.id);
      }}
      {...attributes}
      {...listeners}
    >
      {tab.dirty && <span className="dot" title="Nesnimljene izmene" />}
      {tab.title}
      <span
        className="x"
        onClick={(e) => {
          e.stopPropagation();
          requestClose(tab.id);
        }}
      >
        ×
      </span>
    </div>
  );
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const reorder = useTabs((s) => s.reorder);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) reorder(String(active.id), String(over.id));
  }

  return (
    <>
      {/* uzak pojas iznad tabova za hvatanje i prevlacenje prozora (stavka 53) */}
      {jeTauri && <div className="dragstrip" data-tauri-drag-region />}
      <div className="tabbar">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((t) => (
              <TabEl key={t.id} tab={t} active={t.id === activeId} />
            ))}
          </SortableContext>
        </DndContext>
        {/* prazan prostor izmedju tabova i kontrola je takodje povrsina za prevlacenje */}
        {jeTauri && (
          <>
            <div className="dragfill" data-tauri-drag-region />
            <WindowControls />
          </>
        )}
      </div>
    </>
  );
}

export function UnsavedPopup() {
  const closing = useTabs((s) => s.closing);
  const confirmClose = useTabs((s) => s.confirmClose);
  const cancelClose = useTabs((s) => s.cancelClose);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.closing));

  if (!closing) return null;
  return (
    <div className="overlay">
      <div className="popup">
        <h2>Nesnimljene izmene</h2>
        <p>Dokument "{tab?.title}" ima nesnimljene izmene. Ako zatvorite tab, izmene se gube.</p>
        <div className="actions">
          <button className="btn primary" onClick={cancelClose}>
            Vrati se u dokument
          </button>
          <button className="btn subtle" onClick={confirmClose}>
            Zatvori bez snimanja
          </button>
        </div>
      </div>
    </div>
  );
}
