import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { NumInput } from "../../components/NumInput";

const JEDINICE = ["kom", "m", "kg", "l", "pak", "kutija"];

const NumPolje = ({ value, onChange, width = 90 }: { value: string | null; onChange: (v: string) => void; width?: number }) => (
  <NumInput value={n(value)} onChange={(v) => onChange(v === null ? "" : String(v))} width={width} />
);

interface Red {
  warehouseId: number;
  naziv: string;
  isPrimary: boolean;
  stanje: number;
  min: string | null;
  opt: string | null;
  max: string | null;
  serijskih: number;
}

interface Zalihe {
  zbirnaNasaKolicina: string | null;
  zbirnaNasaJm: string;
  zbirnaDobKolicina: string | null;
  zbirnaDobJm: string;
  minPorucivanje: string | null;
  korakPorucivanja: string | null;
  skladista: Red[];
}

const n = (v: string | null) => (v === null || v === "" ? null : Number(v));

// Kartica Zalihe artikla (brief 12): zbirna JM, parametri porucivanja,
// tabela skladista sa stanjem i min/opt/max, serijski brojevi, test ulaz
export function ZaliheTab({ articleId, vodiSerijske }: { articleId: number; vodiSerijske: boolean }) {
  const [z, setZ] = useState<Zalihe | null>(null);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");
  const [serijskiZa, setSerijskiZa] = useState<Red | null>(null);

  async function reload() {
    setZ(await api<Zalihe>(`/api/artikli/${articleId}/zalihe`));
  }
  useEffect(() => {
    reload().catch(() => setError("Greska pri ucitavanju zaliha"));
  }, [articleId]);

  if (!z) return <div className="placeholder">Učitavanje...</div>;

  function set<K extends keyof Zalihe>(key: K, value: Zalihe[K]) {
    setZ({ ...z!, [key]: value });
  }
  function setRed(warehouseId: number, key: "min" | "opt" | "max", value: string) {
    set(
      "skladista",
      z!.skladista.map((r) => (r.warehouseId === warehouseId ? { ...r, [key]: value } : r)),
    );
  }

  async function save() {
    setError("");
    try {
      await api(`/api/artikli/${articleId}/zalihe`, {
        method: "PUT",
        body: {
          zbirnaNasaKolicina: n(z!.zbirnaNasaKolicina),
          zbirnaNasaJm: z!.zbirnaNasaJm,
          zbirnaDobKolicina: n(z!.zbirnaDobKolicina),
          zbirnaDobJm: z!.zbirnaDobJm,
          minPorucivanje: n(z!.minPorucivanje),
          korakPorucivanja: n(z!.korakPorucivanja),
          nivoi: z!.skladista.map((r) => ({ warehouseId: r.warehouseId, min: n(r.min), opt: n(r.opt), max: n(r.max) })),
        },
      });
      setPoruka("Snimljeno");
      setTimeout(() => setPoruka(""), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  const zbirnaPrikaz =
    n(z.zbirnaNasaKolicina) && n(z.zbirnaDobKolicina)
      ? `${Number(z.zbirnaNasaKolicina)} ${z.zbirnaNasaJm} je ${Number(z.zbirnaDobKolicina)} ${z.zbirnaDobJm}`
      : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {poruka && <span style={{ color: "var(--ok)", fontSize: 12 }}>{poruka}</span>}
        {error && <span className="login-error">{error}</span>}
        <button className="btn primary" onClick={save}>
          Snimi zalihe
        </button>
      </div>

      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>ZBIRNA JEDINICA MERE</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field">
            Naša količina
            <NumPolje value={z.zbirnaNasaKolicina} onChange={(v) => set("zbirnaNasaKolicina", v)} />
          </label>
          <label className="field" style={{ width: 90 }}>
            JM
            <select className="input" value={z.zbirnaNasaJm} onChange={(e) => set("zbirnaNasaJm", e.target.value)}>
              <option value=""></option>
              {JEDINICE.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Dobavljačeva količina
            <NumPolje value={z.zbirnaDobKolicina} onChange={(v) => set("zbirnaDobKolicina", v)} />
          </label>
          <label className="field" style={{ width: 90 }}>
            JM
            <select className="input" value={z.zbirnaDobJm} onChange={(e) => set("zbirnaDobJm", e.target.value)}>
              <option value=""></option>
              {JEDINICE.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </select>
          </label>
          {zbirnaPrikaz && (
            <span style={{ fontSize: 12.5, background: "var(--accent-soft)", borderRadius: "var(--radius)", padding: "6px 10px" }}>
              {zbirnaPrikaz}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <label className="field">
            Min. količina za poručivanje
            <NumPolje value={z.minPorucivanje} onChange={(v) => set("minPorucivanje", v)} width={140} />
          </label>
          <label className="field">
            Korak (pakovanje) za poručivanje
            <NumPolje value={z.korakPorucivanja} onChange={(v) => set("korakPorucivanja", v)} width={160} />
          </label>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>SKLADIŠTA</h2>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Skladište</th>
                <th>Stanje</th>
                <th>Min</th>
                <th>Opt</th>
                <th>Max</th>
                {vodiSerijske && <th>Serijski brojevi</th>}
              </tr>
            </thead>
            <tbody>
              {z.skladista.map((r) => (
                <tr key={r.warehouseId}>
                  <td>
                    {r.naziv}
                    {r.isPrimary && <span className="subtle"> (primarno)</span>}
                  </td>
                  <td>{r.stanje.toLocaleString("sr-RS")}</td>
                  <td>
                    <NumPolje value={r.min} onChange={(v) => setRed(r.warehouseId, "min", v)} width={70} />
                  </td>
                  <td>
                    <NumPolje value={r.opt} onChange={(v) => setRed(r.warehouseId, "opt", v)} width={70} />
                  </td>
                  <td>
                    <NumPolje value={r.max} onChange={(v) => setRed(r.warehouseId, "max", v)} width={70} />
                  </td>
                  {vodiSerijske && (
                    <td>
                      <button className="btn" onClick={() => setSerijskiZa(r)}>
                        Izlistaj ({r.serijskih})
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {serijskiZa && (
        <SerijskiPopup articleId={articleId} skladiste={serijskiZa} onClose={() => setSerijskiZa(null)} />
      )}
    </div>
  );
}

function SerijskiPopup({ articleId, skladiste, onClose }: { articleId: number; skladiste: Red; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["serijski", articleId, skladiste.warehouseId],
    queryFn: () =>
      api<{ id: number; broj: string; createdAt: string }[]>(
        `/api/artikli/${articleId}/serijski-brojevi?skladisteId=${skladiste.warehouseId}`,
      ),
  });
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 420 }}>
        <h2>Serijski brojevi - {skladiste.naziv}</h2>
        <div className="tablewrap" style={{ maxHeight: 320, overflow: "auto", marginBottom: 12 }}>
          <table className="data">
            <tbody>
              {(q.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td>{s.broj}</td>
                  <td className="subtle">{new Date(s.createdAt).toLocaleDateString("sr-RS")}</td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && (
                <tr>
                  <td className="subtle">Nema serijskih brojeva na stanju.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button className="btn primary" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </div>
  );
}
