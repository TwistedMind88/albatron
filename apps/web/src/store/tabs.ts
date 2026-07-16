import { createContext, useContext, useEffect } from "react";
import { create } from "zustand";

export interface Tab {
  id: string;
  // sekcija kojoj tab pripada (kljuc iz sidebar definicije)
  sectionId: string;
  title: string;
  dirty: boolean;
  // podaci za stranicu taba (npr. filteri rezultata obracuna)
  payload?: unknown;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  // tab ciji je zahtev za zatvaranje presretnut popupom (dirty)
  closing: string | null;
  open: (sectionId: string, title: string, opts?: { forceNew?: boolean; payload?: unknown }) => void;
  activate: (id: string) => void;
  requestClose: (id: string) => void;
  confirmClose: () => void;
  cancelClose: () => void;
  setDirty: (id: string, dirty: boolean) => void;
  reorder: (fromId: string, toId: string) => void;
}

let counter = 0;

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  closing: null,

  open: (sectionId, title, opts) => {
    const { tabs } = get();
    if (!opts?.forceNew) {
      const existing = tabs.find((t) => t.sectionId === sectionId);
      if (existing) {
        set({ activeId: existing.id });
        return;
      }
    }
    const tab: Tab = { id: `tab-${++counter}`, sectionId, title, dirty: false, payload: opts?.payload };
    // novi tab se otvara skroz levo (brief 3.2)
    set({ tabs: [tab, ...tabs], activeId: tab.id });
  },

  activate: (id) => set({ activeId: id }),

  requestClose: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      set({ closing: id });
      return;
    }
    closeNow(id, set, get);
  },

  confirmClose: () => {
    const id = get().closing;
    if (id) closeNow(id, set, get);
    set({ closing: null });
  },

  cancelClose: () => {
    // "Vrati se u dokument" - aktiviraj tab koji je pokusan da se zatvori
    const id = get().closing;
    set({ closing: null, ...(id ? { activeId: id } : {}) });
  },

  setDirty: (id, dirty) =>
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) }),

  reorder: (fromId, toId) => {
    const tabs = [...get().tabs];
    const from = tabs.findIndex((t) => t.id === fromId);
    const to = tabs.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved!);
    set({ tabs });
  },
}));

// Id taba u kome se stranica renderuje - postavlja ga Shell
export const TabIdContext = createContext<string | null>(null);

// Stranica prijavljuje da li ima nesnimljene izmene; pali kruzic na tabu
// i popup upozorenja pri zatvaranju. Na unmount se dirty gasi.
export function useMarkDirty(dirty: boolean) {
  const tabId = useContext(TabIdContext);
  const setDirty = useTabs((s) => s.setDirty);
  useEffect(() => {
    if (!tabId) return;
    setDirty(tabId, dirty);
    return () => setDirty(tabId, false);
  }, [tabId, dirty, setDirty]);
}

function closeNow(
  id: string,
  set: (s: Partial<TabsState>) => void,
  get: () => TabsState,
) {
  const { tabs, activeId } = get();
  const idx = tabs.findIndex((t) => t.id === id);
  const next = tabs.filter((t) => t.id !== id);
  let nextActive = activeId;
  if (activeId === id) {
    nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
  }
  set({ tabs: next, activeId: nextActive });
}
