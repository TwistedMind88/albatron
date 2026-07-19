import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, ApiError } from "../../api";
import { DataTable } from "../../components/DataTable";
import { ArtikalAutocomplete, type ArtikalOpcija } from "../../components/ArtikalAutocomplete";
import type { Skladiste } from "../podesavanja/Moduli";
import { statusBadge } from "./PopisiPage";

interface PsfRed {
  id: number;
  broj: string;
  datum: string;
  status: string;
  napomena: string;
  referent: string | null;
}

interface Stavka {
  smer: "izlaz" | "ulaz";
  articleId: number;
  warehouseId: number;
  ident: string;
  naziv: string;
  kolicina: string;
  serijskiBrojevi: string[];
}

// Presifriranje (koncept popis.md): interni dokument koji pretvara jedan artikal
// u drugi - izlazne i ulazne stavke, knjizi se tek primenom nacrta
export function PresifriranjaPage() {
  const [view, setView] = useState<"lista" | "novi" | number>("lista");
  const lista = useQuery({ queryKey: ["presifriranja"], queryFn: () => api<PsfRed[]>("/api/presifriranja") });
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<{ zalihe: boolean }>("/api/moduli") });

  if (moduli.data && !moduli.data.zalihe) {
    return <div className="placeholder">Modul zaliha nije uključen (Podešavanja → Moduli).</div>;
  }
  if (view === "novi") return <PsfForma id={null} onBack={() => setView("lista")} />;
  if (typeof view === "number") return <PsfDetalj id={view} onBack={() => setView("lista")} />;

  const kolone: ColumnDef<PsfRed, any>[] = [
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
        <h1>Prešifriranja</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setView("novi")}>
          + Novo prešifriranje
        </button>
      </div>
      <DataTable data={lista.data ?? []} columns={kolone} tableId="presifriranja" onRowDoubleClick={(p) => setView(p.id)} />
    </>
  );
}

interface PsfData {
  id: number;
  broj: string;
  datum: string;
  status: string;
  napomena: string;
  stavke: (Stavka & { id: number; kolicina: string })[];
}

function PsfDetalj({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useQuery({ queryKey: ["presifriranje", id], queryFn: () => api<PsfData>(`/api/presifriranja/${id}`) });
  if (!q.data) return <div className="placeholder">Učitavanje...</div>;
  return <PsfForma id={id} initial={q.data} onBack={onBack} />;
}

function PsfForma({ id, initial, onBack }: { id: number | null; initial?: PsfData; onBack: () => void }) {
  const qc = useQueryClient();
  const skladista = useQuery({ queryKey: ["skladista"], queryFn: () => api<Skladiste[]>("/api/skladista") });
  const artikli = useQuery({
    queryKey: ["artikli-pretraga-psf"],
    queryFn: () => api<ArtikalOpcija[]>("/api/artikli-pretraga"),
  });

  const [tab, setTab] = useState<"izlaz" | "ulaz">("izlaz");
  const [datum, setDatum] = useState(initial?.datum.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [napomena, setNapomena] = useState(initial?.napomena ?? "");
  const [stavke, setStavke] = useState<Stavka[]>(
    (initial?.stavke ?? []).map((s) => ({
      smer: s.smer,
      articleId: s.articleId,
      warehouseId: s.warehouseId,
      ident: s.ident,
      naziv: s.naziv,
      kolicina: String(Number(s.kolicina)),
      serijskiBrojevi: (s.serijskiBrojevi ?? []) as string[],
    })),
  );
  const [serijskiIdx, setSerijskiIdx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");
  const [savedId, setSavedId] = useState(id);

  const nacrt = (initial?.status ?? "nacrt") === "nacrt";
  const tabStavke = stavke.map((s, i) => ({ s, i })).filter((x) => x.s.smer === tab);
  const sumaIzlaz = stavke.filter((s) => s.smer === "izlaz").reduce((a, s) => a + Number(s.kolicina || 0), 0);
  const sumaUlaz = stavke.filter((s) => s.smer === "ulaz").reduce((a, s) => a + Number(s.kolicina || 0), 0);

  function vodiSerijske(articleId: number) {
    return (artikli.data ?? []).find((a) => a.id === articleId)?.serijskiBrojevi ?? false;
  }

  function setStavka(idx: number, delta: Partial<Stavka>) {
    setStavke(stavke.map((s, i) => (i === idx ? { ...s, ...delta } : s)));
  }

  function dodajArtikal(aid: number) {
    const a = (artikli.data ?? []).find((x) => x.id === aid);
    const prim = (skladista.data ?? []).find((s) => s.isPrimary);
    if (a) {
      setStavke([
        ...stavke,
        {
          smer: tab,
          articleId: a.id,
          warehouseId: prim?.id ?? (skladista.data ?? [])[0]?.id ?? 0,
          ident: a.ident,
          naziv: a.naziv,
          kolicina: "1",
          serijskiBrojevi: [],
        },
      ]);
    }
  }

  function telo() {
    return {
      datum,
      napomena,
      stavke: stavke.map((s) => ({
        smer: s.smer,
        articleId: s.articleId,
        warehouseId: s.warehouseId,
        kolicina: Number(s.kolicina),
        serijskiBrojevi: s.serijskiBrojevi,
      })),
    };
  }

  async function snimi() {
    setError("");
    setPoruka("");
    try {
      if (savedId === null) {
        const r = await api<{ id: number }>("/api/presifriranja", { method: "POST", body: telo() });
        setSavedId(r.id);
      } else {
        await api(`/api/presifriranja/${savedId}`, { method: "PUT", body: telo() });
      }
      qc.invalidateQueries({ queryKey: ["presifriranja"] });
      if (savedId !== null) qc.invalidateQueries({ queryKey: ["presifriranje", savedId] });
      setPoruka("Sačuvano.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri snimanju");
    }
  }

  async function primeni() {
    if (savedId === null) return;
    if (!confirm("Primeniti prešifriranje? Knjiži se izlaz i ulaz robe.")) return;
    setError("");
    try {
      await api(`/api/presifriranja/${savedId}/primeni`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["presifriranja"] });
      qc.invalidateQueries({ queryKey: ["presifriranje", savedId] });
      onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Primena nije uspela");
    }
  }

  async function obrisi() {
    if (savedId === null) return;
    if (!confirm("Obrisati nacrt prešifriranja?")) return;
    try {
      await api(`/api/presifriranja/${savedId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["presifriranja"] });
      onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Brisanje nije uspelo");
    }
  }

  const spremno = stavke.some((s) => s.smer === "izlaz") && stavke.some((s) => s.smer === "ulaz") && stavke.every((s) => Number(s.kolicina) > 0);

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
        ← Nazad
      </button>
      <div className="page-head">
        <h1>
          {initial ? `Prešifriranje ${initial.broj}` : "Novo prešifriranje"} {initial && statusBadge(initial.status)}
        </h1>
        <div className="grow" />
        {error && <span className="login-error">{error}</span>}
        {poruka && !error && <span style={{ fontSize: 12 }}>{poruka}</span>}
        {nacrt && savedId !== null && (
          <button className="btn" onClick={obrisi}>
            Obriši
          </button>
        )}
        {nacrt && savedId !== null && (
          <button className="btn" onClick={primeni}>
            Primeni
          </button>
        )}
        {nacrt && (
          <button className="btn primary" disabled={!spremno} onClick={snimi}>
            Sačuvaj
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12, border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
        <label className="field">
          Datum
          <input className="input" type="date" value={datum} disabled={!nacrt} onChange={(e) => setDatum(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Napomena
          <input className="input" value={napomena} disabled={!nacrt} onChange={(e) => setNapomena(e.target.value)} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button className={`btn${tab === "izlaz" ? " primary" : ""}`} onClick={() => setTab("izlaz")}>
          Izlazni artikli ({sumaIzlaz})
        </button>
        <button className={`btn${tab === "ulaz" ? " primary" : ""}`} onClick={() => setTab("ulaz")}>
          Ulazni artikli ({sumaUlaz})
        </button>
        {sumaIzlaz !== sumaUlaz && stavke.length > 0 && (
          <span style={{ fontSize: 12, color: "#b8860b" }}>Suma izlaza ({sumaIzlaz}) i ulaza ({sumaUlaz}) se razlikuju.</span>
        )}
      </div>

      <div className="tablewrap" style={{ marginBottom: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ minWidth: 110 }}>Ident</th>
              <th style={{ minWidth: 240 }}>Naziv</th>
              <th>Skladište</th>
              <th>Količina</th>
              <th>Serijski brojevi</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tabStavke.map(({ s, i }) => (
              <tr key={i}>
                <td>{s.ident}</td>
                <td>{s.naziv}</td>
                <td>
                  <select
                    className="input"
                    value={s.warehouseId}
                    disabled={!nacrt}
                    onChange={(e) => setStavka(i, { warehouseId: Number(e.target.value), serijskiBrojevi: [] })}
                  >
                    {(skladista.data ?? []).map((sk) => (
                      <option key={sk.id} value={sk.id}>
                        {sk.naziv}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    inputMode="decimal"
                    style={{ width: 80 }}
                    value={s.kolicina}
                    disabled={!nacrt}
                    onChange={(e) => setStavka(i, { kolicina: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="btn"
                    disabled={!vodiSerijske(s.articleId)}
                    style={!vodiSerijske(s.articleId) ? { opacity: 0.5 } : undefined}
                    onClick={() => setSerijskiIdx(i)}
                  >
                    {s.serijskiBrojevi.length ? `${s.serijskiBrojevi.length} uneto` : s.smer === "izlaz" ? "Izaberi" : "Unesi"}
                  </button>
                </td>
                <td>
                  {nacrt && (
                    <button className="btn" style={{ padding: "0 6px" }} onClick={() => setStavke(stavke.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {nacrt && (
              <tr>
                <td>
                  <ArtikalAutocomplete artikli={artikli.data ?? []} polje="ident" placeholder="ident..." onIzbor={dodajArtikal} />
                </td>
                <td>
                  <ArtikalAutocomplete artikli={artikli.data ?? []} polje="naziv" placeholder="+ dodaj artikal..." onIzbor={dodajArtikal} />
                </td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {serijskiIdx !== null && stavke[serijskiIdx] && stavke[serijskiIdx]!.smer === "izlaz" && (
        <IzborSerijskihIzlaz
          stavka={stavke[serijskiIdx]!}
          onDone={(brojevi) => {
            setStavka(serijskiIdx, { serijskiBrojevi: brojevi });
            setSerijskiIdx(null);
          }}
          onCancel={() => setSerijskiIdx(null)}
        />
      )}
      {serijskiIdx !== null && stavke[serijskiIdx] && stavke[serijskiIdx]!.smer === "ulaz" && (
        <UnosSerijskihUlaz
          stavka={stavke[serijskiIdx]!}
          onDone={(brojevi) => {
            setStavka(serijskiIdx, { serijskiBrojevi: brojevi });
            setSerijskiIdx(null);
          }}
          onCancel={() => setSerijskiIdx(null)}
        />
      )}
    </>
  );
}

// Izbor postojecih serijskih brojeva iz skladista izlazne stavke
function IzborSerijskihIzlaz({
  stavka,
  onDone,
  onCancel,
}: {
  stavka: Stavka;
  onDone: (brojevi: string[]) => void;
  onCancel: () => void;
}) {
  const q = useQuery({
    queryKey: ["serijski", stavka.articleId, stavka.warehouseId],
    queryFn: () =>
      api<{ id: number; broj: string }[]>(`/api/artikli/${stavka.articleId}/serijski-brojevi?skladisteId=${stavka.warehouseId}`),
  });
  const [izabrani, setIzabrani] = useState<Set<string>>(new Set(stavka.serijskiBrojevi));
  const max = Number(stavka.kolicina) || 0;

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 420 }}>
        <h2>Serijski brojevi - {stavka.naziv}</h2>
        <p className="subtle" style={{ fontSize: 12 }}>
          Izabrano {izabrani.size} / max {max}
        </p>
        <div style={{ maxHeight: 300, overflow: "auto", marginBottom: 12 }}>
          {(q.data ?? []).map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={izabrani.has(s.broj)}
                disabled={!izabrani.has(s.broj) && izabrani.size >= max}
                onChange={(e) => {
                  const next = new Set(izabrani);
                  if (e.target.checked) next.add(s.broj);
                  else next.delete(s.broj);
                  setIzabrani(next);
                }}
              />
              {s.broj}
            </label>
          ))}
          {(q.data ?? []).length === 0 && <div className="subtle">Nema serijskih brojeva u izabranom skladištu.</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={() => onDone([...izabrani])}>
            Potvrdi
          </button>
          <button className="btn" onClick={onCancel}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Slobodan unos NOVIH serijskih brojeva za ulazni artikal (jedan po redu)
function UnosSerijskihUlaz({
  stavka,
  onDone,
  onCancel,
}: {
  stavka: Stavka;
  onDone: (brojevi: string[]) => void;
  onCancel: () => void;
}) {
  const [tekst, setTekst] = useState(stavka.serijskiBrojevi.join("\n"));
  const brojevi = tekst
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  const max = Number(stavka.kolicina) || 0;

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 420 }}>
        <h2>Novi serijski brojevi - {stavka.naziv}</h2>
        <p className="subtle" style={{ fontSize: 12 }}>
          Jedan broj po redu. Uneto {brojevi.length} / potrebno {max}.
        </p>
        <textarea className="input" rows={8} style={{ width: "100%", boxSizing: "border-box" }} value={tekst} onChange={(e) => setTekst(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn primary" onClick={() => onDone(brojevi)}>
            Potvrdi
          </button>
          <button className="btn" onClick={onCancel}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
