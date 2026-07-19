import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { api } from "../../api";
import { sacuvajFajl } from "../../download";
import { DataTable } from "../../components/DataTable";
import { SubjekatView } from "./SubjekatView";
import { useTabs } from "../../store/tabs";

export interface Subjekat {
  id: number;
  role: string;
  naziv: string;
  puniNaziv: string;
  adresa: string;
  postanskiBroj: string;
  grad: string;
  pib: string;
  mb: string;
  drzava: string;
  nacinPlacanjaId: number | null;
  paritetId: number | null;
  valuta: string;
  active: boolean;
}

function RoleFlags({ role }: { role: string }) {
  // flagovi u boji; flag koji subjekat nema se NE prikazuje (brief 4.1)
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {(role === "klijent" || role === "oba") && (
        <span style={{ color: "var(--accent-ink)", border: "1px solid var(--accent)", borderRadius: 3, padding: "0 5px", fontSize: 10.5 }}>
          Klijent
        </span>
      )}
      {(role === "dobavljac" || role === "oba") && (
        <span style={{ color: "var(--warn)", border: "1px solid var(--warn)", borderRadius: 3, padding: "0 5px", fontSize: 10.5 }}>
          Dobavljač
        </span>
      )}
    </span>
  );
}

// Sve kolone subjekta - osnovne su podrazumevano vidljive, ostale kroz izbor kolona (brief 4.5)
// naziv kao link otvara subjekat (faza 15, RP1.3; subjekti nemaju ident kolonu)
const allColumns = (open: (id: number) => void): (ColumnDef<Subjekat, any> & { defaultVisible?: boolean })[] => [
  {
    accessorKey: "naziv",
    header: "Naziv",
    defaultVisible: true,
    cell: (c) => (
      <a className="link" onClick={() => open(c.row.original.id)}>
        {c.getValue() as string}
      </a>
    ),
  },
  { accessorKey: "adresa", header: "Adresa", defaultVisible: true },
  { accessorKey: "pib", header: "PIB", defaultVisible: true },
  { accessorKey: "postanskiBroj", header: "Poštanski broj", defaultVisible: true },
  { accessorKey: "grad", header: "Grad", defaultVisible: true },
  {
    accessorKey: "role",
    header: "Uloge",
    defaultVisible: true,
    cell: (c) => <RoleFlags role={c.getValue()} />,
  },
  { accessorKey: "puniNaziv", header: "Puni naziv" },
  { accessorKey: "mb", header: "MB" },
  { accessorKey: "drzava", header: "Država" },
  { accessorKey: "valuta", header: "Valuta" },
  { accessorKey: "active", header: "Aktivan", cell: (c) => (c.getValue() ? "Da" : "Ne") },
];

export function SubjektiPage({ uloga, payload }: { uloga: "klijent" | "dobavljac"; payload?: unknown }) {
  // dvoklik na subjekat u dokumentu otvara ga u ovom tabu (stavka 11)
  const initId = (payload as { openId?: number } | undefined)?.openId ?? null;
  const [openId, setOpenId] = useState<number | "nov" | null>(initId);
  const openTab = useTabs((s) => s.open);
  const naslov = uloga === "klijent" ? "Klijenti" : "Dobavljači";

  const query = useQuery({
    queryKey: ["subjekti", uloga],
    queryFn: () => api<Subjekat[]>(`/api/subjekti?uloga=${uloga}`),
  });

  if (openId !== null) {
    return (
      <SubjekatView
        id={openId === "nov" ? null : openId}
        uloga={uloga}
        onBack={() => {
          setOpenId(null);
          query.refetch();
        }}
      />
    );
  }

  function exportExcel() {
    const rows = (query.data ?? []).map((s) => ({
      Naziv: s.naziv,
      "Puni naziv": s.puniNaziv,
      Adresa: s.adresa,
      "Poštanski broj": s.postanskiBroj,
      Grad: s.grad,
      PIB: s.pib,
      MB: s.mb,
      Država: s.drzava,
      Valuta: s.valuta,
      Uloga: s.role,
      Aktivan: s.active ? "Da" : "Ne",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, naslov);
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl(`${naslov.toLowerCase()}.xlsx`, new Blob([buf]));
  }

  return (
    <>
      <div className="page-head">
        <h1>{naslov}</h1>
      </div>
      <DataTable
        tableId="subjekti"
        data={query.data ?? []}
        columns={allColumns(setOpenId)}
        columnPicker
        onRowDoubleClick={(s) => setOpenId(s.id)}
        toolbar={
          <>
            <button className="btn" onClick={() => openTab(`${uloga === "klijent" ? "klijenti" : "dobavljaci"}-import`, `Import - ${naslov}`)}>
              Import
            </button>
            <button className="btn" onClick={exportExcel}>
              Export
            </button>
            <button className="btn primary" onClick={() => setOpenId("nov")}>
              + Novi
            </button>
          </>
        }
      />
    </>
  );
}
