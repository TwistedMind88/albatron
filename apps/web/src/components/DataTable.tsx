import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

// Jedna tabela za SVE liste (brief 3.3): bez paginacije, sortiranje po svakoj
// koloni, kompaktna gustina, globalna pretraga, izbor kolona, resize i
// prevlacenje kolona. Uz tableId se redosled/sirine pamte po korisniku
// (uiPrefs.tabele[tableId] preko PUT moj-profil).

interface KolonePrefs {
  order?: string[];
  sizing?: Record<string, number>;
}

interface Profil {
  uiPrefs?: { tabele?: Record<string, KolonePrefs> } & Record<string, unknown>;
}

// Cita i snima redosled/sirine kolona po korisniku; koristi ga i UplatePage
export function useKolonePrefs(tableId?: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["moj-profil"],
    queryFn: () => api<Profil>("/api/moj-profil"),
    enabled: !!tableId,
  });
  const saved = tableId ? q.data?.uiPrefs?.tabele?.[tableId] : undefined;
  function save(order: string[], sizing: Record<string, number>) {
    if (!tableId) return;
    const prefs = (qc.getQueryData<Profil>(["moj-profil"])?.uiPrefs ?? {}) as NonNullable<Profil["uiPrefs"]>;
    const next = { ...prefs, tabele: { ...(prefs.tabele ?? {}), [tableId]: { order, sizing } } };
    qc.setQueryData<Profil>(["moj-profil"], (d) => ({ ...d, uiPrefs: next }));
    api("/api/moj-profil", { method: "PUT", body: { uiPrefs: next } }).catch(() => {});
  }
  return { saved, save };
}
export function DataTable<T>({
  data,
  columns,
  toolbar,
  leftToolbar,
  hideSearch,
  columnPicker,
  onRowDoubleClick,
  tableId,
  compact,
}: {
  data: T[];
  columns: (ColumnDef<T, any> & { defaultVisible?: boolean })[];
  toolbar?: React.ReactNode;
  leftToolbar?: React.ReactNode;
  hideSearch?: boolean;
  columnPicker?: boolean;
  onRowDoubleClick?: (row: T) => void;
  // jedinstven kljuc za pamcenje redosleda/sirina po korisniku
  tableId?: string;
  // "stavke" gustina - isti padding kao lista stavki u dokumentima
  compact?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const initialVisibility = useMemo<VisibilityState>(() => {
    if (!columnPicker) return {};
    const v: VisibilityState = {};
    for (const c of columns) {
      const id = (c as { accessorKey?: string }).accessorKey ?? c.id;
      if (id) v[id] = c.defaultVisible ?? false;
    }
    return v;
  }, [columns, columnPicker]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialVisibility);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [dragCol, setDragCol] = useState<string | null>(null);

  const { saved, save } = useKolonePrefs(tableId);
  const applied = useRef(false);
  useEffect(() => {
    if (!saved || applied.current) return;
    applied.current = true;
    if (saved.order?.length) setColumnOrder(saved.order);
    if (saved.sizing && Object.keys(saved.sizing).length) setColumnSizing(saved.sizing);
  }, [saved]);
  // snimanje sa zadrskom (resize okida promene neprekidno)
  const prviRender = useRef(true);
  useEffect(() => {
    if (!tableId) return;
    if (prviRender.current) {
      prviRender.current = false;
      return;
    }
    const t = setTimeout(() => save(columnOrder, columnSizing), 600);
    return () => clearTimeout(t);
  }, [columnOrder, columnSizing]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility, columnOrder, columnSizing },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // sirine primenjujemo tek kad korisnik nesto resize-uje, inace auto layout
  const resized = Object.keys(columnSizing).length > 0;

  return (
    <>
      <div className="toolbar">
        {leftToolbar}
        {!hideSearch && (
          <input
            className="input"
            placeholder="Pretraga..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        )}
        <div className="grow" />
        {columnPicker && (
          <div style={{ position: "relative" }}>
            <button className="btn" onClick={() => setShowPicker(!showPicker)}>
              Kolone
            </button>
            {showPicker && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  zIndex: 60,
                  background: "var(--surface)",
                  border: "1px solid var(--line-strong)",
                  borderRadius: "var(--radius)",
                  padding: 8,
                  boxShadow: "0 4px 12px rgba(0,0,0,.08)",
                  whiteSpace: "nowrap",
                }}
              >
                {table.getAllLeafColumns().map((col) => (
                  <label key={col.id} style={{ display: "flex", gap: 6, fontSize: 12, padding: "2px 4px" }}>
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                    />
                    {String(col.columnDef.header)}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {toolbar}
      </div>
      <div className="tablewrap">
        <table
          className={`data${compact ? " stavke" : ""}${resized ? " fixed" : ""}`}
          style={resized ? { width: table.getTotalSize() } : undefined}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={resized ? { width: h.getSize() } : undefined}
                    draggable
                    onDragStart={() => setDragCol(h.column.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!dragCol || dragCol === h.column.id) return;
                      const order = table.getAllLeafColumns().map((c) => c.id);
                      order.splice(order.indexOf(dragCol), 1);
                      order.splice(order.indexOf(h.column.id), 0, dragCol);
                      setColumnOrder(order);
                      setDragCol(null);
                    }}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                    <span
                      className="col-resizer"
                      onMouseDown={h.getResizeHandler()}
                      onTouchStart={h.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} onDoubleClick={() => onRowDoubleClick?.(row.original)}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
