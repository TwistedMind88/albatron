import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { api, ApiError } from "../../api";
import { DataTable } from "../../components/DataTable";
import { FilterDugme, type FilterVrednosti } from "../../components/FilterDugme";
import type { FilterDef } from "../dokumenti/common";
import { MultiPick } from "../../components/MultiPick";
import { sacuvajFajl } from "../../download";
import { statusBadge } from "./PopisiPage";

interface PopisStavka {
  articleId: number;
  warehouseId: number;
  ident: string;
  naziv: string;
  ocekivano: string;
  popisano: string | null;
  datumPopisa: string | null;
  dobavljacId: number | null;
  glavnaKategorijaId: number | null;
  sekundarnaKategorijaId: number | null;
  serijski: boolean;
}

interface PopisData {
  id: number;
  broj: string;
  datum: string;
  status: string;
  napomena: string;
  stavke: PopisStavka[];
  skladista: { id: number; naziv: string }[];
  postojeciPrenosi: { id: number; broj: string; status: string }[];
}

interface Kategorija {
  id: number;
  code: string;
  name: string;
}

interface Subjekt {
  id: number;
  naziv: string;
}

// red pivota: artikal sa stanjem po skladistu
interface Red {
  articleId: number;
  ident: string;
  naziv: string;
  dobavljacId: number | null;
  glavnaKategorijaId: number | null;
  sekundarnaKategorijaId: number | null;
  serijski: boolean;
  poSkladistu: Map<number, { ocekivano: number; popisano: number | null; datumPopisa: string | null }>;
}

type Tab = "lista" | "nepopisano" | "popisano";

// Stranica popisa: pivot tabela artikala po skladistima sa unosom popisanih
// kolicina. Prazna celija = nepopisano (NULL); 0 se upisuje samo eksplicitno.
export function PopisView({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["popis", id], queryFn: () => api<PopisData>(`/api/popisi/${id}`) });
  const kategorije = useQuery({ queryKey: ["kategorije"], queryFn: () => api<Kategorija[]>("/api/kategorije") });
  const subjekti = useQuery({ queryKey: ["subjekti"], queryFn: () => api<Subjekt[]>("/api/subjekti") });

  const [tab, setTab] = useState<Tab>("lista");
  const [filteri, setFilteri] = useState<FilterVrednosti>({});
  // nesnimljene izmene: "articleId:warehouseId" -> popisano
  const [dirty, setDirty] = useState<Map<string, number | null>>(new Map());
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");
  const [serijskiZa, setSerijskiZa] = useState<Red | null>(null);
  const [razlikePopup, setRazlikePopup] = useState(false);
  const [viskoviPopup, setViskoviPopup] = useState(false);
  const [importPopup, setImportPopup] = useState<ImportPregled | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const podaci = q.data;
  const uToku = podaci?.status === "u_toku";

  const redovi = useMemo(() => {
    const mapa = new Map<number, Red>();
    for (const s of podaci?.stavke ?? []) {
      let r = mapa.get(s.articleId);
      if (!r) {
        r = {
          articleId: s.articleId,
          ident: s.ident,
          naziv: s.naziv,
          dobavljacId: s.dobavljacId,
          glavnaKategorijaId: s.glavnaKategorijaId,
          sekundarnaKategorijaId: s.sekundarnaKategorijaId,
          serijski: s.serijski,
          poSkladistu: new Map(),
        };
        mapa.set(s.articleId, r);
      }
      r.poSkladistu.set(s.warehouseId, {
        ocekivano: Number(s.ocekivano),
        popisano: s.popisano === null ? null : Number(s.popisano),
        datumPopisa: s.datumPopisa,
      });
    }
    return [...mapa.values()];
  }, [podaci]);

  if (!podaci) return <div className="placeholder">Učitavanje...</div>;

  const skladista = podaci.skladista;

  const katNaziv = (kid: number | null) => (kategorije.data ?? []).find((k) => k.id === kid)?.name ?? "";
  const dobNaziv = (did: number | null) => (subjekti.data ?? []).find((s) => s.id === did)?.naziv ?? "";

  // filteri na dugme kao u pregledu dokumenata; vrednosti su nazivi (stringovi)
  const fSklad = (filteri["skladiste"] as string[] | undefined) ?? [];
  const fDob = (filteri["dobavljac"] as string[] | undefined) ?? [];
  const fKat = (filteri["kategorija"] as string[] | undefined) ?? [];
  const vidljivaSkladista = fSklad.length ? skladista.filter((s) => fSklad.includes(s.naziv)) : skladista;

  // trenutna vrednost celije: dirty ima prednost nad snimljenim
  function vrednost(r: Red, wid: number): number | null {
    const key = `${r.articleId}:${wid}`;
    if (dirty.has(key)) return dirty.get(key)!;
    return r.poSkladistu.get(wid)?.popisano ?? null;
  }

  const filtrirani = redovi.filter((r) => {
    if (fDob.length && !fDob.includes(dobNaziv(r.dobavljacId))) return false;
    if (fKat.length && !fKat.includes(katNaziv(r.glavnaKategorijaId)) && !fKat.includes(katNaziv(r.sekundarnaKategorijaId)))
      return false;
    if (tab === "nepopisano") return vidljivaSkladista.some((s) => vrednost(r, s.id) === null);
    if (tab === "popisano") return vidljivaSkladista.some((s) => vrednost(r, s.id) !== null);
    return true;
  });

  function upisi(r: Red, wid: number, v: number | null) {
    const key = `${r.articleId}:${wid}`;
    const snimljeno = r.poSkladistu.get(wid)?.popisano ?? null;
    const next = new Map(dirty);
    if (v === snimljeno) next.delete(key);
    else next.set(key, v);
    setDirty(next);
  }

  async function sacuvaj() {
    if (!dirty.size) return;
    setError("");
    try {
      const body = [...dirty.entries()].map(([key, popisano]) => {
        const [articleId, warehouseId] = key.split(":").map(Number);
        return { articleId, warehouseId, popisano };
      });
      await api(`/api/popisi/${id}/stavke`, { method: "PUT", body });
      setDirty(new Map());
      qc.invalidateQueries({ queryKey: ["popis", id] });
      setPoruka("Sačuvano.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri snimanju");
    }
  }

  async function alat(putanja: string, potvrda: string, metod: "POST" | "DELETE" = "POST") {
    if (!confirm(potvrda)) return;
    setError("");
    setPoruka("");
    try {
      await api(putanja, { method: metod });
      if (metod === "DELETE") return onBack();
      qc.invalidateQueries({ queryKey: ["popis", id] });
      qc.invalidateQueries({ queryKey: ["popisi"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  function nazad() {
    if (dirty.size && !confirm("Imate nesnimljene izmene. Napustiti popis?")) return;
    onBack();
  }

  // --- export/import xlsx (klijentski, SheetJS) ---

  function exportXlsx() {
    const rows = redovi.map((r) => {
      const red: Record<string, string | number> = { Ident: r.ident, Naziv: r.naziv };
      for (const s of skladista) {
        const c = r.poSkladistu.get(s.id);
        red[`Ocekivano ${s.naziv}`] = c?.ocekivano ?? 0;
        const v = vrednost(r, s.id);
        red[`Popisano ${s.naziv}`] = v === null ? "" : v;
      }
      return red;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Popis");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    void sacuvajFajl(`popis-${podaci!.broj}.xlsx`, new Blob([buf]));
  }

  interface ImportPregled {
    izmene: { articleId: number; warehouseId: number; popisano: number }[];
    pogodaka: number;
    nepoznati: string[];
    preskoceno: number;
  }

  async function importXlsx(file: File) {
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) return;
    // defval undefined: prazna celija se preskace i NIKAD ne postaje 0
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: undefined });
    const poIdentu = new Map(redovi.map((r) => [r.ident, r]));
    const izmene: ImportPregled["izmene"] = [];
    const nepoznati: string[] = [];
    let preskoceno = 0;
    for (const row of rows) {
      const ident = String(row["Ident"] ?? "").trim();
      if (!ident) continue;
      const r = poIdentu.get(ident);
      if (!r) {
        nepoznati.push(ident);
        continue;
      }
      for (const s of skladista) {
        const v = row[`Popisano ${s.naziv}`];
        if (v === undefined || v === "") {
          preskoceno++;
          continue;
        }
        const n = Number(String(v).replace(",", "."));
        if (isNaN(n)) continue;
        izmene.push({ articleId: r.articleId, warehouseId: s.id, popisano: n });
      }
    }
    setImportPopup({ izmene, pogodaka: new Set(izmene.map((i) => i.articleId)).size, nepoznati, preskoceno });
  }

  async function primeniImport() {
    if (!importPopup?.izmene.length) return setImportPopup(null);
    setError("");
    try {
      await api(`/api/popisi/${id}/stavke`, { method: "PUT", body: importPopup.izmene });
      qc.invalidateQueries({ queryKey: ["popis", id] });
      setImportPopup(null);
      setPoruka("Uvoz primenjen.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri uvozu");
    }
  }

  const TABOVI: { id: Tab; label: string }[] = [
    { id: "lista", label: "Popisna lista" },
    { id: "nepopisano", label: "Nepopisano" },
    { id: "popisano", label: "Popisano" },
  ];

  const filterDefs: FilterDef[] = [
    { key: "skladiste", label: "Skladište", vrsta: "multi" },
    { key: "dobavljac", label: "Dobavljač", vrsta: "multi" },
    { key: "kategorija", label: "Kategorija", vrsta: "multi" },
  ];
  const filterOpcije: Record<string, string[]> = {
    skladiste: skladista.map((s) => s.naziv),
    dobavljac: [...new Set(redovi.map((r) => dobNaziv(r.dobavljacId)))].sort(),
    kategorija: [
      ...new Set(redovi.flatMap((r) => [katNaziv(r.glavnaKategorijaId), katNaziv(r.sekundarnaKategorijaId)])),
    ].sort(),
  };

  // ista tabela kao liste stavki u dokumentima: resize, reorder, izbor kolona,
  // pamcenje po korisniku (tableId); kolone po skladistu su dinamicke
  const editable = uToku && tab !== "lista";
  const kolone: (ColumnDef<Red, any> & { defaultVisible?: boolean })[] = [
    { accessorKey: "ident", header: "Ident", defaultVisible: true },
    { accessorKey: "naziv", header: "Naziv", defaultVisible: true },
    { id: "glavnaKat", header: "Glavna kat.", accessorFn: (r: Red) => katNaziv(r.glavnaKategorijaId), defaultVisible: true },
    { id: "sekundarnaKat", header: "Sekundarna kat.", accessorFn: (r: Red) => katNaziv(r.sekundarnaKategorijaId), defaultVisible: true },
    { id: "dobavljac", header: "Dobavljač", accessorFn: (r: Red) => dobNaziv(r.dobavljacId) },
    {
      id: "serijski",
      header: "Serijski",
      accessorFn: (r: Red) => (r.serijski ? 1 : 0),
      defaultVisible: true,
      cell: ({ row }) =>
        row.original.serijski && (
          <button className="btn" style={{ padding: "0 6px" }} onClick={() => setSerijskiZa(row.original)}>
            Lista
          </button>
        ),
    },
    ...vidljivaSkladista.map<ColumnDef<Red, any> & { defaultVisible?: boolean }>((s) => ({
      id: `o${s.id}`,
      header: `Očekivano ${s.naziv}`,
      accessorFn: (r: Red) => r.poSkladistu.get(s.id)?.ocekivano ?? 0,
      defaultVisible: true,
      cell: ({ row }) => <div style={{ textAlign: "right" }}>{row.original.poSkladistu.get(s.id)?.ocekivano ?? 0}</div>,
    })),
    ...vidljivaSkladista.map<ColumnDef<Red, any> & { defaultVisible?: boolean }>((s, si) => ({
      id: `p${s.id}`,
      header: `Popisano ${s.naziv}`,
      accessorFn: (r: Red) => vrednost(r, s.id),
      defaultVisible: true,
      cell: ({ row }) => (
        <div style={{ textAlign: "right" }}>
          {editable ? (
            <CellPopis
              value={vrednost(row.original, s.id)}
              r={row.index}
              c={si}
              onCommit={(v) => upisi(row.original, s.id, v)}
            />
          ) : (
            (vrednost(row.original, s.id) ?? "")
          )}
        </div>
      ),
    })),
    {
      id: "datumPopisa",
      header: "Datum popisa",
      accessorFn: (r: Red) =>
        [...r.poSkladistu.values()]
          .map((c) => c.datumPopisa)
          .filter((d): d is string => !!d)
          .map((d) => new Date(d).toLocaleDateString("sr-RS"))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", "),
    },
  ];

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={nazad}>
        ← Nazad
      </button>
      <div className="page-head">
        <h1>
          Popis {podaci.broj} <span className="subtle" style={{ fontSize: 14 }}>{new Date(podaci.datum).toLocaleDateString("sr-RS")}</span>{" "}
          {statusBadge(podaci.status)}
        </h1>
        <div className="grow" />
        {error && <span className="login-error">{error}</span>}
        {poruka && !error && <span style={{ fontSize: 12 }}>{poruka}</span>}
        {uToku && (
          <button className="btn" onClick={() => alat(`/api/popisi/${id}/osvezi`, "Ponovo izračunati očekivane količine na datum popisa?")}>
            Osveži očekivano
          </button>
        )}
        <button className="btn" onClick={exportXlsx}>
          Export
        </button>
        {uToku && (
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
        )}
        <button className="btn" onClick={() => setRazlikePopup(true)}>
          Obračun razlika
        </button>
        <button className="btn" onClick={() => setViskoviPopup(true)}>
          Obračun viškova
        </button>
        {uToku && (
          <button className="btn" onClick={() => alat(`/api/popisi/${id}/zakljuci`, "Zaključiti popis? Posle zaključenja izmene nisu moguće.")}>
            Zaključi
          </button>
        )}
        {uToku && (
          <button className="btn" onClick={() => alat(`/api/popisi/${id}`, "Obrisati popis?", "DELETE")}>
            Obriši
          </button>
        )}
        {uToku && (
          <button className="btn primary" disabled={!dirty.size} onClick={sacuvaj}>
            Sačuvaj{dirty.size ? ` (${dirty.size})` : ""}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importXlsx(f);
          e.target.value = "";
        }}
      />
      {podaci.napomena && <p className="subtle" style={{ marginTop: 0 }}>{podaci.napomena}</p>}

      <DataTable
        tableId="popis-stavke"
        data={filtrirani}
        columns={kolone}
        columnPicker
        compact
        leftToolbar={
          <>
            {TABOVI.map((tb) => (
              <button key={tb.id} className={`btn${tab === tb.id ? " primary" : ""}`} onClick={() => setTab(tb.id)}>
                {tb.label}
              </button>
            ))}
          </>
        }
        toolbar={<FilterDugme defs={filterDefs} opcije={filterOpcije} vrednosti={filteri} onChange={setFilteri} />}
      />

      {serijskiZa && (
        <SerijskiInfoPopup red={serijskiZa} skladista={skladista} onClose={() => setSerijskiZa(null)} />
      )}
      {razlikePopup && (
        <RazlikePopup
          popis={podaci}
          redovi={redovi}
          vrednost={vrednost}
          onClose={() => setRazlikePopup(false)}
        />
      )}
      {viskoviPopup && (
        <ViskoviPopup
          popis={podaci}
          redovi={redovi}
          vrednost={vrednost}
          katNaziv={katNaziv}
          dobNaziv={dobNaziv}
          onClose={() => setViskoviPopup(false)}
        />
      )}
      {importPopup && (
        <div className="overlay">
          <div className="popup" style={{ width: 420 }}>
            <h2>Uvoz popisa</h2>
            <p style={{ fontSize: 13 }}>
              Pronađeno {importPopup.izmene.length} vrednosti za {importPopup.pogodaka} artikala.
              <br />
              Preskočeno praznih ćelija: {importPopup.preskoceno} (ostaju nepopisane).
            </p>
            {importPopup.nepoznati.length > 0 && (
              <p className="login-error" style={{ fontSize: 12 }}>
                Nepoznati identi ({importPopup.nepoznati.length}): {importPopup.nepoznati.slice(0, 10).join(", ")}
                {importPopup.nepoznati.length > 10 ? "..." : ""}
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" disabled={!importPopup.izmene.length} onClick={primeniImport}>
                Primeni uvoz
              </button>
              <button className="btn" onClick={() => setImportPopup(null)}>
                Otkaži
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Editabilna celija popisane kolicine. KLJUCNO: prazan draft na commit = NULL
// (Enter preko prazne celije NE upisuje 0); 0 se upisuje samo eksplicitno.
function CellPopis({
  value,
  r,
  c,
  onCommit,
}: {
  value: number | null;
  r: number;
  c: number;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [prosli, setProsli] = useState(value);
  if (value !== prosli) {
    setProsli(value);
    setDraft(value === null ? "" : String(value));
  }

  function commit() {
    const t = draft.trim();
    if (t === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(t.replace(",", "."));
    if (!isNaN(n)) {
      if (n !== value) onCommit(n);
    } else {
      setDraft(value === null ? "" : String(value));
    }
  }

  return (
    <input
      className="input"
      inputMode="decimal"
      style={{ width: 80, textAlign: "right" }}
      value={draft}
      data-r={r}
      data-c={c}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
          commit();
          const nr = e.key === "ArrowUp" ? r - 1 : r + 1;
          const next = document.querySelector<HTMLInputElement>(`input[data-r="${nr}"][data-c="${c}"]`);
          next?.focus();
          next?.select();
          e.preventDefault();
        }
      }}
    />
  );
}

// Info popup: trenutni serijski brojevi artikla po skladistima popisa (read-only)
function SerijskiInfoPopup({
  red,
  skladista,
  onClose,
}: {
  red: Red;
  skladista: { id: number; naziv: string }[];
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["serijski-svi", red.articleId],
    queryFn: () =>
      api<{ id: number; warehouseId: number; skladiste: string; broj: string; izlazId: number | null }[]>(
        `/api/artikli/${red.articleId}/serijski-brojevi`,
      ),
  });
  const ids = new Set(skladista.map((s) => s.id));
  const aktivni = (q.data ?? []).filter((s) => s.izlazId === null && ids.has(s.warehouseId));
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 420 }}>
        <h2>Serijski brojevi - {red.naziv}</h2>
        <div style={{ maxHeight: 300, overflow: "auto", marginBottom: 12, fontSize: 12.5 }}>
          {aktivni.map((s) => (
            <div key={s.id} style={{ padding: "2px 0" }}>
              {s.broj} <span className="subtle">({s.skladiste})</span>
            </div>
          ))}
          {aktivni.length === 0 && <div className="subtle">Nema serijskih brojeva na stanju.</div>}
        </div>
        <button className="btn" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </div>
  );
}

// --- Obracun razlika + wizard generisanja prenosa ---

function RazlikePopup({
  popis,
  redovi,
  vrednost,
  onClose,
}: {
  popis: PopisData;
  redovi: Red[];
  vrednost: (r: Red, wid: number) => number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [wizard, setWizard] = useState(false);
  const [skladistaIds, setSkladistaIds] = useState<number[]>(popis.skladista.map((s) => s.id));
  const [otpis, setOtpis] = useState(false);
  const [otpisnoId, setOtpisnoId] = useState(0);
  const [error, setError] = useState("");
  const [kreirani, setKreirani] = useState<{ id: number; broj: string }[] | null>(null);
  const svaSkladista = useQuery({
    queryKey: ["skladista"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/skladista"),
  });

  const saRazlikom = redovi
    .map((r) => ({
      r,
      razlike: popis.skladista.map((s) => {
        const v = vrednost(r, s.id);
        return v === null ? null : v - (r.poSkladistu.get(s.id)?.ocekivano ?? 0);
      }),
    }))
    .filter((x) => x.razlike.some((d) => d !== null && d !== 0));

  async function generisi() {
    setError("");
    try {
      const r = await api<{ id: number; broj: string }[]>(`/api/popisi/${popis.id}/prenosi`, {
        method: "POST",
        body: { skladistaIds, otpisnoId: otpis && otpisnoId ? otpisnoId : null },
      });
      setKreirani(r);
      qc.invalidateQueries({ queryKey: ["popis", popis.id] });
      qc.invalidateQueries({ queryKey: ["prenosi"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generisanje nije uspelo");
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 760, maxWidth: "95vw" }}>
        <h2>Obračun razlika među skladištima</h2>
        <div style={{ maxHeight: 380, overflow: "auto", marginBottom: 12 }}>
          <table className="data stavke">
            <thead>
              <tr>
                <th>Ident</th>
                <th>Naziv</th>
                {popis.skladista.map((s) => (
                  <th key={s.id} style={{ textAlign: "right" }}>
                    Razlika {s.naziv}
                  </th>
                ))}
                <th style={{ textAlign: "right" }}>Neto</th>
              </tr>
            </thead>
            <tbody>
              {saRazlikom.map(({ r, razlike }) => (
                <tr key={r.articleId}>
                  <td>{r.ident}</td>
                  <td>{r.naziv}</td>
                  {razlike.map((d, i) => (
                    <td key={i} style={{ textAlign: "right", color: d === null ? undefined : d < 0 ? "#dc3545" : d > 0 ? "#28a745" : undefined }}>
                      {d === null ? "-" : d > 0 ? `+${d}` : d}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {razlike.reduce<number>((a, d) => a + (d ?? 0), 0)}
                  </td>
                </tr>
              ))}
              {saRazlikom.length === 0 && (
                <tr>
                  <td colSpan={3 + popis.skladista.length} className="subtle">
                    Nema razlika u popisanim količinama.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {popis.postojeciPrenosi.length > 0 && (
          <p style={{ fontSize: 12, color: "#b8860b" }}>
            Za ovaj popis su već generisani prenosi: {popis.postojeciPrenosi.map((p) => p.broj).join(", ")}
          </p>
        )}
        {!wizard && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={!saRazlikom.length} onClick={() => setWizard(true)}>
              Kreiraj prenose
            </button>
            <button className="btn" onClick={onClose}>
              Zatvori
            </button>
          </div>
        )}
        {wizard && !kreirani && (
          <div style={{ borderTop: "1px solid var(--line-strong)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="field" style={{ maxWidth: 300 }}>
              Skladišta koja učestvuju u prenosima
              <MultiPick
                options={popis.skladista.map((s) => ({ id: s.id, label: s.naziv }))}
                value={skladistaIds}
                onChange={(ids) => setSkladistaIds(ids as number[])}
                placeholder="Nijedno"
              />
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={otpis} onChange={(e) => setOtpis(e.target.checked)} />
              Preostali manjak preneti u otpisno skladište
            </label>
            {otpis && (
              <select className="input" style={{ maxWidth: 300 }} value={otpisnoId} onChange={(e) => setOtpisnoId(Number(e.target.value))}>
                <option value={0}>- izaberite otpisno skladište -</option>
                {(svaSkladista.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.naziv}
                  </option>
                ))}
              </select>
            )}
            {error && <div className="login-error">{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" disabled={!skladistaIds.length || (otpis && !otpisnoId)} onClick={generisi}>
                Generiši nacrte prenosa
              </button>
              <button className="btn" onClick={() => setWizard(false)}>
                Nazad
              </button>
            </div>
          </div>
        )}
        {kreirani && (
          <div style={{ borderTop: "1px solid var(--line-strong)", paddingTop: 10 }}>
            <p style={{ fontSize: 13 }}>
              Kreirani nacrti prenosa: <b>{kreirani.map((k) => k.broj).join(", ")}</b>
              <br />
              Nacrti se pregledaju i primenjuju na stranici Prenosi (artikli sa serijskim brojevima traže izbor brojeva pre primene).
            </p>
            <button className="btn" onClick={onClose}>
              Zatvori
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Obracun viskova: uparivanje viska sa manjkom kroz presifriranje ---

function ViskoviPopup({
  popis,
  redovi,
  vrednost,
  katNaziv,
  dobNaziv,
  onClose,
}: {
  popis: PopisData;
  redovi: Red[];
  vrednost: (r: Red, wid: number) => number | null;
  katNaziv: (id: number | null) => string;
  dobNaziv: (id: number | null) => string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [izabraniVisak, setIzabraniVisak] = useState<number | null>(null); // articleId
  const [fDob, setFDob] = useState<number[]>([]);
  const [fKat, setFKat] = useState<number[]>([]);
  const [otpisnoId, setOtpisnoId] = useState(0);
  const [error, setError] = useState("");
  const [kreiran, setKreiran] = useState<string | null>(null);
  const svaSkladista = useQuery({
    queryKey: ["skladista"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/skladista"),
  });
  // artikli sa stanjem u otpisnom skladistu (ranije otpisani manjkovi)
  const otpisani = useQuery({
    queryKey: ["artikli-pretraga-otpis", otpisnoId],
    queryFn: () => api<{ id: number; ident: string; naziv: string; stanjePrimarno?: number }[]>(`/api/artikli-pretraga?skladisteId=${otpisnoId}`),
    enabled: otpisnoId > 0,
  });

  // neto razlika po artiklu + skladiste sa najvecom pojedinacnom razlikom tog znaka
  function neto(r: Red) {
    let suma = 0;
    let najW = 0;
    let najD = 0;
    for (const s of popis.skladista) {
      const v = vrednost(r, s.id);
      if (v === null) continue;
      const d = v - (r.poSkladistu.get(s.id)?.ocekivano ?? 0);
      suma += d;
      if (Math.abs(d) > Math.abs(najD)) {
        najD = d;
        najW = s.id;
      }
    }
    return { suma, najW };
  }

  const viskovi = redovi.map((r) => ({ r, ...neto(r) })).filter((x) => x.suma > 0);
  const manjkovi = redovi
    .map((r) => ({ r, ...neto(r) }))
    .filter((x) => x.suma < 0)
    .filter((x) => !fDob.length || fDob.includes(x.r.dobavljacId ?? -1))
    .filter(
      (x) =>
        !fKat.length ||
        fKat.includes(x.r.glavnaKategorijaId ?? -1) ||
        fKat.includes(x.r.sekundarnaKategorijaId ?? -1),
    );

  const visak = viskovi.find((v) => v.r.articleId === izabraniVisak) ?? null;

  async function kreiraj(izlaz: { articleId: number; warehouseId: number; max: number }) {
    if (!visak) return;
    setError("");
    const kolicina = Math.min(izlaz.max, visak.suma);
    if (kolicina <= 0) return setError("Nema količine za prešifriranje");
    try {
      const r = await api<{ broj: string }>("/api/presifriranja", {
        method: "POST",
        body: {
          datum: new Date().toISOString().slice(0, 10),
          napomena: `Obracun viskova popisa ${popis.broj}`,
          stavke: [
            { smer: "izlaz", articleId: izlaz.articleId, warehouseId: izlaz.warehouseId, kolicina, serijskiBrojevi: [] },
            { smer: "ulaz", articleId: visak.r.articleId, warehouseId: visak.najW, kolicina, serijskiBrojevi: [] },
          ],
        },
      });
      setKreiran(r.broj);
      qc.invalidateQueries({ queryKey: ["presifriranja"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Kreiranje nije uspelo");
    }
  }

  const wNaziv = (id: number) => popis.skladista.find((s) => s.id === id)?.naziv ?? (svaSkladista.data ?? []).find((s) => s.id === id)?.naziv ?? "?";

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 860, maxWidth: "95vw" }}>
        <h2>Obračun viškova</h2>
        {kreiran ? (
          <>
            <p style={{ fontSize: 13 }}>
              Kreiran nacrt prešifriranja <b>{kreiran}</b>. Serijski brojevi (ako su potrebni) i primena rade se na stranici Prešifriranja.
            </p>
            <button className="btn" onClick={onClose}>
              Zatvori
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 0 }}>Viškovi (fizički više nego očekivano)</h3>
                <div style={{ maxHeight: 300, overflow: "auto" }}>
                  <table className="data stavke">
                    <thead>
                      <tr>
                        <th>Ident</th>
                        <th>Naziv</th>
                        <th style={{ textAlign: "right" }}>Višak</th>
                        <th>Skladište</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viskovi.map((v) => (
                        <tr
                          key={v.r.articleId}
                          onClick={() => setIzabraniVisak(v.r.articleId)}
                          style={{ cursor: "pointer", background: izabraniVisak === v.r.articleId ? "rgba(40,167,69,.12)" : undefined }}
                        >
                          <td>{v.r.ident}</td>
                          <td>{v.r.naziv}</td>
                          <td style={{ textAlign: "right" }}>+{v.suma}</td>
                          <td>{wNaziv(v.najW)}</td>
                        </tr>
                      ))}
                      {viskovi.length === 0 && (
                        <tr>
                          <td colSpan={4} className="subtle">
                            Nema neto viškova.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 0 }}>Kandidati za prešifriranje (manjkovi)</h3>
                {!visak && <p className="subtle" style={{ fontSize: 12 }}>Izaberite višak sa leve strane.</p>}
                {visak && (
                  <>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <MultiPick
                          options={[...new Set(manjkovi.map((m) => m.r.dobavljacId).filter((d): d is number => d !== null))].map((d) => ({
                            id: d,
                            label: dobNaziv(d),
                          }))}
                          value={fDob}
                          onChange={(ids) => setFDob(ids as number[])}
                          placeholder="Svi dobavljači"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <MultiPick
                          options={[
                            ...new Set(
                              manjkovi.flatMap((m) => [m.r.glavnaKategorijaId, m.r.sekundarnaKategorijaId]).filter((k): k is number => k !== null),
                            ),
                          ].map((k) => ({ id: k, label: katNaziv(k) }))}
                          value={fKat}
                          onChange={(ids) => setFKat(ids as number[])}
                          placeholder="Sve kategorije"
                        />
                      </div>
                    </div>
                    <div style={{ maxHeight: 220, overflow: "auto", marginBottom: 8 }}>
                      <table className="data stavke">
                        <thead>
                          <tr>
                            <th>Ident</th>
                            <th>Naziv</th>
                            <th style={{ textAlign: "right" }}>Manjak</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {manjkovi.map((m) => (
                            <tr key={m.r.articleId}>
                              <td>{m.r.ident}</td>
                              <td>{m.r.naziv}</td>
                              <td style={{ textAlign: "right" }}>{m.suma}</td>
                              <td>
                                <button
                                  className="btn"
                                  style={{ padding: "0 6px" }}
                                  onClick={() => kreiraj({ articleId: m.r.articleId, warehouseId: m.najW, max: -m.suma })}
                                >
                                  Prešifriraj
                                </button>
                              </td>
                            </tr>
                          ))}
                          {manjkovi.length === 0 && (
                            <tr>
                              <td colSpan={4} className="subtle">
                                Nema manjkova po filterima.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="field" style={{ maxWidth: 320 }}>
                      Ili iz otpisnog skladišta
                      <select className="input" value={otpisnoId} onChange={(e) => setOtpisnoId(Number(e.target.value))}>
                        <option value={0}>- izaberite skladište -</option>
                        {(svaSkladista.data ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.naziv}
                          </option>
                        ))}
                      </select>
                    </div>
                    {otpisnoId > 0 && (
                      <div style={{ maxHeight: 180, overflow: "auto", marginTop: 6 }}>
                        <table className="data stavke">
                          <tbody>
                            {(otpisani.data ?? [])
                              .filter((a) => (a.stanjePrimarno ?? 0) > 0)
                              .map((a) => (
                                <tr key={a.id}>
                                  <td>{a.ident}</td>
                                  <td>{a.naziv}</td>
                                  <td style={{ textAlign: "right" }}>{a.stanjePrimarno}</td>
                                  <td>
                                    <button
                                      className="btn"
                                      style={{ padding: "0 6px" }}
                                      onClick={() => kreiraj({ articleId: a.id, warehouseId: otpisnoId, max: a.stanjePrimarno ?? 0 })}
                                    >
                                      Prešifriraj
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {error && <div className="login-error" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={onClose}>
                Zatvori
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
