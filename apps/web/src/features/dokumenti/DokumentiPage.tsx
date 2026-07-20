import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "../../api";
import { DataTable } from "../../components/DataTable";
import { FilterDugme, type FilterVrednosti } from "../../components/FilterDugme";
import { FILTERI, TIP_INFO, fmt } from "./common";
import { DokumentView } from "./DokumentView";

interface Red {
  id: number;
  broj: string;
  datum: string;
  status: string;
  smer: string | null;
  klijentNaziv: string;
  referencaKupca: string;
  valuta: string;
  referent: string | null;
  suma: string;
}

export function DokumentiPage({ tip, payload }: { tip: string; payload?: unknown }) {
  // payload { novi: true } iz sidebara "+": tab se otvara direktno na novom dokumentu (faza 16, st. 46)
  // payload { openId } iz obavestenja/dashboarda: tab se otvara direktno na tom dokumentu
  const [openId, setOpenId] = useState<number | "nov" | null>(() => {
    const p = payload && typeof payload === "object" ? (payload as { novi?: boolean; openId?: number }) : null;
    if (p?.novi) return "nov";
    if (typeof p?.openId === "number") return p.openId;
    return null;
  });
  const [filteri, setFilteri] = useState<FilterVrednosti>({});
  const [fTekst, setFTekst] = useState("");

  const query = useQuery({
    queryKey: ["dokumenti", tip],
    queryFn: () => api<Red[]>(`/api/dokumenti?tip=${tip}`),
  });

  const COLUMNS = useMemo(
    () => ([
      {
        accessorKey: "broj",
        header: "Broj",
        // dokument kao link, ne samo dvoklik (stavka 10)
        cell: (c: any) => (
          <a className="link" onClick={() => setOpenId(c.row.original.id)}>
            {c.getValue()}
          </a>
        ),
      },
      {
        accessorKey: "datum",
        header: "Datum",
        cell: (c) => new Date(c.getValue() as string).toLocaleDateString("sr-RS"),
      },
      { accessorKey: "klijentNaziv", header: "Klijent" },
      ...(tip === "revers"
        ? [{ accessorKey: "smer", header: "Smer" } as ColumnDef<Red, any>]
        : [
            {
              accessorKey: "suma",
              header: "Suma (bez PDV)",
              cell: (c: any) => `${fmt(Number(c.getValue()))} ${c.row.original.valuta}`,
            } as ColumnDef<Red, any>,
          ]),
      { accessorKey: "status", header: "Status" },
      { accessorKey: "referencaKupca", header: "Referenca kupca" },
      { accessorKey: "referent", header: "Referent" },
    ] as (ColumnDef<Red, any> & { defaultVisible?: boolean })[]).map((c) => ({ ...c, defaultVisible: true })),
    [tip],
  );

  if (openId !== null) {
    return (
      <DokumentView
        tip={tip}
        id={openId === "nov" ? null : openId}
        onBack={() => {
          setOpenId(null);
          query.refetch();
        }}
        onOpenDoc={(id) => setOpenId(id)}
      />
    );
  }

  const defs = FILTERI[tip] ?? [];
  const rows = query.data ?? [];
  // opcije multi filtera = distinct vrednosti iz vec ucitanih redova; "" = "(prazno)"
  const opcije = Object.fromEntries(
    defs
      .filter((f) => f.vrsta === "multi")
      .map((f) => [
        f.key,
        [...new Set(rows.map((d) => String((d as any)[f.key] ?? "")))].sort((a, b) =>
          a.localeCompare(b, "sr-RS"),
        ),
      ]),
  );

  const t = fTekst.toLowerCase();
  const data = rows.filter((d) => {
    if (
      t &&
      !d.broj.toLowerCase().includes(t) &&
      !d.klijentNaziv.toLowerCase().includes(t) &&
      !(d.referent ?? "").toLowerCase().includes(t) &&
      !d.referencaKupca.toLowerCase().includes(t)
    )
      return false;
    // AND kombinacija svih aktivnih filtera (faza 15, RP6.1)
    return defs.every((f) => {
      const v = filteri[f.key];
      if (!v) return true;
      if (f.vrsta === "multi") {
        const izbor = v as string[];
        return izbor.length === 0 || izbor.includes(String((d as any)[f.key] ?? ""));
      }
      const { od, do: doDatuma } = v as { od: string; do: string };
      const datum = String((d as any)[f.key] ?? "").slice(0, 10);
      return (!od || datum >= od) && (!doDatuma || datum <= doDatuma);
    });
  });

  return (
    <>
      <div className="page-head">
        <h1>{TIP_INFO[tip]?.mnozina ?? tip}</h1>
      </div>
      <DataTable
        tableId={`dokumenti-${tip}`}
        data={data}
        columns={COLUMNS}
        columnPicker
        hideSearch
        onRowDoubleClick={(d) => setOpenId(d.id)}
        leftToolbar={
          <button className="btn primary" onClick={() => setOpenId("nov")}>
            + Novi
          </button>
        }
        toolbar={
          <>
            <input
              className="input"
              placeholder="Pretraga (broj, klijent, referent...)"
              value={fTekst}
              onChange={(e) => setFTekst(e.target.value)}
              style={{ width: 220 }}
            />
            <FilterDugme defs={defs} opcije={opcije} vrednosti={filteri} onChange={setFilteri} />
          </>
        }
      />
    </>
  );
}
