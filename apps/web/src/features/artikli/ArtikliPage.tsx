import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { aktivnaAkcija } from "@albatron/shared";
import { api } from "../../api";
import { sacuvajFajl } from "../../download";
import { useTabs } from "../../store/tabs";
import { DataTable } from "../../components/DataTable";
import { ArtikalView } from "./ArtikalView";

export interface Artikal {
  id: number;
  ident: string;
  tip: string;
  parentId: number | null;
  naziv: string;
  opis: string;
  napomena: string;
  dobavljacId: number | null;
  sku: string;
  prodajnaCena: string | null;
  prodajnaValuta: string;
  kurs: string | null;
  marza: string | null;
  dobavljacevaCena: string | null;
  dobavljacevaValuta: string;
  ocekivaniPopust: string | null;
  carinskaStopa: string | null;
  sertifikacijaStopa: string | null;
  dodatniTroskoviStopa: string | null;
  zemljaPorekla: string;
  carinskaTarifa: string;
  porezId: number | null;
  glavnaKategorijaId: number | null;
  sekundarnaKategorijaId: number | null;
  active: boolean;
  discontinued: boolean;
  akcijaProcenat: string | null;
  akcijaOd: string | null;
  akcijaDo: string | null;
  akcijaNeograniceno: boolean;
  serijskiBrojevi: boolean;
}

const TIP_LABEL: Record<string, string> = { obican: "", parent: "Parent", varijacija: "Varijacija" };

// ident kao link otvara artikal (faza 15, RP1.3)
const columns = (open: (id: number) => void): (ColumnDef<Artikal, any> & { defaultVisible?: boolean })[] => [
  {
    accessorKey: "ident",
    header: "Ident",
    defaultVisible: true,
    cell: (c) => (
      <a className="link" onClick={() => open(c.row.original.id)}>
        {c.getValue() as string}
      </a>
    ),
  },
  {
    accessorKey: "tip",
    header: "Tip",
    defaultVisible: true,
    cell: (c) => TIP_LABEL[c.getValue() as string] ?? "",
  },
  { accessorKey: "naziv", header: "Naziv", defaultVisible: true },
  { accessorKey: "sku", header: "SKU", defaultVisible: true },
  {
    accessorKey: "prodajnaCena",
    header: "Prodajna cena",
    defaultVisible: true,
    cell: (c) => {
      const a = c.row.original;
      if (a.prodajnaCena === null) return "";
      const akcija = aktivnaAkcija({
        akcijaProcenat: a.akcijaProcenat === null ? null : Number(a.akcijaProcenat),
        akcijaOd: a.akcijaOd,
        akcijaDo: a.akcijaDo,
        akcijaNeograniceno: a.akcijaNeograniceno,
      });
      return (
        <>
          {Number(a.prodajnaCena).toLocaleString("sr-RS")} {a.prodajnaValuta}
          {akcija && (
            <span style={{ color: "var(--danger)", marginLeft: 6, fontSize: 11 }}>
              -{Number(a.akcijaProcenat)}%
            </span>
          )}
        </>
      );
    },
  },
  { accessorKey: "zemljaPorekla", header: "Zemlja porekla" },
  { accessorKey: "carinskaTarifa", header: "Carinska tarifa" },
  { accessorKey: "discontinued", header: "Discontinued", cell: (c) => (c.getValue() ? "Da" : "") },
  { accessorKey: "active", header: "Aktivan", defaultVisible: true, cell: (c) => (c.getValue() ? "Da" : "Ne") },
];

export function ArtikliPage({ payload }: { payload?: unknown }) {
  // dvoklik na artikal u dokumentu otvara ga u ovom tabu (stavka 11)
  const initId = (payload as { openId?: number } | undefined)?.openId ?? null;
  const [openId, setOpenId] = useState<number | "nov" | null>(initId);
  const openTab = useTabs((s) => s.open);

  const query = useQuery({ queryKey: ["artikli"], queryFn: () => api<Artikal[]>("/api/artikli") });

  if (openId !== null) {
    return (
      <ArtikalView
        id={openId === "nov" ? null : openId}
        onBack={() => {
          setOpenId(null);
          query.refetch();
        }}
        onOpen={(id) => setOpenId(id)}
      />
    );
  }

  // lista prikazuje varijacije i obicne artikle (parent je sablon, faza 14.2)
  const data = (query.data ?? []).filter((a) => a.tip !== "parent");

  function exportExcel() {
    const rows = data.map((a) => ({
      Ident: a.ident,
      Tip: TIP_LABEL[a.tip] ?? "",
      Naziv: a.naziv,
      SKU: a.sku,
      "Prodajna cena": a.prodajnaCena,
      Valuta: a.prodajnaValuta,
      Aktivan: a.active ? "Da" : "Ne",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Artikli");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl("artikli.xlsx", new Blob([buf]));
  }

  return (
    <>
      <div className="page-head">
        <h1>Artikli</h1>
      </div>
      <DataTable
        data={data}
        columns={columns(setOpenId)}
        columnPicker
        onRowDoubleClick={(a) => setOpenId(a.id)}
        toolbar={
          <>
            <button className="btn" onClick={() => openTab("artikli-import", "Import artikala")}>
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
