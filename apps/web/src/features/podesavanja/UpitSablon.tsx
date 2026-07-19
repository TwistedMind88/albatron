import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";

interface SablonInfo {
  id: string;
  label: string;
  imeFajla: string;
  dobavljacId?: number;
  dobavljacNaziv?: string;
  sheet: string;
  sekcije: { naslov: string; prviRed: number; slotova: number; kodPrefiksi: string[] }[];
  polja: Record<string, string>;
  pnKolona: string;
  kolicinaKolona: string;
}

interface Dobavljac {
  id: number;
  naziv: string;
}

// Primer JSON konfiguracije za download: kljucevi koji pocinju sa "_" su
// komentari/uputstva i skidaju se pri ucitavanju fajla (JSON nema komentare)
const PRIMER = {
  _uputstvo:
    "Primer konfiguracije mapiranja za upit dobavljaca. Kljucevi koji pocinju donjom crtom (_) su komentari i program ih ignorise pri ucitavanju - mozete ih obrisati ili ostaviti. Naziv opcije i dobavljac se biraju u programu, ovaj fajl definise samo veze sa celijama xlsx sablona.",
  imeFajla: "upit-primer",
  _imeFajla: "Pocetak imena izlaznog fajla; puno ime je npr. upit-primer-26-KA-00012.xlsx",
  sheet: "Sheet1",
  _sheet: "Tacan naziv lista (sheet) u xlsx sablonu u koji se upisuju podaci",
  polja: {
    _uputstvo:
      "Podaci klijenta sa kalkulacije -> adresa celije u sablonu (npr. B7). Polje koje vam ne treba slobodno obrisite - nece se upisivati. Podrzana polja: puniNaziv, adresa, drzava, grad, postanskiBroj, kontaktIme, kontaktPrezime, kontaktEmail, kontaktTelefon.",
    puniNaziv: "B7",
    adresa: "B8",
    grad: "B9",
    postanskiBroj: "B10",
    drzava: "B11",
    kontaktIme: "B12",
    kontaktPrezime: "B13",
    kontaktEmail: "B14",
    kontaktTelefon: "B15",
  },
  sekcije: [
    {
      _uputstvo:
        "Sekcija = opseg redova u sablonu za grupu artikala. prviRed = prvi red opsega, slotova = koliko redova opseg ima. kodPrefiksi = pocetci koda glavne kategorije artikla (npr. A01 hvata A01020000); prazna lista [] znaci catch-all sekciju koja prima SVE artikle koje druge sekcije nisu primile. Za sablon gde sve ide u jedan opseg dovoljna je jedna sekcija sa praznim kodPrefiksi.",
      naslov: "Oprema",
      prviRed: 20,
      slotova: 10,
      kodPrefiksi: ["A01", "A02"],
    },
    {
      naslov: "Ostalo",
      prviRed: 32,
      slotova: 8,
      kodPrefiksi: [],
    },
  ],
  pnKolona: "B",
  _pnKolona: "Kolona u koju se upisuje SKU (broj artikla kod dobavljaca)",
  kolicinaKolona: "C",
  _kolicinaKolona: "Kolona u koju se upisuje kolicina",
};

// rekurzivno skida "_" kljuceve (komentare) iz ucitanog JSON-a
function bezKomentara(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bezKomentara);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, val]) => [k, bezKomentara(val)]),
    );
  }
  return v;
}

function preuzmiPrimer() {
  const blob = new Blob([JSON.stringify(PRIMER, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "upit-primer.json";
  a.click();
  URL.revokeObjectURL(url);
}

// Upit dobavljaca po xlsx sablonu (admin): vise konfiguracija, svaka je posebna
// opcija exporta na kalkulaciji. Konfiguracija (naziv + dobavljac + JSON mapiranje
// + xlsx template) se drzi u bazi da je update instalacije ne obrise.
export function UpitSablon() {
  const qc = useQueryClient();
  const [forma, setForma] = useState<{ id: string | null } | null>(null);
  const [label, setLabel] = useState("");
  const [dobavljacId, setDobavljacId] = useState<number | "">("");
  const [json, setJson] = useState<Record<string, unknown> | null>(null);
  const [templateBase64, setTemplateBase64] = useState<string | null>(null);
  const [poruka, setPoruka] = useState("");
  const [greska, setGreska] = useState("");
  const [brisanje, setBrisanje] = useState<SablonInfo | null>(null);

  const sabloni = useQuery({
    queryKey: ["rfq-sabloni"],
    queryFn: () => api<SablonInfo[]>("/api/rfq-sabloni"),
  });
  const dobavljaci = useQuery({
    queryKey: ["subjekti-dobavljaci"],
    queryFn: () => api<Dobavljac[]>("/api/subjekti?uloga=dobavljac"),
  });

  function otvoriFormu(s: SablonInfo | null) {
    setForma({ id: s?.id ?? null });
    setLabel(s?.label ?? "");
    setDobavljacId(s?.dobavljacId ?? "");
    setJson(null);
    setTemplateBase64(null);
    setPoruka("");
    setGreska("");
  }

  function ucitajJson(f: File) {
    setGreska("");
    f.text()
      .then((t) => setJson(bezKomentara(JSON.parse(t)) as Record<string, unknown>))
      .catch(() => setGreska("JSON fajl nije moguće pročitati"));
  }

  function ucitajTemplate(f: File) {
    setGreska("");
    const reader = new FileReader();
    reader.onload = () => setTemplateBase64((reader.result as string).split(",")[1] ?? null);
    reader.onerror = () => setGreska("Template fajl nije moguće pročitati");
    reader.readAsDataURL(f);
  }

  async function snimi() {
    if (!forma) return;
    setGreska("");
    setPoruka("");
    if (!label.trim()) return setGreska("Unesite naziv opcije");
    if (dobavljacId === "") return setGreska("Izaberite dobavljača");
    const postojeci = forma.id ? sabloni.data?.find((s) => s.id === forma.id) : undefined;
    // izmena bez novog JSON-a zadrzava postojece mapiranje (server cuva i template)
    const mapiranje =
      json ??
      (postojeci
        ? {
            imeFajla: postojeci.imeFajla,
            sheet: postojeci.sheet,
            polja: postojeci.polja,
            sekcije: postojeci.sekcije,
            pnKolona: postojeci.pnKolona,
            kolicinaKolona: postojeci.kolicinaKolona,
          }
        : null);
    if (!mapiranje) return setGreska("Izaberite JSON fajl konfiguracije");
    if (!forma.id && !templateBase64) return setGreska("Izaberite xlsx šablon");
    const body: Record<string, unknown> = { ...mapiranje, label: label.trim(), dobavljacId };
    if (templateBase64) body.templateBase64 = templateBase64;
    try {
      if (forma.id) await api(`/api/rfq-sabloni/${forma.id}`, { method: "PUT", body });
      else await api("/api/rfq-sabloni", { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["rfq-sabloni"] });
      setForma(null);
      setPoruka("Sačuvano");
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Snimanje nije uspelo");
    }
  }

  async function obrisi(s: SablonInfo) {
    setBrisanje(null);
    await api(`/api/rfq-sabloni/${s.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["rfq-sabloni"] });
    setPoruka("Obrisano");
  }

  function imeDobavljaca(s: SablonInfo) {
    if (s.dobavljacId !== undefined) {
      return dobavljaci.data?.find((d) => d.id === s.dobavljacId)?.naziv ?? s.dobavljacNaziv ?? `#${s.dobavljacId}`;
    }
    return s.dobavljacNaziv ?? "?";
  }

  return (
    <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Upit dobavljača (xlsx šablon)</h1>
      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        Export upita sa kalkulacije po šablonu dobavljača. Svaka konfiguracija (naziv opcije, dobavljač, JSON
        mapiranje ćelija i xlsx šablon) je posebno dugme u meniju kalkulacije. Čuva se u bazi pa ažuriranje
        programa ne briše podešavanja.
      </p>

      {sabloni.data?.length ? (
        sabloni.data.map((s) => (
          <div
            key={s.id}
            style={{ fontSize: 13, border: "1px solid var(--line, #ccc)", borderRadius: 4, padding: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ flex: 1 }}>{s.label}</strong>
              <button className="btn" onClick={() => otvoriFormu(s)}>
                Izmeni
              </button>
              <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={() => setBrisanje(s)}>
                Obriši
              </button>
            </div>
            <div>Dobavljač: {imeDobavljaca(s)}</div>
            <div>
              Fajl: {s.imeFajla}-&lt;broj&gt;.xlsx (sheet: {s.sheet})
            </div>
            <div style={{ marginTop: 6 }}>Sekcije:</div>
            <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
              {s.sekcije.map((sek) => (
                <li key={sek.naslov}>
                  {sek.naslov}: red {sek.prviRed}, {sek.slotova} mesta, kategorije [
                  {sek.kodPrefiksi.join(", ") || "sve (catch-all)"}]
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p style={{ fontSize: 13, margin: 0 }}>Nijedna konfiguracija nije podešena.</p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={() => otvoriFormu(null)}>
          Dodaj
        </button>
        <button className="btn" onClick={preuzmiPrimer}>
          Preuzmi primer JSON fajla
        </button>
        {poruka && <span style={{ color: "var(--ok)", fontSize: 12 }}>{poruka}</span>}
      </div>

      {forma && (
        <div style={{ border: "1px solid var(--line, #ccc)", borderRadius: 4, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <strong style={{ fontSize: 13 }}>{forma.id ? "Izmena konfiguracije" : "Nova konfiguracija"}</strong>
          <label className="field">
            Naziv opcije (tekst na dugmetu u kalkulaciji)
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="field">
            Dobavljač
            <select
              className="input"
              value={dobavljacId}
              onChange={(e) => setDobavljacId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">- izaberite -</option>
              {dobavljaci.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.naziv}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Konfiguracija veza sa ćelijama (JSON){forma.id ? " - prazno zadržava postojeću" : ""}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && ucitajJson(e.target.files[0])}
            />
          </label>
          <label className="field">
            Šablon (xlsx){forma.id ? " - prazno zadržava postojeći" : ""}
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => e.target.files?.[0] && ucitajTemplate(e.target.files[0])}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={() => void snimi()}>
              Snimi
            </button>
            <button className="btn" onClick={() => setForma(null)}>
              Odustani
            </button>
          </div>
          {greska && <div className="login-error">{greska}</div>}
        </div>
      )}

      {brisanje && (
        <div className="overlay">
          <div className="popup">
            <h2>Brisanje konfiguracije</h2>
            <p>
              Konfiguracija &quot;{brisanje.label}&quot; i njen šablon će biti obrisani; opcija exporta nestaje sa
              kalkulacije.
            </p>
            <div className="actions">
              <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={() => void obrisi(brisanje)}>
                Obriši
              </button>
              <button className="btn" onClick={() => setBrisanje(null)}>
                Odustani
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
