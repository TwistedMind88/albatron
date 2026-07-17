import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";

interface SablonInfo {
  label: string;
  imeFajla: string;
  dobavljacNaziv: string;
  sheet: string;
  sekcije: { naslov: string; prviRed: number; slotova: number; kodPrefiksi: string[] }[];
}

// Upit dobavljaca po xlsx sablonu (admin): konfiguracija (JSON) + template (xlsx)
// se drze u bazi da ih update instalacije ne obrise, a javni kod ostane genericki.
// JSON fajl se odrzava van programa; ovde se samo ubacuje/menja/brise.
export function UpitSablon() {
  const qc = useQueryClient();
  const [json, setJson] = useState<Record<string, unknown> | null>(null);
  const [templateBase64, setTemplateBase64] = useState<string | null>(null);
  const [poruka, setPoruka] = useState("");
  const [greska, setGreska] = useState("");
  const [brisanje, setBrisanje] = useState(false);

  const info = useQuery({
    queryKey: ["rfq-sablon"],
    queryFn: () => api<SablonInfo | null>("/api/rfq-sablon"),
  });

  function ucitajJson(f: File) {
    setGreska("");
    f.text()
      .then((t) => setJson(JSON.parse(t) as Record<string, unknown>))
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
    setGreska("");
    setPoruka("");
    if (!json) return setGreska("Izaberite JSON fajl konfiguracije");
    // pri izmeni same konfiguracije template moze ostati postojeci samo ako je vec u JSON-u
    const body = templateBase64 ? { ...json, templateBase64 } : json;
    try {
      await api("/api/rfq-sablon", { method: "PUT", body });
      await qc.invalidateQueries({ queryKey: ["rfq-sablon"] });
      setJson(null);
      setTemplateBase64(null);
      setPoruka("Sačuvano");
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Snimanje nije uspelo");
    }
  }

  async function obrisi() {
    setBrisanje(false);
    await api("/api/rfq-sablon", { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["rfq-sablon"] });
    setPoruka("Obrisano");
  }

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Upit dobavljača (xlsx šablon)</h1>
      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        Export upita sa kalkulacije po šablonu konkretnog dobavljača. Podešava se JSON fajlom (mapiranje polja,
        sekcije, dobavljač) i xlsx šablonom; čuva se u bazi pa ažuriranje programa ne briše podešavanje. Bez
        podešavanja opcija exporta se ne prikazuje u meniju kalkulacije.
      </p>

      {info.data ? (
        <div style={{ fontSize: 13, border: "1px solid var(--line, #ccc)", borderRadius: 4, padding: 10 }}>
          <div>
            <strong>{info.data.label}</strong>
          </div>
          <div>Dobavljač: {info.data.dobavljacNaziv}</div>
          <div>Fajl: {info.data.imeFajla}-&lt;broj&gt;.xlsx (sheet: {info.data.sheet})</div>
          <div style={{ marginTop: 6 }}>Sekcije:</div>
          <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
            {info.data.sekcije.map((s) => (
              <li key={s.naslov}>
                {s.naslov}: red {s.prviRed}, {s.slotova} mesta, kategorije [{s.kodPrefiksi.join(", ") || "nije mapirano"}]
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={{ fontSize: 13, margin: 0 }}>Nije podešeno.</p>
      )}

      <label className="field">
        Konfiguracija (JSON)
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => e.target.files?.[0] && ucitajJson(e.target.files[0])}
        />
      </label>
      <label className="field">
        Šablon (xlsx)
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => e.target.files?.[0] && ucitajTemplate(e.target.files[0])}
        />
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={() => void snimi()}>
          Snimi
        </button>
        {info.data && (
          <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={() => setBrisanje(true)}>
            Obriši podešavanje
          </button>
        )}
        {poruka && <span style={{ color: "var(--ok)", fontSize: 12 }}>{poruka}</span>}
      </div>
      {greska && <div className="login-error">{greska}</div>}

      {brisanje && (
        <div className="overlay">
          <div className="popup">
            <h2>Brisanje podešavanja</h2>
            <p>Konfiguracija i šablon upita će biti obrisani; opcija exporta nestaje sa kalkulacije.</p>
            <div className="actions">
              <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={() => void obrisi()}>
                Obriši
              </button>
              <button className="btn" onClick={() => setBrisanje(false)}>
                Odustani
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
