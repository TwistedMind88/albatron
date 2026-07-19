import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "../../api";
import { DataTable } from "../../components/DataTable";
import { CenovnikView } from "./CenovnikView";
import { UvozPopup } from "./UvozPopup";

export interface Cenovnik {
  id: number;
  naziv: string;
  dobavljacId: number;
  dobavljac: string;
  valuta: string;
  vaziOd: string;
  createdAt: string;
  brojStavki: number;
}

const COLUMNS: ColumnDef<Cenovnik, any>[] = [
  { accessorKey: "naziv", header: "Naziv" },
  { accessorKey: "dobavljac", header: "Dobavljač" },
  { accessorKey: "valuta", header: "Valuta" },
  {
    accessorKey: "vaziOd",
    header: "Važi od",
    cell: (c) => new Date(c.getValue() as string).toLocaleDateString("sr-RS"),
  },
  { accessorKey: "brojStavki", header: "Stavki" },
];

export function CenovniciPage() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [uvoz, setUvoz] = useState(false);

  const query = useQuery({
    queryKey: ["cenovnici"],
    queryFn: () => api<Cenovnik[]>("/api/cenovnici"),
  });

  if (openId !== null) {
    return <CenovnikView id={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <>
      <div className="page-head">
        <h1>Cenovnici</h1>
      </div>
      <DataTable
        tableId="cenovnici"
        data={query.data ?? []}
        columns={COLUMNS}
        onRowDoubleClick={(c) => setOpenId(c.id)}
        toolbar={
          <button className="btn primary" onClick={() => setUvoz(true)}>
            + Uvezi cenovnik
          </button>
        }
      />
      {uvoz && (
        <UvozPopup
          onDone={() => {
            setUvoz(false);
            query.refetch();
          }}
          onCancel={() => setUvoz(false)}
        />
      )}
    </>
  );
}
