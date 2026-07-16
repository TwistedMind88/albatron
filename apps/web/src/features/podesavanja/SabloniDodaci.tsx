import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { STAVKA_POLJA, type TabelaKolona } from "@albatron/shared";
import { api, apiFetch, fajlUrl, ApiError } from "../../api";
import { TIP_INFO } from "../dokumenti/common";

// Faza 15 RP5: sekcije "Tabele stavki" ({stavke_tabela:naziv}) i "Slike" ({slika:naziv}) u Sabloni tabu

export interface TabelaDef {
  id: number;
  naziv: string;
  docType: string | null;
  kolone: TabelaKolona[];
}

const PRAZNA_KOLONA: TabelaKolona = { polje: "ident", naslov: "", poravnanje: "left", sirina: "" };

export function TabeleStavki() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["sabloni-tabele"], queryFn: () => api<TabelaDef[]>("/api/sabloni-tabele") });
  const lista = query.data ?? [];

  const [aktivni, setAktivni] = useState<number | "nova" | null>(null);
  const [naziv, setNaziv] = useState("");
  const [docType, setDocType] = useState("");
  const [kolone, setKolone] = useState<TabelaKolona[]>([]);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");

  function otvori(d: TabelaDef | null) {
    setAktivni(d ? d.id : "nova");
    setNaziv(d?.naziv ?? "");
    setDocType(d?.docType ?? "");
    setKolone(d ? d.kolone.map((k) => ({ ...k })) : [{ ...PRAZNA_KOLONA }]);
    setError("");
    setPoruka("");
  }

  function setKolona(i: number, izmena: Partial<TabelaKolona>) {
    setKolone((ks) => ks.map((k, j) => (j === i ? { ...k, ...izmena } : k)));
  }
  function pomeri(i: number, smer: -1 | 1) {
    setKolone((ks) => {
      const j = i + smer;
      if (j < 0 || j >= ks.length) return ks;
      const novi = [...ks];
      [novi[i], novi[j]] = [novi[j]!, novi[i]!];
      return novi;
    });
  }

  async function radnja(fn: () => Promise<unknown>, uspesno: string) {
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["sabloni-tabele"] });
      setPoruka(uspesno);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  async function sacuvaj() {
    const body = { naziv, docType: docType || null, kolone };
    await radnja(async () => {
      if (aktivni === "nova") {
        const created = await api<TabelaDef>("/api/sabloni-tabele", { method: "POST", body });
        setAktivni(created.id);
      } else {
        await api(`/api/sabloni-tabele/${aktivni}`, { method: "PUT", body });
      }
    }, "Sačuvano");
  }

  async function obrisi() {
    if (aktivni === "nova" || aktivni === null) return;
    setError("");
    try {
      await api(`/api/sabloni-tabele/${aktivni}`, { method: "DELETE" });
    } catch (e) {
      // 409: definiciju koriste sabloni - potvrda pa force
      if (e instanceof ApiError && e.status === 409) {
        if (!window.confirm(`${e.message}\n\nObrisati svejedno? Placeholder u šablonima ostaje neispunjen.`)) return;
        try {
          await api(`/api/sabloni-tabele/${aktivni}?force=true`, { method: "DELETE" });
        } catch (e2) {
          setError(e2 instanceof ApiError ? e2.message : "Greška");
          return;
        }
      } else {
        setError(e instanceof ApiError ? e.message : "Greška");
        return;
      }
    }
    setAktivni(null);
    await qc.invalidateQueries({ queryKey: ["sabloni-tabele"] });
  }

  const labelPolja = new Map(STAVKA_POLJA.map((p) => [p.key, p.label]));
  // ponuda kolona zavisi od izabranog tipa dokumenta; bez tipa se nude sve
  const polja = STAVKA_POLJA.filter((p) => !docType || !p.tipovi || p.tipovi.includes(docType));

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Tabele stavki</h2>
      <p className="subtle" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
        Imenovana definicija tabele se u šablonu koristi kao {"{stavke_tabela:naziv}"} (opcione stavke: {"{opcioni_tabela:naziv}"}).
      </p>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {lista.map((d) => (
            <div
              key={d.id}
              onClick={() => otvori(d)}
              style={{
                padding: "5px 8px",
                cursor: "pointer",
                borderRadius: "var(--radius)",
                fontSize: 12.5,
                fontFamily: "monospace",
                background: d.id === aktivni ? "var(--accent-soft)" : undefined,
              }}
            >
              {d.naziv} {d.docType && <span className="subtle">({TIP_INFO[d.docType]?.label ?? d.docType})</span>}
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={() => otvori(null)}>
            + Nova definicija
          </button>
        </div>

        {aktivni !== null && (
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ width: 200, fontFamily: "monospace" }}
                placeholder="naziv (mala slova, cifre, _)"
                value={naziv}
                onChange={(e) => setNaziv(e.target.value)}
              />
              <select className="input" style={{ width: 180 }} value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="">Svi tipovi dokumenata</option>
                {Object.entries(TIP_INFO).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button className="btn primary" onClick={sacuvaj}>
                Sačuvaj
              </button>
              {aktivni !== "nova" && (
                <button className="btn" onClick={obrisi}>
                  Obriši
                </button>
              )}
            </div>
            {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
            {poruka && <p style={{ fontSize: 12, margin: "0 0 8px" }}>{poruka}</p>}

            {kolone.map((k, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                <select className="input" style={{ width: 170 }} value={k.polje} onChange={(e) => setKolona(i, { polje: e.target.value })}>
                  {polja.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                  {/* postojeca kolona van tipa ostaje vidljiva dok je korisnik ne promeni */}
                  {!polja.some((p) => p.key === k.polje) && (
                    <option value={k.polje}>{labelPolja.get(k.polje) ?? k.polje}</option>
                  )}
                </select>
                <input
                  className="input"
                  style={{ width: 160 }}
                  placeholder="Naslov kolone"
                  value={k.naslov}
                  onChange={(e) => setKolona(i, { naslov: e.target.value })}
                />
                <select
                  className="input"
                  style={{ width: 90 }}
                  value={k.poravnanje}
                  onChange={(e) => setKolona(i, { poravnanje: e.target.value as TabelaKolona["poravnanje"] })}
                >
                  <option value="left">Levo</option>
                  <option value="center">Centar</option>
                  <option value="right">Desno</option>
                </select>
                <input
                  className="input"
                  style={{ width: 80 }}
                  placeholder="Širina"
                  title="npr. 12% ili 80px, prazno = auto"
                  value={k.sirina}
                  onChange={(e) => setKolona(i, { sirina: e.target.value })}
                />
                <button className="btn" style={{ padding: "0 6px" }} disabled={i === 0} onClick={() => pomeri(i, -1)}>
                  ↑
                </button>
                <button className="btn" style={{ padding: "0 6px" }} disabled={i === kolone.length - 1} onClick={() => pomeri(i, 1)}>
                  ↓
                </button>
                <button
                  className="btn"
                  style={{ padding: "0 6px" }}
                  disabled={kolone.length === 1}
                  onClick={() => setKolone((ks) => ks.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button className="btn" style={{ marginTop: 4 }} onClick={() => setKolone((ks) => [...ks, { ...PRAZNA_KOLONA }])}>
              + Kolona
            </button>

            {/* ponytail: preview samo zaglavlja (klijentski); pun preview sa podacima ide kroz Pregled sablona */}
            <div style={{ marginTop: 12 }}>
              <div className="subtle" style={{ fontSize: 11, marginBottom: 4 }}>Pregled kolona:</div>
              <table border={1} cellSpacing={0} cellPadding={4} style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    {kolone.map((k, i) => (
                      <th key={i} style={{ textAlign: k.poravnanje, width: k.sirina || undefined, background: "var(--accent-soft)" }}>
                        {k.naslov || labelPolja.get(k.polje) || k.polje}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface SablonSlika {
  id: number;
  naziv: string;
  filename: string;
  mime: string;
}

export function SabloniSlike() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["sabloni-slike"], queryFn: () => api<SablonSlika[]>("/api/sabloni-slike") });
  const lista = query.data ?? [];

  const [naziv, setNaziv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");

  async function upload() {
    setError("");
    setPoruka("");
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Izaberite fajl");
    if (file.size > 500 * 1024 && !window.confirm("Fajl je veći od 500 KB - povećava veličinu maila. Nastaviti?")) return;
    const fd = new FormData();
    fd.append("naziv", naziv.trim());
    fd.append("fajl", file);
    try {
      const res = await apiFetch("/api/sabloni-slike", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Greška pri upload-u");
      }
      setNaziv("");
      if (fileRef.current) fileRef.current.value = "";
      setPoruka("Slika dodata");
      await qc.invalidateQueries({ queryKey: ["sabloni-slike"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Greška");
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Slike</h2>
      <p className="subtle" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
        Slika se u šablon ubacuje unutar src atributa: {'<img src="{slika:naziv}" style="height:60px">'}. PNG, JPG, SVG ili WebP, do 2 MB.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 200, fontFamily: "monospace" }}
          placeholder="naziv (mala slova, cifre, _)"
          value={naziv}
          onChange={(e) => setNaziv(e.target.value)}
        />
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" style={{ fontSize: 12 }} />
        <button className="btn primary" onClick={upload}>
          Dodaj sliku
        </button>
      </div>
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      {poruka && <p style={{ fontSize: 12, margin: "0 0 8px" }}>{poruka}</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {lista.map((s) => (
          <div key={s.id} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 8, width: 180 }}>
            <img
              src={fajlUrl(`/api/sabloni-slike/${s.id}/fajl`)}
              alt={s.naziv}
              style={{ width: "100%", height: 80, objectFit: "contain", background: "#fff" }}
            />
            <div style={{ fontFamily: "monospace", fontSize: 12, margin: "6px 0 2px" }}>{s.naziv}</div>
            <div className="subtle" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.filename}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="btn"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={() => navigator.clipboard.writeText(`{slika:${s.naziv}}`)}
              >
                Kopiraj placeholder
              </button>
              <button
                className="btn"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={async () => {
                  if (!window.confirm(`Obrisati sliku "${s.naziv}"?`)) return;
                  try {
                    await api(`/api/sabloni-slike/${s.id}`, { method: "DELETE" });
                    await qc.invalidateQueries({ queryKey: ["sabloni-slike"] });
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : "Greška");
                  }
                }}
              >
                Obriši
              </button>
            </div>
          </div>
        ))}
        {!lista.length && <p className="subtle" style={{ fontSize: 12 }}>Nema slika.</p>}
      </div>
    </div>
  );
}
