import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { api, ApiError } from "../../api";
import { sacuvajFajl } from "../../download";

// Ukljucivanje/iskljucivanje vodjenja serijskih brojeva (faza 15, RP3).
// Iskljucivanje: upozorenje + export CSV pre trajnog brisanja.
// Ukljucivanje: unos brojeva po skladistu sa stanjem, tacno stanje = broj unetih.

interface SkladisteStanje {
  warehouseId: number;
  naziv: string;
  stanje: number;
}

function parsirajBrojeve(text: string): string[] {
  return text
    .split(/[\n,\t]/)
    .map((b) => b.trim())
    .filter(Boolean);
}

export function SerijskiFlagPopup({
  articleId,
  ident,
  enable,
  onDone,
  onCancel,
}: {
  articleId: number;
  ident: string;
  enable: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [skladista, setSkladista] = useState<SkladisteStanje[]>([]);
  const [unosi, setUnosi] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enable) return;
    api<{ skladista: SkladisteStanje[] }>(`/api/artikli/${articleId}/zalihe`)
      .then((z) => setSkladista(z.skladista.filter((s) => s.stanje > 0)))
      .catch(() => setError("Greska pri ucitavanju stanja"));
  }, [articleId, enable]);

  async function potvrdi() {
    setError("");
    setBusy(true);
    try {
      const poSkladistu: Record<string, string[]> = {};
      if (enable) {
        for (const s of skladista) poSkladistu[String(s.warehouseId)] = parsirajBrojeve(unosi[s.warehouseId] ?? "");
      }
      await api(`/api/artikli/${articleId}/serijski-flag`, {
        method: "POST",
        body: enable ? { enable, poSkladistu } : { enable },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri snimanju");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    const svi = await api<{ skladiste: string; broj: string; izlazId: number | null }[]>(
      `/api/artikli/${articleId}/serijski-brojevi`,
    );
    const linije: string[] = [];
    let tekuce = "";
    for (const r of svi) {
      if (r.skladiste !== tekuce) {
        if (tekuce) linije.push("");
        linije.push(r.skladiste);
        tekuce = r.skladiste;
      }
      linije.push(r.izlazId !== null ? `${r.broj};izdat` : r.broj);
    }
    await sacuvajFajl(`serijski-${ident}.csv`, new Blob([linije.join("\n")], { type: "text/csv" }));
  }

  // Import iz fajla: kolone skladiste | broj, puni textarea-e po skladistu
  async function importFajl(file: File) {
    setError("");
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 });
      const poNazivu = new Map(skladista.map((s) => [s.naziv.trim().toLowerCase(), s.warehouseId]));
      const novi: Record<number, string[]> = {};
      for (const row of rows) {
        const naziv = String(row[0] ?? "").trim();
        const broj = String(row[1] ?? "").trim();
        if (!naziv && !broj) continue;
        if (naziv.toLowerCase() === "skladiste" || naziv.toLowerCase() === "skladište") continue; // header red
        const wid = poNazivu.get(naziv.toLowerCase());
        if (wid === undefined) {
          setError(`Skladiste "${naziv}" iz fajla ne postoji ili nema stanja`);
          return;
        }
        if (!broj) continue;
        (novi[wid] ??= []).push(broj);
      }
      setUnosi(Object.fromEntries(Object.entries(novi).map(([wid, brojevi]) => [wid, brojevi.join("\n")])));
    } catch {
      setError("Fajl nije moguce procitati");
    }
  }

  // klijentska validacija: tacno stanje po skladistu + bez duplikata u celom unosu
  const parsirano = skladista.map((s) => ({ ...s, brojevi: parsirajBrojeve(unosi[s.warehouseId] ?? "") }));
  const sviBrojevi = parsirano.flatMap((p) => p.brojevi);
  const imaDuplikata = new Set(sviBrojevi).size !== sviBrojevi.length;
  const svePoklapa = parsirano.every((p) => p.brojevi.length === p.stanje) && !imaDuplikata;

  if (!enable) {
    return (
      <div className="overlay">
        <div className="popup" style={{ width: 440 }}>
          <h2>Iskljucivanje vodjenja serijskih brojeva</h2>
          <p style={{ fontSize: 13 }}>
            Svi serijski brojevi ovog artikla bice <b>TRAJNO obrisani</b> (i oni izdati kupcima). Pre potvrde
            mozete izvesti spisak u CSV.
          </p>
          {error && <p className="login-error">{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={exportCsv}>
              Export CSV
            </button>
            <div className="grow" />
            <button className="btn" onClick={onCancel}>
              Odustani
            </button>
            <button className="btn primary" disabled={busy} onClick={potvrdi}>
              Potvrdi
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 520, maxHeight: "80vh", overflowY: "auto" }}>
        <h2>Ukljucivanje vodjenja serijskih brojeva</h2>
        {skladista.length === 0 ? (
          <p style={{ fontSize: 13 }}>Artikal nema zaliha - vodjenje se ukljucuje bez unosa brojeva.</p>
        ) : (
          <>
            <p style={{ fontSize: 13 }}>
              Za svako skladiste sa stanjem unesite tacan broj serijskih brojeva (novi red, zarez ili tab
              izmedju brojeva).
            </p>
            <label className="btn" style={{ marginBottom: 10, display: "inline-block" }}>
              Import iz fajla
              <input
                type="file"
                accept=".xls,.xlsx,.csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFajl(f);
                  e.target.value = "";
                }}
              />
            </label>
            {parsirano.map((s) => (
              <label key={s.warehouseId} className="field" style={{ marginBottom: 10 }}>
                <span>
                  {s.naziv}{" "}
                  <span style={{ color: s.brojevi.length === s.stanje ? "var(--ok)" : "var(--danger)" }}>
                    uneto {s.brojevi.length} / potrebno {s.stanje}
                  </span>
                </span>
                <textarea
                  className="input"
                  rows={4}
                  value={unosi[s.warehouseId] ?? ""}
                  onChange={(e) => setUnosi({ ...unosi, [s.warehouseId]: e.target.value })}
                />
              </label>
            ))}
            {imaDuplikata && <p className="login-error">Isti serijski broj je unet vise puta.</p>}
          </>
        )}
        {error && <p className="login-error">{error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>
            Odustani
          </button>
          <button className="btn primary" disabled={busy || !svePoklapa} onClick={potvrdi}>
            Potvrdi
          </button>
        </div>
      </div>
    </div>
  );
}
