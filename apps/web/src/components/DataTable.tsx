import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

// Jedna tabela za SVE liste (brief 3.3): bez paginacije, sortiranje po svakoj
// koloni, kompaktna gustina, globalna pretraga, izbor kolona.
// ponytail: redosled/resize kolona i pamcenje po korisniku dodati kad zatreba
// (TanStack column order/sizing state + PUT moj-profil)
export function DataTable<T>({
  data,
  columns,
  toolbar,
  leftToolbar,
  hideSearch,
  columnPicker,
  onRowDoubleClick,
}: {
  data: T[];
  columns: (ColumnDef<T, any> & { defaultVisible?: boolean })[];
  toolbar?: React.ReactNode;
  leftToolbar?: React.ReactNode;
  hideSearch?: boolean;
  columnPicker?: boolean;
  onRowDoubleClick?: (row: T) => void;
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

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

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
        <table className="data">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
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
