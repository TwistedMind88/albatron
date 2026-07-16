import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { DOC_TYPES, LOOKUP_KINDS } from "@albatron/shared";
import { api, ApiError } from "../../api";
import { sacuvajFajl } from "../../download";

export interface Lookup {
  id: number;
  kind: string;
  docType: string | null;
  internalValue: string;
  externalValue: string;
  rate: string | null;
  isDefault: boolean;
  sortOrder: number;
  active: boolean;
}

export function Liste() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>(LOOKUP_KINDS[0]!.id);
  const [docType, setDocType] = useState<string>(DOC_TYPES[0].id);
  const kindDef = LOOKUP_KINDS.find((k) => k.id === kind)!;
  const isStatus = kind === "status_dokumenta";
  // per-kind kolone (faza 16, RP4): tarife imaju Sifra/Naziv i nemaju podrazumevani izbor
  const labels = kindDef.labels ?? { internal: "Interna (kratka)", external: "Eksterna (puna)" };
  const hasDefault = kindDef.hasDefault !== false;
  // RP6: tarife bez rucnog redosleda; klik na zaglavlje sortira lokalno (samo prikaz)
  const noReorder = kindDef.noReorder === true;
  const [sort, setSort] = useState<{ col: "internal" | "external" | "rate"; dir: 1 | -1 } | null>(null);

  const all = useQuery({ queryKey: ["liste"], queryFn: () => api<Lookup[]>("/api/liste") });
  const filtrirani = (all.data ?? []).filter(
    (l) => l.kind === kind && (!isStatus || l.docType === docType),
  );
  const items =
    noReorder && sort
      ? [...filtrirani].sort((a, b) => {
          const val = (l: Lookup) =>
            sort.col === "rate" ? Number(l.rate ?? 0) : (sort.col === "internal" ? l.internalValue : l.externalValue);
          const av = val(a);
          const bv = val(b);
          const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv), "sr");
          return cmp * sort.dir;
        })
      : filtrirani;

  function sortiraj(col: "internal" | "external" | "rate") {
    setSort((s) => (s?.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  }
  const sortZnak = (col: string) => (sort?.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["liste"] });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api("/api/liste-redosled", { method: "PUT", body: { ids } }),
    onSuccess: invalidate,
  });

  function move(index: number, dir: -1 | 1) {
    const ids = items.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids);
  }

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Lookup> & { rate?: number | null } }) =>
      api(`/api/liste/${id}`, { method: "PUT", body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/liste/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 17, margin: "0 0 12px" }}>Liste predefinisanih izbora</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {LOOKUP_KINDS.map((k) => (
          <button
            key={k.id}
            className={`btn${k.id === kind ? " primary" : ""}`}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      {isStatus && (
        <label className="field" style={{ maxWidth: 240, marginBottom: 12 }}>
          Tip dokumenta
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              {!noReorder && <th style={{ width: 70 }}>Redosled</th>}
              {noReorder ? (
                <>
                  <th style={{ cursor: "pointer" }} onClick={() => sortiraj("internal")}>
                    {labels.internal}{sortZnak("internal")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => sortiraj("external")}>
                    {labels.external}{sortZnak("external")}
                  </th>
                  {kindDef.hasRate && (
                    <th style={{ width: 80, cursor: "pointer" }} onClick={() => sortiraj("rate")}>
                      Stopa %{sortZnak("rate")}
                    </th>
                  )}
                </>
              ) : (
                <>
                  <th>{labels.internal}</th>
                  <th>{labels.external}</th>
                  {kindDef.hasRate && <th style={{ width: 80 }}>Stopa %</th>}
                </>
              )}
              {hasDefault && <th style={{ width: 100 }}>Podrazumevani</th>}
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id}>
                {!noReorder && (
                  <td>
                    <button className="btn" style={{ padding: "0 6px" }} onClick={() => move(i, -1)}>
                      ▲
                    </button>{" "}
                    <button className="btn" style={{ padding: "0 6px" }} onClick={() => move(i, 1)}>
                      ▼
                    </button>
                  </td>
                )}
                <td>{item.internalValue}</td>
                <td>{item.externalValue}</td>
                {kindDef.hasRate && <td>{item.rate}</td>}
                {hasDefault && (
                  <td>
                    <input
                      type="checkbox"
                      checked={item.isDefault}
                      onChange={(e) => update.mutate({ id: item.id, body: { isDefault: e.target.checked } })}
                    />
                  </td>
                )}
                <td>
                  <button className="btn" style={{ padding: "0 6px" }} onClick={() => remove.mutate(item.id)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NovaStavka
        kind={kind}
        docType={isStatus ? docType : null}
        hasRate={kindDef.hasRate}
        labels={labels}
        onCreated={invalidate}
      />
      {kind === "carinska_tarifa" && <TarifeImportExport items={items} onImported={invalidate} />}
    </div>
  );
}

// Import/export carinskih tarifa (faza 16, RP4): xlsx Sifra/Naziv/Stopa,
// upsert po sifri sa dry-run pregledom pre potvrde.
function TarifeImportExport({ items, onImported }: { items: Lookup[]; onImported: () => void }) {
  const [rows, setRows] = useState<{ sifra: string; naziv: string; stopa: number | null }[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [pregled, setPregled] = useState<{ novi: number; azurirani: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function exportuj() {
    const ws = XLSX.utils.json_to_sheet(
      items.map((i) => ({ Sifra: i.internalValue, Naziv: i.externalValue, Stopa: i.rate !== null ? Number(i.rate) : "" })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tarife");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl("carinske-tarife.xlsx", new Blob([buf]));
  }

  async function onFile(file: File) {
    setError("");
    setPregled(null);
    setRows(null);
    const wb = XLSX.read(await file.arrayBuffer());
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (data.length === 0) return setError("Fajl je prazan ili sadrži samo header");
    // kolone po nazivu, tolerantno na dijakritike (Sifra/Šifra)
    const hdrs = Object.keys(data[0]!);
    const nadji = (prefiksi: string[]) =>
      hdrs.find((h) => prefiksi.some((p) => h.toLowerCase().replace(/š/g, "s").startsWith(p)));
    const kSifra = nadji(["sifra"]);
    const kNaziv = nadji(["naziv"]);
    const kStopa = nadji(["stopa"]);
    if (!kSifra) return setError('Fajl mora imati kolonu "Sifra"');
    const parsed = data
      .map((r) => ({
        sifra: String(r[kSifra] ?? "").trim(),
        naziv: kNaziv ? String(r[kNaziv] ?? "").trim() : "",
        stopa: (() => {
          const v = kStopa ? String(r[kStopa] ?? "").trim().replace(",", ".") : "";
          return v === "" || Number.isNaN(Number(v)) ? null : Number(v);
        })(),
      }))
      .filter((r) => r.sifra !== "");
    if (parsed.length === 0) return setError("Nema redova sa šifrom");
    setFileName(file.name);
    setRows(parsed);
    await posalji(parsed, true);
  }

  async function posalji(r: { sifra: string; naziv: string; stopa: number | null }[], dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ novi: number; azurirani: number }>("/api/liste-import?kind=carinska_tarifa", {
        method: "POST",
        body: { dryRun, rows: r },
      });
      if (dryRun) {
        setPregled(res);
      } else {
        setRows(null);
        setPregled(null);
        setFileName("");
        onImported();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri importu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={exportuj} disabled={items.length === 0}>
        Export
      </button>
      <label className="btn" style={{ cursor: "pointer" }}>
        Import
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.[0]) void onFile(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </label>
      {pregled && rows && (
        <>
          <span style={{ fontSize: 12 }}>
            {fileName}: novih <b>{pregled.novi}</b>, ažuriranih <b>{pregled.azurirani}</b>
          </span>
          <button className="btn primary" disabled={busy} onClick={() => void posalji(rows, false)}>
            Uvezi
          </button>
          <button className="btn" disabled={busy} onClick={() => { setRows(null); setPregled(null); setFileName(""); }}>
            Otkaži
          </button>
        </>
      )}
      {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

function NovaStavka({
  kind,
  docType,
  hasRate,
  labels,
  onCreated,
}: {
  kind: string;
  docType: string | null;
  hasRate: boolean;
  labels: { internal: string; external: string };
  onCreated: () => void;
}) {
  const [internalValue, setInternal] = useState("");
  const [externalValue, setExternal] = useState("");
  const [rate, setRate] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/api/liste", {
        method: "POST",
        body: {
          kind,
          docType,
          internalValue,
          externalValue,
          rate: hasRate && rate !== "" ? Number(rate) : null,
        },
      }),
    onSuccess: () => {
      setInternal("");
      setExternal("");
      setRate("");
      onCreated();
    },
  });

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
      <label className="field" style={{ flex: 1 }}>
        {labels.internal}
        <input className="input" value={internalValue} onChange={(e) => setInternal(e.target.value)} />
      </label>
      <label className="field" style={{ flex: 1 }}>
        {labels.external}
        <input className="input" value={externalValue} onChange={(e) => setExternal(e.target.value)} />
      </label>
      {hasRate && (
        <label className="field" style={{ width: 90 }}>
          Stopa %
          <input
            className="input"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(",", "."))}
          />
        </label>
      )}
      <button className="btn primary" disabled={!internalValue} onClick={() => create.mutate()}>
        + Dodaj
      </button>
    </div>
  );
}
