import { useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { sacuvajFajl } from "../download";

// Import + masovno azuriranje sifarnika (faza 15, RP4).
// Parsiranje xls/xlsx/csv na klijentu (SheetJS), server validira i pise.

export interface ImportKolona {
  key: string;
  label: string;
  obavezno?: boolean; // samo oznaka u UI; stvarna validacija je na serveru
  broj?: boolean; // decimale sa zarezom se normalizuju
}

export interface ImportConfig {
  naslov: string;
  endpoint: string;
  kolone: ImportKolona[];
  // kolone koje smeju biti kljuc pri azuriranju (subjekti); artikli imaju fiksni kljuc ident
  kljucKolone?: { key: string; label: string }[];
  extraBody?: Record<string, unknown>;
  // prefiks react-query kljuca za invalidaciju liste posle uspesnog importa
  invalidateKey: string;
  napomena?: string;
  // dorada mapiranog reda pre slanja (npr. default valute subjekta)
  doradi?: (r: Record<string, string>) => Record<string, string>;
}

interface RezRed {
  index: number;
  status: "ok" | "greska";
  napomena: string;
  predlozeniIdent?: string;
}

interface ImportOdgovor {
  ok: boolean;
  rows: RezRed[];
  created: Record<string, string>[];
}

export function ImportSifarnika({ config }: { config: ImportConfig }) {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"novi" | "azuriranje">("novi");
  const [kljucKolona, setKljucKolona] = useState(config.kljucKolone?.[0]?.key ?? "");
  const [rez, setRez] = useState<RezRed[] | null>(null);
  const [created, setCreated] = useState<Record<string, string>[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError("");
    setRez(null);
    setCreated(null);
    const wb = XLSX.read(await file.arrayBuffer());
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (data.length === 0) {
      setHeaders([]);
      setRawRows([]);
      setError("Fajl je prazan ili sadrzi samo header");
      return;
    }
    setFileName(file.name);
    const hdrs = Object.keys(data[0]!);
    setHeaders(hdrs);
    setRawRows(data);
    // automatsko mapiranje po slicnosti naziva (preneto iz starog ImportPopup)
    const auto: Record<string, string> = {};
    for (const k of config.kolone) {
      const hit = hdrs.find((h) => h.toLowerCase().replace(/[^a-z]/g, "").includes(k.key.toLowerCase()));
      if (hit) auto[k.key] = hit;
    }
    setMapping(auto);
  }

  // mapirani redovi: trim, decimale sa zarezom -> tacka, prazno se ne salje kao polje
  function buildRows(): Record<string, string>[] {
    return rawRows.map((r) => {
      let out: Record<string, string> = {};
      for (const k of config.kolone) {
        const col = mapping[k.key];
        if (!col) continue;
        let v = String(r[col] ?? "").trim();
        if (k.broj) v = v.replace(",", ".");
        out[k.key] = v;
      }
      if (config.doradi) out = config.doradi(out);
      return out;
    });
  }

  async function posalji(dryRun: boolean) {
    setError("");
    setBusy(true);
    try {
      const res = await api<ImportOdgovor>(config.endpoint, {
        method: "POST",
        body: {
          mode,
          dryRun,
          rows: buildRows(),
          ...(config.kljucKolone && mode === "azuriranje" ? { kljucKolona } : {}),
          ...config.extraBody,
        },
      });
      setRez(res.rows);
      if (!dryRun && res.ok) {
        setCreated(res.created);
        void qc.invalidateQueries({ queryKey: [config.invalidateKey] });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri importu");
    } finally {
      setBusy(false);
    }
  }

  // template xlsx: header (ocisceni nazivi kolona) + 1 primer red sa formatom
  function preuzmiTemplate() {
    const header = config.kolone.map((k) => k.label.replace(/\s*\(.*?\)\s*/g, "").trim());
    const primer = config.kolone.map((k) => {
      if (k.broj) return "0";
      const kl = k.key.toLowerCase();
      if (kl.includes("datum")) return "01.01.2026";
      if (kl.includes("valuta")) return "EUR";
      if (kl.includes("serijski")) return "ne";
      if (kl === "tip") return "O";
      return "";
    });
    const ws = XLSX.utils.aoa_to_sheet([header, primer]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl("template.xlsx", new Blob([buf]));
  }

  function exportUvezenih() {
    const ws = XLSX.utils.json_to_sheet(created!);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Uvezeno");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl("uvezeno.xlsx", new Blob([buf]));
  }

  const rezPo = new Map((rez ?? []).map((r) => [r.index, r]));
  const imaIdenta = (rez ?? []).some((r) => r.predlozeniIdent !== undefined);
  const gotovo = created !== null;

  return (
    <>
      <div className="page-head">
        <h1>{config.naslov}</h1>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label className="btn" style={{ cursor: "pointer" }}>
          Izaberi fajl
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
          />
        </label>
        <span style={{ fontSize: 12 }}>{fileName || "Nije izabran fajl (xls, xlsx ili csv)"}</span>
        <button className="btn" onClick={preuzmiTemplate}>Preuzmi template</button>
        <label style={{ fontSize: 12 }}>
          <input type="radio" checked={mode === "novi"} onChange={() => { setMode("novi"); setRez(null); setCreated(null); }} /> Novi
        </label>
        <label style={{ fontSize: 12 }}>
          <input type="radio" checked={mode === "azuriranje"} onChange={() => { setMode("azuriranje"); setRez(null); setCreated(null); }} /> Ažuriranje
        </label>
        {config.kljucKolone && mode === "azuriranje" && (
          <label style={{ fontSize: 12 }}>
            Ključ-kolona:{" "}
            <select className="input" value={kljucKolona} onChange={(e) => setKljucKolona(e.target.value)}>
              {config.kljucKolone.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </label>
        )}
        <button className="btn" disabled={rawRows.length === 0 || busy} onClick={() => void posalji(true)}>
          Pregled
        </button>
        <button className="btn primary" disabled={rawRows.length === 0 || busy || gotovo} onClick={() => void posalji(false)}>
          Uvezi
        </button>
      </div>
      {config.napomena && <p style={{ fontSize: 12, color: "var(--muted, #888)" }}>{config.napomena}</p>}
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      {gotovo && (
        <p>
          Uvezeno redova: <b>{rez?.length ?? 0}</b>{" "}
          {created!.length > 0 && (
            <button className="btn" onClick={exportUvezenih}>Export uvezenih u Excel</button>
          )}
        </p>
      )}
      {headers.length > 0 && (
        <>
          <p style={{ fontSize: 12 }}>{rawRows.length} redova. Mapirajte kolone fajla na polja:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {config.kolone.map((k) => (
              <label key={k.key} style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                {k.label}
                {k.obavezno ? " *" : ""}
                <select
                  className="input"
                  value={mapping[k.key] ?? ""}
                  onChange={(e) => { setMapping({ ...mapping, [k.key]: e.target.value }); setRez(null); setCreated(null); }}
                >
                  <option value="">- preskoči -</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  {imaIdenta && <th>Ident</th>}
                  {config.kolone.filter((k) => mapping[k.key]).map((k) => (
                    <th key={k.key}>{k.label}</th>
                  ))}
                  <th>Napomena</th>
                </tr>
              </thead>
              <tbody>
                {rawRows.map((r, i) => {
                  const st = rezPo.get(i);
                  return (
                    <tr key={i} style={st?.status === "greska" ? { background: "rgba(220,53,69,0.15)" } : undefined}>
                      {imaIdenta && <td>{st?.predlozeniIdent ?? ""}</td>}
                      {config.kolone.filter((k) => mapping[k.key]).map((k) => (
                        <td key={k.key}>{String(r[mapping[k.key]!] ?? "")}</td>
                      ))}
                      <td style={st?.status === "greska" ? { color: "var(--danger)" } : undefined}>{st?.napomena ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const ARTIKLI_KOLONE: ImportKolona[] = [
  { key: "ident", label: "Ident (ključ pri ažuriranju; kod novih oznaka parent reda)" },
  { key: "tip", label: "Tip (O/P/V, prazno = O)" },
  { key: "parentIdent", label: "Parent ident (obavezno za V)" },
  { key: "naziv", label: "Naziv", obavezno: true },
  { key: "dobavljac", label: "Dobavljač (naziv)", obavezno: true },
  { key: "sku", label: "SKU", obavezno: true },
  { key: "prodajnaCena", label: "Prodajna cena", obavezno: true, broj: true },
  { key: "prodajnaValuta", label: "Prodajna valuta" },
  { key: "dobavljacevaCena", label: "Dobavljačeva cena", obavezno: true, broj: true },
  { key: "dobavljacevaValuta", label: "Dobavljačeva valuta" },
  { key: "kurs", label: "Kurs", broj: true },
  { key: "ocekivaniPopust", label: "Očekivani popust %", broj: true },
  { key: "carinskaStopa", label: "Carinska stopa %", broj: true },
  { key: "sertifikacijaStopa", label: "Sertifikacija %", broj: true },
  { key: "dodatniTroskoviStopa", label: "Dodatni troškovi %", broj: true },
  { key: "carinskaTarifa", label: "Carinska tarifa" },
  { key: "zemljaPorekla", label: "Zemlja porekla" },
  { key: "glavnaKategorija", label: "Glavna kategorija (šifra)" },
  { key: "sekundarnaKategorija", label: "Sekundarna kategorija (šifra)" },
  { key: "akcijaProcenat", label: "Akcija %", broj: true },
  { key: "serijskiBrojevi", label: "Serijski brojevi (da/ne)" },
  { key: "opis", label: "Opis" },
  { key: "napomena", label: "Napomena" },
];

export function ArtikliImportPage() {
  return (
    <ImportSifarnika
      config={{
        naslov: "Import artikala",
        endpoint: "/api/artikli-import",
        kolone: ARTIKLI_KOLONE,
        invalidateKey: "artikli",
        napomena:
          "Tip: O = običan (podrazumevano), P = parent, V = varijacija. Varijacija mora imati Parent ident - ident postojećeg parent artikla ili oznaku iz Ident kolone parent reda u istom fajlu (parenti se uvoze pre varijacija). Kod novih artikala ident dodeljuje server; kod ažuriranja prazna ćelija ne menja polje. Kategorije se unose kao šifre; marža se ne uvozi (računa se iz cena). Serijski brojevi (da/ne) primenjuju se samo pri unosu novih artikala. Akcija % se upisuje; aktivacija (period/neograničeno) ostaje u formi artikla.",
      }}
    />
  );
}

const SUBJEKTI_KOLONE: ImportKolona[] = [
  { key: "naziv", label: "Naziv", obavezno: true },
  { key: "puniNaziv", label: "Puni naziv", obavezno: true },
  { key: "adresa", label: "Adresa", obavezno: true },
  { key: "postanskiBroj", label: "Poštanski broj", obavezno: true },
  { key: "grad", label: "Grad", obavezno: true },
  { key: "pib", label: "PIB" },
  { key: "mb", label: "MB" },
  { key: "drzava", label: "Država" },
  { key: "valuta", label: "Valuta" },
];

const UPLATE_KOLONE: ImportKolona[] = [
  { key: "klijent", label: "Klijent (naziv ili PIB)", obavezno: true },
  { key: "iznos", label: "Iznos", obavezno: true, broj: true },
  { key: "pozivNaBroj", label: "Poziv na broj", obavezno: true },
  { key: "datumUplate", label: "Datum uplate", obavezno: true },
  { key: "referent", label: "Referent" },
  { key: "avans", label: "Avans" },
  { key: "napomena", label: "Napomena" },
];

export function UplateImportPage() {
  return (
    <ImportSifarnika
      config={{
        naslov: "Import uplata",
        endpoint: "/api/uplate-import",
        kolone: UPLATE_KOLONE,
        invalidateKey: "uplate",
        napomena:
          "Klijent se prepoznaje po nazivu ili PIB-u; poziv na broj mora biti postojeći broj dokumenta. Datum u formatu dd.mm.gggg ili gggg-mm-dd. Podržan je samo unos novih uplata.",
      }}
    />
  );
}

export function SubjektiImportPage({ uloga }: { uloga: "klijent" | "dobavljac" }) {
  return (
    <ImportSifarnika
      config={{
        naslov: uloga === "klijent" ? "Import klijenata" : "Import dobavljača",
        endpoint: "/api/subjekti-import",
        kolone: SUBJEKTI_KOLONE,
        kljucKolone: [
          { key: "naziv", label: "Naziv" },
          { key: "puniNaziv", label: "Puni naziv" },
          { key: "pib", label: "PIB" },
          { key: "mb", label: "MB" },
        ],
        extraBody: { uloga },
        invalidateKey: "subjekti",
        napomena: "Kod ažuriranja prazna ćelija ne menja polje; neprepoznata vrednost ključa je greška reda.",
        // default valute kao u starom ImportPopup: Srbija -> RSD, ostalo -> EUR
        doradi: (r) => {
          const drzava = r.drzava || "Srbija";
          return { ...r, drzava, valuta: r.valuta || (drzava.trim().toLowerCase() === "srbija" ? "RSD" : "EUR") };
        },
      }}
    />
  );
}
