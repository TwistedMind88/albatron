import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { VALUTE } from "@albatron/shared";
import { api, ApiError } from "../../api";
import { Autocomplete, type AutocompleteOption } from "../../components/Autocomplete";
import Toggle from "../../components/Toggle";

// Kolone cenovnika koje se mapiraju iz fajla (brief 6; napomena faza 16 RP9)
const FIELDS = [
  { id: "sku", label: "SKU *" },
  { id: "naziv", label: "Naziv" },
  { id: "cena", label: "Cena" },
  { id: "opis", label: "Opis" },
  { id: "napomena", label: "Napomena" },
] as const;

interface Dobavljac {
  id: number;
  naziv: string;
  valuta: string;
}

export function UvozPopup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [naziv, setNaziv] = useState("");
  const [dobavljac, setDobavljac] = useState<AutocompleteOption | null>(null);
  const [valuta, setValuta] = useState("EUR");
  const [vaziOd, setVaziOd] = useState(new Date().toISOString().slice(0, 10));
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Custom kolone (faza 16 RP9): naziv + mapirana kolona iz fajla
  const [customCols, setCustomCols] = useState<{ naziv: string; kolona: string }[]>([]);
  const [noviCustom, setNoviCustom] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Discontinued (brief 14.5): kolona+tekst ili poseban sheet
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [discOn, setDiscOn] = useState(false);
  const [discMode, setDiscMode] = useState<"kolona" | "sheet">("kolona");
  const [discKolona, setDiscKolona] = useState("");
  const [discTekst, setDiscTekst] = useState("");
  const [discSheet, setDiscSheet] = useState("");

  const dobavljaci = useQuery({
    queryKey: ["subjekti", "dobavljac"],
    queryFn: () => api<Dobavljac[]>("/api/subjekti?uloga=dobavljac"),
  });

  async function onFile(file: File) {
    const wb = XLSX.read(await file.arrayBuffer());
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (data.length === 0) {
      setError("Fajl je prazan");
      return;
    }
    const hdrs = Object.keys(data[0]!);
    setWb(wb);
    setHeaders(hdrs);
    setRows(data);
    if (!naziv) setNaziv(file.name.replace(/\.[^.]+$/, ""));
    // automatsko mapiranje po slicnosti naziva
    const auto: Record<string, string> = {};
    for (const f of FIELDS) {
      const hit = hdrs.find((h) => h.toLowerCase().replace(/[^a-z]/g, "").includes(f.id));
      if (hit) auto[f.id] = hit;
    }
    setMapping(auto);
    setError("");
  }

  async function doImport() {
    if (!dobavljac) {
      setError("Izaberite dobavljača");
      return;
    }
    if (!mapping.sku) {
      setError("SKU kolona je obavezna");
      return;
    }
    if (discOn && discMode === "kolona" && (!discKolona || !discTekst.trim())) {
      setError("Za discontinued kolonu izaberite kolonu i unesite tekst");
      return;
    }
    if (discOn && discMode === "sheet" && !discSheet) {
      setError("Izaberite sheet sa discontinued artiklima");
      return;
    }
    setError("");
    setSaving(true);
    const tekst = discTekst.trim().toLowerCase();
    const mapiraj = (r: Record<string, unknown>, discontinued: boolean) => {
      const cenaRaw = mapping.cena ? String(r[mapping.cena] ?? "").replace(",", ".").trim() : "";
      const cena = cenaRaw === "" || isNaN(Number(cenaRaw)) ? null : Number(cenaRaw);
      const custom: Record<string, string> = {};
      for (const cc of customCols) {
        if (!cc.kolona) continue;
        const v = String(r[cc.kolona] ?? "").trim();
        if (v) custom[cc.naziv] = v;
      }
      return {
        sku: String(r[mapping.sku!] ?? "").trim(),
        naziv: mapping.naziv ? String(r[mapping.naziv] ?? "").trim() : "",
        cena,
        opis: mapping.opis ? String(r[mapping.opis] ?? "").trim() : "",
        napomena: mapping.napomena ? String(r[mapping.napomena] ?? "").trim().slice(0, 400) : "",
        custom,
        discontinued,
      };
    };
    const jeDisc = (r: Record<string, unknown>) =>
      discOn &&
      discMode === "kolona" &&
      String(r[discKolona] ?? "").trim().toLowerCase().includes(tekst);
    let items = rows.map((r) => mapiraj(r, jeDisc(r))).filter((i) => i.sku !== "");
    if (discOn && discMode === "sheet" && wb) {
      const discData = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[discSheet]!, {
        defval: "",
      });
      items = items.concat(discData.map((r) => mapiraj(r, true)).filter((i) => i.sku !== ""));
    }
    try {
      await api("/api/cenovnici", {
        method: "POST",
        body: { naziv, dobavljacId: Number(dobavljac.id), valuta, vaziOd, items },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri uvozu");
      setSaving(false);
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 560 }}>
        <h2>Uvoz cenovnika</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140, fontSize: 12 }}>Dobavljač *</span>
            <div style={{ flex: 1 }}>
              <Autocomplete
                options={(dobavljaci.data ?? []).map((d) => ({ id: d.id, label: d.naziv }))}
                value={dobavljac}
                onChange={(o) => {
                  setDobavljac(o);
                  // default valuta = valuta dobavljaca, fallback EUR (st. 52)
                  const v = dobavljaci.data?.find((d) => d.id === o?.id)?.valuta;
                  setValuta(v && (VALUTE as readonly string[]).includes(v) ? v : "EUR");
                }}
                placeholder="Izaberite dobavljača"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140, fontSize: 12 }}>Naziv cenovnika *</span>
            <input className="input" style={{ flex: 1 }} value={naziv} onChange={(e) => setNaziv(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140, fontSize: 12 }}>Valuta</span>
            <select className="input" style={{ width: 80 }} value={valuta} onChange={(e) => setValuta(e.target.value)}>
              {VALUTE.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span style={{ width: 60, fontSize: 12, textAlign: "right" }}>Važi od</span>
            <input
              type="date"
              className="input"
              value={vaziOd}
              onChange={(e) => setVaziOd(e.target.value)}
            />
          </div>
        </div>
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          style={{ marginBottom: 12 }}
        />
        {headers.length > 0 && (
          <>
            <p style={{ fontSize: 12 }}>{rows.length} redova. Mapirajte kolone fajla na polja:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {FIELDS.map((f) => (
                <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 140, fontSize: 12 }}>{f.label}</span>
                  <select
                    className="input"
                    style={{ flex: 1 }}
                    value={mapping[f.id] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.id]: e.target.value })}
                  >
                    <option value="">- preskoči -</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {/* Custom kolone (st. 54): neogranicen broj, naziv + izbor kolone iz fajla */}
              {customCols.map((cc, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 140, fontSize: 12 }}>{cc.naziv}</span>
                  <select
                    className="input"
                    style={{ flex: 1 }}
                    value={cc.kolona}
                    onChange={(e) =>
                      setCustomCols(customCols.map((c, j) => (j === i ? { ...c, kolona: e.target.value } : c)))
                    }
                  >
                    <option value="">- preskoči -</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={() => setCustomCols(customCols.filter((_, j) => j !== i))}>
                    x
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  style={{ width: 140 }}
                  value={noviCustom}
                  onChange={(e) => setNoviCustom(e.target.value)}
                  placeholder="Nova kolona"
                />
                <button
                  className="btn"
                  disabled={!noviCustom.trim() || customCols.some((c) => c.naziv === noviCustom.trim())}
                  onClick={() => {
                    setCustomCols([...customCols, { naziv: noviCustom.trim(), kolona: "" }]);
                    setNoviCustom("");
                  }}
                >
                  +
                </button>
              </div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 8 }}>
              <Toggle checked={discOn} onChange={setDiscOn} />
              Cenovnik sadrži discontinued artikle
            </label>
            {discOn && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 140, fontSize: 12 }}>Način označavanja</span>
                  <select
                    className="input"
                    style={{ flex: 1 }}
                    value={discMode}
                    onChange={(e) => setDiscMode(e.target.value as "kolona" | "sheet")}
                  >
                    <option value="kolona">Kolona sa tekstom</option>
                    <option value="sheet">Poseban sheet</option>
                  </select>
                </div>
                {discMode === "kolona" ? (
                  <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ width: 140, fontSize: 12 }}>Kolona</span>
                      <select
                        className="input"
                        style={{ flex: 1 }}
                        value={discKolona}
                        onChange={(e) => setDiscKolona(e.target.value)}
                      >
                        <option value="">- izaberite -</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ width: 140, fontSize: 12 }}>Tekst u ćeliji</span>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        value={discTekst}
                        onChange={(e) => setDiscTekst(e.target.value)}
                        placeholder="npr. discontinued"
                      />
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 140, fontSize: 12 }}>Sheet</span>
                    <select
                      className="input"
                      style={{ flex: 1 }}
                      value={discSheet}
                      onChange={(e) => setDiscSheet(e.target.value)}
                    >
                      <option value="">- izaberite -</option>
                      {(wb?.SheetNames ?? []).slice(1).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn primary"
            disabled={rows.length === 0 || !naziv || saving}
            onClick={doImport}
          >
            Uvezi
          </button>
          <button className="btn" onClick={onCancel}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
