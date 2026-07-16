import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, ApiError } from "../../api";
import { DataTable } from "../../components/DataTable";

interface Stavka {
  id: number;
  sku: string;
  naziv: string;
  cena: string | null;
  opis: string;
  napomena: string;
  custom: Record<string, string> | null;
  discontinued: boolean;
  artikalId: number | null;
}

interface CenovnikDetalj {
  id: number;
  naziv: string;
  dobavljacId: number;
  valuta: string;
  vaziOd: string;
  items: Stavka[];
}

interface IstorijaRed {
  cenovnik: string;
  dobavljac: string;
  valuta: string;
  vaziOd: string;
  sku: string;
  naziv: string;
  cena: string | null;
}

interface DiscRed {
  id: number;
  ident: string;
  naziv: string;
  sku: string;
}

function fmtCena(cena: string | null, valuta: string) {
  return cena === null ? "" : `${Number(cena).toLocaleString("sr-RS")} ${valuta}`;
}

export function CenovnikView({ id, onBack }: { id: number; onBack: () => void }) {
  const [istorijaSku, setIstorijaSku] = useState<string | null>(null);
  const [showDisc, setShowDisc] = useState(false);
  const [showNoviDisc, setShowNoviDisc] = useState(false);
  const [poruka, setPoruka] = useState("");

  const query = useQuery({
    queryKey: ["cenovnik", id],
    queryFn: () => api<CenovnikDetalj>(`/api/cenovnici/${id}`),
  });
  const c = query.data;

  const COLUMNS: ColumnDef<Stavka, any>[] = [
    { accessorKey: "sku", header: "SKU" },
    { accessorKey: "naziv", header: "Naziv" },
    {
      accessorKey: "cena",
      header: "Cena",
      cell: (r) => fmtCena(r.getValue() as string | null, c?.valuta ?? ""),
    },
    { accessorKey: "opis", header: "Opis" },
    { accessorKey: "napomena", header: "Napomena" },
    // Custom kolone (faza 16 RP9): unija kljuceva iz svih stavki
    ...[...new Set((c?.items ?? []).flatMap((i) => Object.keys(i.custom ?? {})))].map(
      (key): ColumnDef<Stavka, any> => ({
        id: `custom_${key}`,
        header: key,
        accessorFn: (s) => s.custom?.[key] ?? "",
      }),
    ),
    {
      accessorKey: "discontinued",
      header: "Disc.",
      cell: (r) => (r.getValue() ? "Da" : ""),
    },
    {
      accessorKey: "artikalId",
      header: "U programu",
      cell: (r) => (r.getValue() ? "Da" : ""),
    },
  ];

  async function azurirajCene() {
    setPoruka("");
    try {
      const res = await api<{ updated: number }>(`/api/cenovnici/${id}/azuriraj-cene`, { method: "POST" });
      setPoruka(`Ažurirano cena artikala: ${res.updated}`);
      query.refetch();
    } catch (e) {
      setPoruka(e instanceof ApiError ? e.message : "Greška pri ažuriranju");
    }
  }

  if (!c) return <div className="placeholder">Učitavanje...</div>;

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
        &larr; Nazad
      </button>
      <div className="page-head">
        <h1>{c.naziv}</h1>
      </div>
      <p style={{ fontSize: 12, marginBottom: 8 }}>
        Valuta: {c.valuta} | Važi od: {new Date(c.vaziOd).toLocaleDateString("sr-RS")} | Stavki:{" "}
        {c.items.length}. Dupli klik na red prikazuje istoriju cene za taj SKU.
      </p>
      {poruka && <p style={{ fontSize: 12, marginBottom: 8, color: "var(--danger)" }}>{poruka}</p>}
      <DataTable
        data={c.items}
        columns={COLUMNS}
        onRowDoubleClick={(s) => setIstorijaSku(s.sku)}
        toolbar={
          <>
            <button className="btn" onClick={azurirajCene}>
              Ažuriraj cene artikala
            </button>
            <button className="btn" onClick={() => setShowDisc(true)}>
              Provera discontinued
            </button>
            <button className="btn" onClick={() => setShowNoviDisc(true)}>
              Novi discontinued
            </button>
          </>
        }
      />
      {istorijaSku && <IstorijaPopup sku={istorijaSku} onClose={() => setIstorijaSku(null)} />}
      {showDisc && (
        <DiscontinuedPopup
          cenovnikId={id}
          onClose={() => {
            setShowDisc(false);
            query.refetch();
          }}
        />
      )}
      {showNoviDisc && (
        <DiscontinuedPopup
          cenovnikId={id}
          endpoint="novi-discontinued"
          naslov="Novi discontinued"
          opis="Aktivni artikli koji su u ovom cenovniku označeni kao discontinued - označite one koje treba obeležiti kao discontinued:"
          prazno="Nijedan aktivan artikal nije u ovom cenovniku označen kao discontinued."
          defaultSve
          onClose={() => {
            setShowNoviDisc(false);
            query.refetch();
          }}
        />
      )}
    </>
  );
}

// Istorija cene jednog SKU kroz sve verzije cenovnika (brief 6)
function IstorijaPopup({ sku, onClose }: { sku: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["cenovnik-sku", sku],
    queryFn: () => api<IstorijaRed[]>(`/api/cenovnici-sku/${encodeURIComponent(sku)}`),
  });

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 560 }}>
        <h2>Istorija cene: {sku}</h2>
        <table className="table" style={{ width: "100%", fontSize: 12, marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Cenovnik</th>
              <th>Važi od</th>
              <th>Cena</th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((r, i) => (
              <tr key={i}>
                <td>{r.cenovnik}</td>
                <td>{new Date(r.vaziOd).toLocaleDateString("sr-RS")}</td>
                <td>{fmtCena(r.cena, r.valuta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn primary" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </div>
  );
}

// Kandidati za discontinued (brief 6, 14.5): kojih nema u cenovniku ili su u njemu oznaceni
function DiscontinuedPopup({
  cenovnikId,
  onClose,
  endpoint = "discontinued",
  naslov = "Provera discontinued",
  opis = "Artikli dobavljača kojih nema u ovom cenovniku - označite one koje treba obeležiti kao discontinued:",
  prazno = "Svi aktivni artikli ovog dobavljača postoje u cenovniku.",
  defaultSve = false,
}: {
  cenovnikId: number;
  onClose: () => void;
  endpoint?: string;
  naslov?: string;
  opis?: string;
  prazno?: string;
  defaultSve?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: ["cenovnik-disc", cenovnikId, endpoint],
    queryFn: () => api<DiscRed[]>(`/api/cenovnici/${cenovnikId}/${endpoint}`),
  });
  const rows = query.data ?? [];

  useEffect(() => {
    if (defaultSve && query.data) setSelected(new Set(query.data.map((r) => r.id)));
  }, [defaultSve, query.data]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function oznaci() {
    setError("");
    try {
      await api("/api/artikli-discontinued", { method: "POST", body: { ids: [...selected] } });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 560 }}>
        <h2>{naslov}</h2>
        {rows.length === 0 ? (
          <p style={{ fontSize: 12, marginBottom: 12 }}>{prazno}</p>
        ) : (
          <>
            <p style={{ fontSize: 12 }}>{opis}</p>
            <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
              {rows.map((r) => (
                <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "2px 0" }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  {r.ident} - {r.naziv} (SKU: {r.sku})
                </label>
              ))}
            </div>
          </>
        )}
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={selected.size === 0} onClick={oznaci}>
            Označi discontinued ({selected.size})
          </button>
          <button className="btn" onClick={onClose}>
            Zatvori
          </button>
        </div>
      </div>
    </div>
  );
}
