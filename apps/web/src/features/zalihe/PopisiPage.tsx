import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, ApiError } from "../../api";
import { DataTable } from "../../components/DataTable";
import { MultiPick } from "../../components/MultiPick";
import type { Skladiste } from "../podesavanja/Moduli";
import { PopisView } from "./PopisView";

interface PopisRed {
  id: number;
  broj: string;
  datum: string;
  status: string;
  napomena: string;
  referent: string | null;
}

export function statusBadge(status: string) {
  const map: Record<string, { label: string; bg: string }> = {
    u_toku: { label: "U toku", bg: "rgba(255,193,7,.25)" },
    zakljucen: { label: "Zaključen", bg: "rgba(40,167,69,.2)" },
    nacrt: { label: "Nacrt", bg: "rgba(255,193,7,.25)" },
    knjizen: { label: "Knjižen", bg: "rgba(40,167,69,.2)" },
  };
  const s = map[status] ?? { label: status, bg: "transparent" };
  return <span style={{ background: s.bg, borderRadius: 8, padding: "1px 8px", fontSize: 12 }}>{s.label}</span>;
}

// Popis zaliha (koncept popis.md): lista popisa + kreiranje po kriterijumima
export function PopisiPage() {
  const [view, setView] = useState<"lista" | number>("lista");
  const [noviPopup, setNoviPopup] = useState(false);
  const popisi = useQuery({ queryKey: ["popisi"], queryFn: () => api<PopisRed[]>("/api/popisi") });
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<{ zalihe: boolean }>("/api/moduli") });

  if (moduli.data && !moduli.data.zalihe) {
    return <div className="placeholder">Modul zaliha nije uključen (Podešavanja → Moduli).</div>;
  }
  if (typeof view === "number") return <PopisView id={view} onBack={() => setView("lista")} />;

  const kolone: ColumnDef<PopisRed, any>[] = [
    {
      accessorKey: "broj",
      header: "Broj",
      cell: ({ row }) => (
        <a className="link" onClick={() => setView(row.original.id)}>
          {row.original.broj}
        </a>
      ),
    },
    {
      accessorKey: "datum",
      header: "Datum",
      cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString("sr-RS"),
    },
    { accessorKey: "status", header: "Status", cell: ({ getValue }) => statusBadge(getValue<string>()) },
    { accessorKey: "referent", header: "Referent", cell: ({ getValue }) => getValue<string | null>() ?? "" },
    { accessorKey: "napomena", header: "Napomena" },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Popisi</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setNoviPopup(true)}>
          + Novi popis
        </button>
      </div>
      <DataTable data={popisi.data ?? []} columns={kolone} tableId="popisi" onRowDoubleClick={(p) => setView(p.id)} />
      {noviPopup && <NoviPopisPopup onDone={(id) => { setNoviPopup(false); if (id) setView(id); }} />}
    </>
  );
}

interface Subjekt {
  id: number;
  naziv: string;
}

interface Kategorija {
  id: number;
  code: string;
  name: string;
}

// Kreiranje popisa: kriterijumi odredjuju listu artikala (skladista obavezna,
// dobavljaci/kategorije opciono suzavaju; izbor kategorije = celo podstablo)
function NoviPopisPopup({ onDone }: { onDone: (id: number | null) => void }) {
  const qc = useQueryClient();
  const skladista = useQuery({ queryKey: ["skladista"], queryFn: () => api<Skladiste[]>("/api/skladista") });
  const dobavljaci = useQuery({
    queryKey: ["subjekti-dobavljaci"],
    queryFn: () => api<Subjekt[]>("/api/subjekti?uloga=dobavljac"),
  });
  const kategorije = useQuery({ queryKey: ["kategorije"], queryFn: () => api<Kategorija[]>("/api/kategorije") });

  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [napomena, setNapomena] = useState("");
  const [skladistaIds, setSkladistaIds] = useState<number[] | null>(null); // null = jos nije inicijalizovano
  const [dobavljacIds, setDobavljacIds] = useState<number[]>([]);
  const [kategorijaIds, setKategorijaIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [radi, setRadi] = useState(false);

  // podrazumevano sva skladista cekirana
  const sviIds = (skladista.data ?? []).map((s) => s.id);
  const izabrana = skladistaIds ?? sviIds;

  async function kreiraj() {
    setError("");
    setRadi(true);
    try {
      const r = await api<{ id: number }>("/api/popisi", {
        method: "POST",
        body: { datum, napomena, skladistaIds: izabrana, dobavljacIds, kategorijaIds },
      });
      qc.invalidateQueries({ queryKey: ["popisi"] });
      onDone(r.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Kreiranje nije uspelo");
      setRadi(false);
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 440 }}>
        <h2>Novi popis</h2>
        <label className="field">
          Datum popisa
          <input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>
        <label className="field">
          Napomena
          <input className="input" value={napomena} onChange={(e) => setNapomena(e.target.value)} />
        </label>
        <div className="field">
          Skladišta
          <MultiPick
            options={(skladista.data ?? []).map((s) => ({ id: s.id, label: s.naziv }))}
            value={izabrana}
            onChange={(ids) => setSkladistaIds(ids as number[])}
            placeholder="Nijedno"
          />
        </div>
        <div className="field">
          Dobavljači (opciono)
          <MultiPick
            options={(dobavljaci.data ?? []).map((s) => ({ id: s.id, label: s.naziv }))}
            value={dobavljacIds}
            onChange={(ids) => setDobavljacIds(ids as number[])}
            placeholder="Svi"
          />
        </div>
        <div className="field">
          Kategorije (opciono, sa podstablom)
          <MultiPick
            options={(kategorije.data ?? []).map((k) => ({ id: k.id, label: `${k.code} ${k.name}` }))}
            value={kategorijaIds}
            onChange={(ids) => setKategorijaIds(ids as number[])}
            placeholder="Sve"
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn primary" disabled={izabrana.length === 0 || radi} onClick={kreiraj}>
            Kreiraj popis
          </button>
          <button className="btn" onClick={() => onDone(null)}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
