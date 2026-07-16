import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Autocomplete } from "../../components/Autocomplete";
import Toggle from "../../components/Toggle";
import { type Potreba, fmt } from "./common";

// Red tabele obracuna narudzbina (brief 8.5)
export interface ObracunRed {
  articleId: number;
  ident: string;
  naziv: string;
  predlog: number;
  potrebe: number;
  potrebeLista: Potreba[];
  lager: number;
  prijemno: number;
  poruciZaKupce: number;
  dopunaOd: number;
  dopunaDo: number;
  zalihaNakon: number;
  poruciZaLager: number;
  dobavljacevaCena: number | null;
  dobavljacevaValuta: string;
  ocekivaniPopust: number;
  porezId: number | null;
}

interface PrijemniDok {
  id: number;
  broj: string;
  tip: string;
  datum: string;
  status: string;
  klijentId: number | null;
  klijentNaziv: string;
}

const NIVOI = ["min", "opt", "max"] as const;

// Carobnjak "Obracun narudzbina" (brief 8.5)
export function ObracunPopup({
  dobavljacId: initDobavljacId,
  dobavljacNaziv,
  onUbaci,
  onClose,
}: {
  dobavljacId: number;
  dobavljacNaziv: string;
  onUbaci: (redovi: ObracunRed[]) => void;
  onClose: () => void;
}) {
  const [dobavljacId, setDobavljacId] = useState(initDobavljacId);
  const [datumOd, setDatumOd] = useState("");
  const [datumDo, setDatumDo] = useState("");
  const [statusi, setStatusi] = useState<Set<string>>(new Set(["u obradi"]));
  const [skladistaSel, setSkladistaSel] = useState<Set<number> | null>(null);
  const [zaLager, setZaLager] = useState(false);
  const [od, setOd] = useState<(typeof NIVOI)[number]>("min");
  const [dop, setDop] = useState<(typeof NIVOI)[number]>("opt");
  const [prijemni, setPrijemni] = useState<PrijemniDok[]>([]);
  const [prijemniPopup, setPrijemniPopup] = useState(false);
  const [rows, setRows] = useState<ObracunRed[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const dobavljaci = useQuery({
    queryKey: ["subjekti", "dobavljac"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/subjekti?uloga=dobavljac"),
  });
  const sifarnici = useQuery({
    queryKey: ["dokumenti-sifarnici"],
    queryFn: () => api<{ kind: string; docType: string | null; internalValue: string }[]>("/api/dokumenti-sifarnici"),
  });
  const skladista = useQuery({
    queryKey: ["skladista"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/skladista"),
  });

  const statusOpcije = (sifarnici.data ?? [])
    .filter((l) => l.kind === "status_dokumenta" && l.docType === "predracun")
    .map((l) => l.internalValue);
  // default: sva skladista ukljucena u zbir lagera
  const skladistaIzabrana = skladistaSel ?? new Set((skladista.data ?? []).map((s) => s.id));

  async function obracunaj() {
    setError("");
    try {
      const res = await api<{ rows: ObracunRed[] }>("/api/porudzbine/obracun", {
        method: "POST",
        body: {
          dobavljacId,
          datumOd: datumOd || null,
          datumDo: datumDo || null,
          statusi: [...statusi],
          skladista: [...skladistaIzabrana],
          zaLager,
          od,
          dop,
          prijemni: prijemni.map((p) => p.id),
        },
      });
      setRows(res.rows);
      setSel(new Set(res.rows.filter((r) => r.predlog > 0).map((r) => r.articleId)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri obračunu");
    }
  }

  function izmeniPredlog(articleId: number, v: number) {
    setRows((prev) => (prev ?? []).map((r) => (r.articleId === articleId ? { ...r, predlog: v } : r)));
  }

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  return (
    <div className="overlay">
      <div className="popup" style={{ width: "min(1180px, 96vw)", maxHeight: "92vh", overflowY: "auto" }}>
        <h2>Obračun narudžbina</h2>

        {/* zaglavlje sa opcijama i filterima (brief 8.5) */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, alignItems: "flex-end" }}>
          <label className="field" style={{ width: 200 }}>
            Dobavljač
            <Autocomplete
              options={(dobavljaci.data ?? []).map((s) => ({ id: s.id, label: s.naziv }))}
              value={{ id: dobavljacId, label: (dobavljaci.data ?? []).find((s) => s.id === dobavljacId)?.naziv ?? dobavljacNaziv }}
              onChange={(o) => o && setDobavljacId(Number(o.id))}
            />
          </label>
          <label className="field">
            Predračuni od
            <input type="date" className="input" value={datumOd} onChange={(e) => setDatumOd(e.target.value)} />
          </label>
          <label className="field">
            do
            <input type="date" className="input" value={datumDo} onChange={(e) => setDatumDo(e.target.value)} />
          </label>
          <div className="field">
            Statusi predračuna
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              {statusOpcije.map((s) => (
                <label key={s} style={{ fontSize: 12, display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={statusi.has(s)} onChange={() => setStatusi(toggle(statusi, s))} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            Skladišta (zbir lagera)
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              {(skladista.data ?? []).map((s) => (
                <label key={s.id} style={{ fontSize: 12, display: "flex", gap: 3, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={skladistaIzabrana.has(s.id)}
                    onChange={() => setSkladistaSel(toggle(skladistaIzabrana, s.id))}
                  />
                  {s.naziv}
                </label>
              ))}
              {(skladista.data ?? []).length === 0 && <span style={{ fontSize: 12 }}>nema skladišta</span>}
            </div>
          </div>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", paddingBottom: 6 }}>
            <Toggle checked={zaLager} onChange={setZaLager} />
            Poručivanje za lager
          </label>
          {zaLager && (
            <>
              <label className="field" style={{ width: 130 }}>
                Zaliha manja od
                <select className="input" value={od} onChange={(e) => setOd(e.target.value as never)}>
                  {NIVOI.map((n) => (
                    <option key={n} value={n}>
                      {n === "min" ? "minimalne" : n === "opt" ? "optimalne" : "maksimalne"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ width: 130 }}>
                Dopuni do
                <select className="input" value={dop} onChange={(e) => setDop(e.target.value as never)}>
                  {NIVOI.map((n) => (
                    <option key={n} value={n}>
                      {n === "min" ? "minimalne" : n === "opt" ? "optimalne" : "maksimalne"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button className="btn" style={{ marginBottom: 6 }} onClick={() => setPrijemniPopup(true)}>
            Uračunaj prijemne dokumente{prijemni.length > 0 ? ` (${prijemni.length})` : ""}
          </button>
          <button className="btn primary" style={{ marginBottom: 6 }} onClick={obracunaj}>
            Obračunaj
          </button>
        </div>

        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}

        {rows !== null && (
          <div className="tablewrap" style={{ maxHeight: 420, overflowY: "auto", marginBottom: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>Ident</th>
                  <th>Naziv</th>
                  <th>Za poručivanje</th>
                  <th>Potrebe za klijente</th>
                  <th>Na lageru</th>
                  <th>Sa prijemnih</th>
                  <th>Potrebno za kupce</th>
                  <th>Dopuna od</th>
                  <th>Dopuna do</th>
                  <th>Zaliha nakon pakovanja</th>
                  <th>Potrebno za lager</th>
                  <th>Predlog</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.articleId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={sel.has(r.articleId)}
                        onChange={() => setSel(toggle(sel, r.articleId))}
                      />
                    </td>
                    <td className="subtle">{r.ident}</td>
                    <td>
                      {r.naziv}
                      {r.potrebeLista.length > 0 && (
                        <span className="subtle" title={r.potrebeLista.map((p) => `${p.broj} ${p.klijentNaziv} (${p.kolicina})`).join("\n")}>
                          {" "}
                          [{r.potrebeLista.length}]
                        </span>
                      )}
                    </td>
                    <td>
                      <KolicinaCell value={r.predlog} onCommit={(v) => izmeniPredlog(r.articleId, v)} />
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt(r.potrebe)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.lager)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.prijemno)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.poruciZaKupce)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.dopunaOd)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.dopunaDo)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.zalihaNakon)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.poruciZaLager)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.poruciZaKupce + r.poruciZaLager)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13}>Nema artikala za poručivanje po zadatim filterima.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn primary"
            disabled={rows === null || sel.size === 0}
            onClick={() => onUbaci((rows ?? []).filter((r) => sel.has(r.articleId)))}
          >
            Ubaci u porudžbinu ({sel.size})
          </button>
          <button className="btn" onClick={onClose}>
            Zatvori
          </button>
        </div>

        {prijemniPopup && (
          <PrijemniPopup
            dobavljacId={dobavljacId}
            izabrani={prijemni}
            onSave={(docs) => {
              setPrijemni(docs);
              setPrijemniPopup(false);
            }}
            onClose={() => setPrijemniPopup(false)}
          />
        )}
      </div>
    </div>
  );
}

// izmenjiva kolicina za porucivanje (brief 8.5)
function KolicinaCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  function commit() {
    const n = Number(draft.replace(",", "."));
    if (!isNaN(n)) onCommit(n);
  }
  return (
    <input
      className="input"
      style={{ width: 70, textAlign: "right", fontWeight: 700 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

// Popup za izbor porudzbina/priprema koje se uracunavaju u lager (brief 8.5)
function PrijemniPopup({
  dobavljacId,
  izabrani,
  onSave,
  onClose,
}: {
  dobavljacId: number;
  izabrani: PrijemniDok[];
  onSave: (docs: PrijemniDok[]) => void;
  onClose: () => void;
}) {
  const [datumOd, setDatumOd] = useState("");
  const [datumDo, setDatumDo] = useState("");
  const [samoDobavljac, setSamoDobavljac] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set(izabrani.map((d) => d.id)));
  const query = useQuery({
    queryKey: ["prijemni-dokumenti"],
    queryFn: () => api<PrijemniDok[]>("/api/porudzbine/prijemni"),
  });

  const docs = (query.data ?? []).filter((d) => {
    if (samoDobavljac && d.klijentId !== dobavljacId) return false;
    const datum = d.datum.slice(0, 10);
    if (datumOd && datum < datumOd) return false;
    if (datumDo && datum > datumDo) return false;
    return true;
  });

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 560 }}>
        <h2>Prijemni dokumenti</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
          <label className="field">
            Datum od
            <input type="date" className="input" value={datumOd} onChange={(e) => setDatumOd(e.target.value)} />
          </label>
          <label className="field">
            do
            <input type="date" className="input" value={datumDo} onChange={(e) => setDatumDo(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", paddingBottom: 6 }}>
            <Toggle checked={samoDobavljac} onChange={setSamoDobavljac} />
            Samo izabrani dobavljač
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, maxHeight: 300, overflowY: "auto" }}>
          {docs.map((d) => (
            <label key={d.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={sel.has(d.id)}
                onChange={() => {
                  const next = new Set(sel);
                  if (next.has(d.id)) next.delete(d.id);
                  else next.add(d.id);
                  setSel(next);
                }}
              />
              {d.broj} - {d.klijentNaziv} ({new Date(d.datum).toLocaleDateString("sr-RS")}, {d.status})
            </label>
          ))}
          {docs.length === 0 && <span style={{ fontSize: 12 }}>Nema porudžbina ni priprema po filterima.</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={() => onSave((query.data ?? []).filter((d) => sel.has(d.id)))}>
            Primeni ({sel.size})
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
