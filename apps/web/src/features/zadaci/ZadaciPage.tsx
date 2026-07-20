import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, ApiError } from "../../api";
import { useTabs } from "../../store/tabs";
import { DataTable } from "../../components/DataTable";
import { FilterDugme, type FilterVrednosti } from "../../components/FilterDugme";
import type { FilterDef } from "../dokumenti/common";
import { ZadatakView } from "./ZadatakView";

// tip dokumenta -> sidebar sekcija (za otvaranje dokumenta iz zadatka)
const TIP_SEKCIJA: Record<string, string> = {
  ponuda: "ponude",
  predracun: "predracuni",
  revers: "reversi",
  kalkulacija: "kalkulacije",
  otpremnica: "otpremnice",
  racun: "racuni",
  avansni_racun: "avansni-racuni",
  porudzbina: "porudzbine",
  priprema_uvoza: "priprema-za-uvoz",
  ulaz_robe: "ulaz-robe",
};

export interface ZadatakIzvrsilac {
  userId: number;
  ime: string;
  status: string; // pozvan|prihvatio|odbio
}

export interface ZadatakRed {
  id: number;
  naziv: string;
  prioritet: string;
  status: string;
  rok: string | null;
  subjektId: number | null;
  subjektNaziv: string | null;
  dokumentId: number | null;
  dokumentBroj: string | null;
  dokumentTip: string | null;
  kreiraoId: number;
  kreiraoIme: string;
  izvrsioci: ZadatakIzvrsilac[];
  mojaPozivnica: boolean;
}

const PRIORITET_LABEL: Record<string, string> = { nizak: "Nizak", srednji: "Srednji", visok: "Visok" };

function rokPrikaz(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.`;
}

const FILTERI: FilterDef[] = [
  { key: "prioritet", label: "Prioritet", vrsta: "multi" },
  { key: "subjektNaziv", label: "Subjekat", vrsta: "multi" },
  { key: "dokumentBroj", label: "Dokument", vrsta: "multi" },
];

export function ZadaciPage({ payload }: { payload?: unknown }) {
  const openTab = useTabs((s) => s.open);
  const otvoriId = (payload as { openId?: number } | undefined)?.openId;
  const [tab, setTab] = useState<"aktivni" | "zavrseni">("aktivni");
  const [view, setView] = useState<"lista" | number | "novi">(otvoriId ?? "lista");
  const [filteri, setFilteri] = useState<FilterVrednosti>({});
  const [greska, setGreska] = useState("");

  const status = tab === "aktivni" ? "aktivan" : "zavrsen";
  const query = useQuery({
    queryKey: ["zadaci", status],
    queryFn: () => api<ZadatakRed[]>(`/api/zadaci?status=${status}`),
  });

  async function odgovori(id: number, akcija: "prihvati" | "odbij") {
    setGreska("");
    try {
      await api(`/api/zadaci/${id}/${akcija}`, { method: "POST" });
      void query.refetch();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska");
    }
  }

  function otvoriDokument(r: ZadatakRed) {
    const sekcija = r.dokumentTip ? TIP_SEKCIJA[r.dokumentTip] : undefined;
    if (r.dokumentId && sekcija) openTab(sekcija, r.dokumentBroj ?? "", { forceNew: true, payload: { openId: r.dokumentId } });
  }

  const podaci = useMemo(() => {
    let rows = query.data ?? [];
    for (const def of FILTERI) {
      const v = filteri[def.key];
      if (!Array.isArray(v) || v.length === 0) continue;
      rows = rows.filter((r) => {
        const val = def.key === "prioritet" ? PRIORITET_LABEL[r.prioritet] ?? r.prioritet : String(r[def.key as keyof ZadatakRed] ?? "");
        return v.includes(val);
      });
    }
    return rows;
  }, [query.data, filteri]);

  const filterOpcije = useMemo(() => {
    const rows = query.data ?? [];
    const uniq = (vals: string[]) => [...new Set(vals.filter(Boolean))].sort();
    return {
      prioritet: uniq(rows.map((r) => PRIORITET_LABEL[r.prioritet] ?? r.prioritet)),
      subjektNaziv: uniq(rows.map((r) => r.subjektNaziv ?? "")),
      dokumentBroj: uniq(rows.map((r) => r.dokumentBroj ?? "")),
    };
  }, [query.data]);

  const columns = useMemo<(ColumnDef<ZadatakRed, any> & { defaultVisible?: boolean })[]>(
    () => [
      { accessorKey: "naziv", header: "Naziv", defaultVisible: true },
      {
        accessorKey: "prioritet",
        header: "Prioritet",
        defaultVisible: true,
        cell: (c) => PRIORITET_LABEL[c.getValue<string>()] ?? c.getValue<string>(),
      },
      { accessorKey: "subjektNaziv", header: "Subjekat", defaultVisible: true },
      {
        accessorKey: "dokumentBroj",
        header: "Dokument",
        defaultVisible: true,
        cell: (c) => {
          const r = c.row.original;
          return r.dokumentBroj ? (
            <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={(e) => { e.stopPropagation(); otvoriDokument(r); }}>
              {r.dokumentBroj}
            </span>
          ) : "";
        },
      },
      {
        accessorKey: "rok",
        header: "Rok",
        defaultVisible: true,
        cell: (c) => {
          const iso = c.getValue<string | null>();
          const istekao = iso && new Date(iso) < new Date() && c.row.original.status === "aktivan";
          return <span style={istekao ? { color: "var(--danger)" } : undefined}>{rokPrikaz(iso)}</span>;
        },
      },
      { accessorKey: "kreiraoIme", header: "Kreirao", defaultVisible: true },
      {
        id: "izvrsioci",
        header: "Izvršioci",
        defaultVisible: true,
        cell: (c) =>
          c.row.original.izvrsioci
            .filter((i) => i.status !== "odbio")
            .map((i) => i.ime + (i.status === "pozvan" ? " (pozvan)" : ""))
            .join(", "),
      },
      {
        id: "akcije",
        header: "",
        defaultVisible: true,
        cell: (c) =>
          c.row.original.mojaPozivnica ? (
            <span style={{ display: "flex", gap: 4 }}>
              <button className="btn primary" onClick={(e) => { e.stopPropagation(); void odgovori(c.row.original.id, "prihvati"); }}>
                Prihvati
              </button>
              <button className="btn" onClick={(e) => { e.stopPropagation(); void odgovori(c.row.original.id, "odbij"); }}>
                Odbij
              </button>
            </span>
          ) : null,
      },
    ],
    [],
  );

  if (view !== "lista") {
    return (
      <ZadatakView
        id={view === "novi" ? null : view}
        onClose={() => { setView("lista"); void query.refetch(); }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Zadaci</h1>
      </div>
      <div className="toolbar" style={{ gap: 4 }}>
        <button className={tab === "aktivni" ? "btn primary" : "btn"} onClick={() => setTab("aktivni")}>
          Aktivni
        </button>
        <button className={tab === "zavrseni" ? "btn primary" : "btn"} onClick={() => setTab("zavrseni")}>
          Završeni
        </button>
      </div>
      {greska && <div className="login-error" style={{ marginBottom: 8 }}>{greska}</div>}
      <DataTable
        data={podaci}
        columns={columns}
        tableId={`zadaci-${tab}`}
        columnPicker
        onRowDoubleClick={(r) => setView(r.id)}
        leftToolbar={<FilterDugme defs={FILTERI} opcije={filterOpcije} vrednosti={filteri} onChange={setFilteri} />}
        toolbar={
          <button className="btn primary" onClick={() => setView("novi")}>
            Nov zadatak
          </button>
        }
      />
    </>
  );
}
