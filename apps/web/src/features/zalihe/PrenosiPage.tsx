import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { ArtikalAutocomplete, type ArtikalOpcija } from "../../components/ArtikalAutocomplete";
import { IzvestajPopup } from "../dokumenti/IzvestajPopup";
import type { Skladiste } from "../podesavanja/Moduli";

interface PrenosRed {
  id: number;
  broj: string;
  datum: string;
  izdajno: string;
  prijemno: string;
  napomena: string;
  referent: string | null;
}

interface Stavka {
  articleId: number;
  ident: string;
  naziv: string;
  kolicina: string;
  serijskiBrojevi: string[];
  napomena: string;
}

interface PrenosBody {
  izdajnoId: number;
  prijemnoId: number;
  datum: string;
  napomena: string;
  stavke: { articleId: number; kolicina: number; serijskiBrojevi: string[]; napomena: string }[];
}

// Prenos medju skladistima (brief 12): zaglavlje + stavke, validacija na serveru
export function PrenosiPage() {
  const [view, setView] = useState<"lista" | "novi" | number>("lista");
  const prenosi = useQuery({ queryKey: ["prenosi"], queryFn: () => api<PrenosRed[]>("/api/prenosi") });
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<{ zalihe: boolean }>("/api/moduli") });

  if (moduli.data && !moduli.data.zalihe) {
    return <div className="placeholder">Modul zaliha nije uključen (Podešavanja → Moduli).</div>;
  }
  if (view === "novi") return <NoviPrenos onDone={() => setView("lista")} />;
  if (typeof view === "number") return <PrenosIzmena id={view} onBack={() => setView("lista")} />;

  return (
    <>
      <div className="page-head">
        <h1>Prenosi među skladištima</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setView("novi")}>
          + Novi prenos
        </button>
      </div>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Broj</th>
              <th>Datum</th>
              <th>Izdajno</th>
              <th>Prijemno</th>
              <th>Referent</th>
              <th>Napomena</th>
            </tr>
          </thead>
          <tbody>
            {(prenosi.data ?? []).map((p) => (
              <tr key={p.id} onDoubleClick={() => setView(p.id)}>
                <td>
                  <a className="link" onClick={() => setView(p.id)}>
                    {p.broj}
                  </a>
                </td>
                <td>{new Date(p.datum).toLocaleDateString("sr-RS")}</td>
                <td>{p.izdajno}</td>
                <td>{p.prijemno}</td>
                <td>{p.referent ?? ""}</td>
                <td>{p.napomena}</td>
              </tr>
            ))}
            {(prenosi.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="subtle">
                  Nema prenosa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface PrenosDetaljData {
  broj: string;
  datum: string;
  izdajnoId: number;
  prijemnoId: number;
  napomena: string;
  stavke: (Stavka & { id: number })[];
}

// Prenos kao standardan dokument (faza 16, RP2): klik iz liste otvara ODMAH formu,
// bez medju-koraka; snimanje ostaje na formi (kao Sacuvaj u DokumentView)
function PrenosIzmena({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["prenos", id],
    queryFn: () => api<PrenosDetaljData>(`/api/prenosi/${id}`),
  });
  if (!q.data) return <div className="placeholder">Učitavanje...</div>;

  return (
    <PrenosForma
      naslov={`Prenos ${q.data.broj}`}
      submitLabel="Sačuvaj"
      izvestaj={{ id, broj: q.data.broj }}
      initial={{
        izdajnoId: q.data.izdajnoId,
        prijemnoId: q.data.prijemnoId,
        datum: q.data.datum.slice(0, 10),
        napomena: q.data.napomena,
        stavke: q.data.stavke.map((s) => ({
          articleId: s.articleId,
          ident: s.ident,
          naziv: s.naziv,
          kolicina: String(Number(s.kolicina)),
          serijskiBrojevi: s.serijskiBrojevi ?? [],
          napomena: s.napomena,
        })),
      }}
      onSubmit={async (body) => {
        await api(`/api/prenosi/${id}`, { method: "PUT", body });
        qc.invalidateQueries({ queryKey: ["prenosi"] });
        qc.invalidateQueries({ queryKey: ["prenos", id] });
      }}
      onBack={onBack}
    />
  );
}

function NoviPrenos({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  return (
    <PrenosForma
      naslov="Novi prenos"
      submitLabel="Sačuvaj"
      onSubmit={async (body) => {
        await api("/api/prenosi", { method: "POST", body });
        qc.invalidateQueries({ queryKey: ["prenosi"] });
        onDone();
      }}
      onBack={onDone}
    />
  );
}

// Zajednicka forma za novi prenos i izmenu (faza 15, RP2): unos stavki kroz
// ArtikalAutocomplete kao u prodajnim dokumentima, stanje iz IZDAJNOG skladista
function PrenosForma({
  naslov,
  submitLabel,
  initial,
  izvestaj,
  onSubmit,
  onBack,
}: {
  naslov: string;
  submitLabel: string;
  initial?: { izdajnoId: number; prijemnoId: number; datum: string; napomena: string; stavke: Stavka[] };
  // snimljen prenos: dugme Izveštaj otvara IzvestajPopup (faza 16, RP2)
  izvestaj?: { id: number; broj: string };
  onSubmit: (body: PrenosBody) => Promise<void>;
  onBack: () => void;
}) {
  const skladista = useQuery({ queryKey: ["skladista"], queryFn: () => api<Skladiste[]>("/api/skladista") });
  const [izdajnoId, setIzdajnoId] = useState(initial?.izdajnoId ?? 0);
  const [prijemnoId, setPrijemnoId] = useState(initial?.prijemnoId ?? 0);
  const [datum, setDatum] = useState(initial?.datum ?? new Date().toISOString().slice(0, 10));
  const [napomena, setNapomena] = useState(initial?.napomena ?? "");
  const [stavke, setStavke] = useState<Stavka[]>(initial?.stavke ?? []);
  const [serijskiIdx, setSerijskiIdx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");
  const [izvPopup, setIzvPopup] = useState(false);
  const [losiRedovi, setLosiRedovi] = useState<Set<number>>(new Set());

  // stanje u dropdown-u je stanje IZDAJNOG skladista
  const artikli = useQuery({
    queryKey: ["artikli-pretraga-prenos", izdajnoId],
    queryFn: () => api<ArtikalOpcija[]>(`/api/artikli-pretraga?skladisteId=${izdajnoId}`),
    enabled: izdajnoId > 0,
  });

  useEffect(() => {
    if (initial) return;
    const s = skladista.data ?? [];
    if (s.length && !izdajnoId) {
      setIzdajnoId(s.find((x) => x.isPrimary)?.id ?? s[0]!.id);
      setPrijemnoId(s.find((x) => !x.isPrimary)?.id ?? 0);
    }
  }, [skladista.data]);

  function setStavka(idx: number, delta: Partial<Stavka>) {
    setStavke(stavke.map((s, i) => (i === idx ? { ...s, ...delta } : s)));
  }

  function vodiSerijske(articleId: number): boolean | undefined {
    return (artikli.data ?? []).find((a) => a.id === articleId)?.serijskiBrojevi;
  }

  function dodajArtikal(id: number) {
    const a = (artikli.data ?? []).find((x) => x.id === id);
    if (a && !stavke.some((s) => s.articleId === a.id)) {
      setStavke([...stavke, { articleId: a.id, ident: a.ident, naziv: a.naziv, kolicina: "1", serijskiBrojevi: [], napomena: "" }]);
    }
  }

  // promena izdajnog: stanja u dropdown-u se osvezavaju (query key), a vec
  // izabrani serijski brojevi se brisu - moraju biti iz novog izdajnog
  function promeniIzdajno(id: number) {
    setIzdajnoId(id);
    setStavke((prev) => prev.map((s) => ({ ...s, serijskiBrojevi: [] })));
  }

  async function snimi() {
    setError("");
    setPoruka("");
    // artikal koji vodi serijske mora imati tacno kolicina izabranih brojeva
    const losi = new Set<number>();
    for (let i = 0; i < stavke.length; i++) {
      const s = stavke[i]!;
      if (vodiSerijske(s.articleId) && s.serijskiBrojevi.length !== Number(s.kolicina)) losi.add(i);
    }
    setLosiRedovi(losi);
    if (losi.size > 0) {
      setError("Izaberite serijske brojeve za označene stavke (tačno koliko je količina)");
      return;
    }
    try {
      await onSubmit({
        izdajnoId,
        prijemnoId,
        datum,
        napomena,
        stavke: stavke.map((s) => ({
          articleId: s.articleId,
          kolicina: Number(s.kolicina),
          serijskiBrojevi: s.serijskiBrojevi,
          napomena: s.napomena,
        })),
      });
      setPoruka("Sačuvano.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  const spremno =
    izdajnoId && prijemnoId && izdajnoId !== prijemnoId && stavke.length > 0 && stavke.every((s) => Number(s.kolicina) > 0);

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
        ← Nazad
      </button>
      <div className="page-head">
        <h1>{naslov}</h1>
        <div className="grow" />
        {error && <span className="login-error">{error}</span>}
        {poruka && <span style={{ fontSize: 12 }}>{poruka}</span>}
        {izvestaj && (
          <button className="btn" onClick={() => setIzvPopup(true)}>
            Izveštaj
          </button>
        )}
        <button className="btn primary" disabled={!spremno} onClick={snimi}>
          {submitLabel}
        </button>
      </div>
      {/* zaglavlje uokvireno kao sekcije DokumentView (faza 16, RP2) */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12, border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
        <label className="field">
          Izdajno skladište
          <select className="input" value={izdajnoId} onChange={(e) => promeniIzdajno(Number(e.target.value))}>
            {(skladista.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.naziv}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Prijemno skladište
          <select className="input" value={prijemnoId} onChange={(e) => setPrijemnoId(Number(e.target.value))}>
            <option value={0}>-</option>
            {(skladista.data ?? [])
              .filter((s) => s.id !== izdajnoId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.naziv}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Datum prenosa
          <input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Napomena
          <input className="input" value={napomena} onChange={(e) => setNapomena(e.target.value)} />
        </label>
      </div>

      <div className="tablewrap" style={{ marginBottom: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ minWidth: 110 }}>Ident</th>
              <th style={{ minWidth: 240 }}>Naziv</th>
              <th>Količina</th>
              <th>Serijski brojevi</th>
              <th>Napomena</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stavke.map((s, i) => (
              <tr key={i} style={losiRedovi.has(i) ? { background: "rgba(220,53,69,.12)" } : undefined}>
                <td>{s.ident}</td>
                <td>{s.naziv}</td>
                <td>
                  <input
                    className="input"
                    inputMode="decimal"
                    style={{ width: 80 }}
                    value={s.kolicina}
                    onChange={(e) => setStavka(i, { kolicina: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="btn"
                    disabled={vodiSerijske(s.articleId) === false}
                    style={vodiSerijske(s.articleId) === false ? { opacity: 0.5 } : undefined}
                    onClick={() => setSerijskiIdx(i)}
                  >
                    {s.serijskiBrojevi.length ? `${s.serijskiBrojevi.length} izabrano` : "Izaberi"}
                  </button>
                </td>
                <td>
                  <input className="input" value={s.napomena} onChange={(e) => setStavka(i, { napomena: e.target.value })} />
                </td>
                <td>
                  <button className="btn" style={{ padding: "0 6px" }} onClick={() => setStavke(stavke.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {/* prazan red za unos novog artikla - kao u prodajnim dokumentima */}
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
          </tbody>
        </table>
      </div>

      {izvPopup && izvestaj && (
        <IzvestajPopup
          docId={izvestaj.id}
          tip="prenos"
          broj={izvestaj.broj}
          kontaktEmail=""
          baza="/api/prenosi"
          onClose={() => setIzvPopup(false)}
        />
      )}

      {serijskiIdx !== null && stavke[serijskiIdx] && (
        <IzborSerijskih
          stavka={stavke[serijskiIdx]!}
          skladisteId={izdajnoId}
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

// Izbor serijskih brojeva iz izdajnog skladista, do kolicine stavke (brief 12.3)
function IzborSerijskih({
  stavka,
  skladisteId,
  onDone,
  onCancel,
}: {
  stavka: Stavka;
  skladisteId: number;
  onDone: (brojevi: string[]) => void;
  onCancel: () => void;
}) {
  const q = useQuery({
    queryKey: ["serijski", stavka.articleId, skladisteId],
    queryFn: () =>
      api<{ id: number; broj: string }[]>(`/api/artikli/${stavka.articleId}/serijski-brojevi?skladisteId=${skladisteId}`),
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
          {(q.data ?? []).length === 0 && <div className="subtle">Nema serijskih brojeva u izdajnom skladištu.</div>}
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
