import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Autocomplete, type AutocompleteOption } from "../../components/Autocomplete";

// Popup pretraga artikala za unos u dokument (brief 7.5)

export interface PretragaRezultat {
  id: number;
  ident: string;
  tip: string;
  naziv: string;
  sku: string;
  prodajnaCena: string | null;
  prodajnaValuta: string;
}

interface Kategorija {
  id: number;
  name: string;
}

function TxtFilter({
  label,
  value,
  mode,
  onValue,
  onMode,
}: {
  label: string;
  value: string;
  mode: string;
  onValue: (v: string) => void;
  onMode: (m: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ width: 110, fontSize: 12 }}>{label}</span>
      <select className="input" style={{ width: 45 }} value={mode} onChange={(e) => onMode(e.target.value)}>
        <option value="%">%</option>
        <option value="=">=</option>
      </select>
      <input className="input" style={{ flex: 1 }} value={value} onChange={(e) => onValue(e.target.value)} />
    </div>
  );
}

export function PretragaPopup({
  onPick,
  onClose,
}: {
  onPick: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [naziv, setNaziv] = useState("");
  const [nazivMode, setNazivMode] = useState("%");
  const [ident, setIdent] = useState("");
  const [identMode, setIdentMode] = useState("%");
  const [sifra, setSifra] = useState("");
  const [sifraMode, setSifraMode] = useState("%");
  const [dobavljac, setDobavljac] = useState<AutocompleteOption | null>(null);
  const [glavnaKat, setGlavnaKat] = useState("");
  const [sekKat, setSekKat] = useState("");
  const [tipArt, setTipArt] = useState("");
  // atributi: popunjavanjem jednog otvara se sledece polje (brief 7.5)
  const [atributi, setAtributi] = useState<string[]>([""]);
  // tag parametri: potvrdjen unos se zakljucava kao tag (brief 7.5)
  const [tagovi, setTagovi] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [rezultati, setRezultati] = useState<PretragaRezultat[] | null>(null);
  const [izabrani, setIzabrani] = useState<Set<number>>(new Set());

  const dobavljaci = useQuery({
    queryKey: ["subjekti", "dobavljac"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/subjekti?uloga=dobavljac"),
  });
  const kategorije = useQuery({
    queryKey: ["kategorije"],
    queryFn: () => api<Kategorija[]>("/api/kategorije"),
  });

  async function pretrazi() {
    const p = new URLSearchParams();
    if (naziv) {
      p.set("naziv", naziv);
      p.set("nazivMode", nazivMode);
    }
    if (ident) {
      p.set("ident", ident);
      p.set("identMode", identMode);
    }
    if (sifra) {
      p.set("sifra", sifra);
      p.set("sifraMode", sifraMode);
    }
    if (dobavljac) p.set("dobavljacId", String(dobavljac.id));
    if (glavnaKat) p.set("glavnaKategorijaId", glavnaKat);
    if (sekKat) p.set("sekundarnaKategorijaId", sekKat);
    if (tipArt) p.set("tip", tipArt);
    const atr = atributi.filter((a) => a.trim());
    if (atr.length) p.set("atributi", atr.join(","));
    if (tagovi.length) p.set("tagovi", tagovi.join(","));
    setRezultati(await api<PretragaRezultat[]>(`/api/artikli-pretraga?${p.toString()}`));
    setIzabrani(new Set());
  }

  function setAtribut(i: number, v: string) {
    const next = [...atributi];
    next[i] = v;
    // popunjeno poslednje polje otvara novo
    if (i === next.length - 1 && v.trim()) next.push("");
    setAtributi(next);
  }

  function toggleRezultat(id: number) {
    const next = new Set(izabrani);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIzabrani(next);
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 760, maxHeight: "85vh", overflowY: "auto" }}>
        <h2>Pretraga artikala</h2>
        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <TxtFilter label="Naziv" value={naziv} mode={nazivMode} onValue={setNaziv} onMode={setNazivMode} />
            <TxtFilter label="Ident" value={ident} mode={identMode} onValue={setIdent} onMode={setIdentMode} />
            <TxtFilter label="Dobavljačeva šifra" value={sifra} mode={sifraMode} onValue={setSifra} onMode={setSifraMode} />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ width: 110, fontSize: 12 }}>Dobavljač</span>
              <div style={{ flex: 1 }}>
                <Autocomplete
                  options={(dobavljaci.data ?? []).map((d) => ({ id: d.id, label: d.naziv }))}
                  value={dobavljac}
                  onChange={setDobavljac}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ width: 110, fontSize: 12 }}>Kategorija</span>
              <select className="input" style={{ flex: 1 }} value={glavnaKat} onChange={(e) => setGlavnaKat(e.target.value)}>
                <option value="">- glavna -</option>
                {(kategorije.data ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              <select className="input" style={{ flex: 1 }} value={sekKat} onChange={(e) => setSekKat(e.target.value)}>
                <option value="">- sekundarna -</option>
                {(kategorije.data ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              <select className="input" style={{ width: 110 }} value={tipArt} onChange={(e) => setTipArt(e.target.value)}>
                <option value="">- tip -</option>
                <option value="obican">Običan</option>
                <option value="parent">Parent</option>
                <option value="varijacija">Varijacija</option>
              </select>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Atributi (filteri):</span>
            {atributi.map((a, i) => (
              <input
                key={i}
                className="input"
                value={a}
                placeholder={`atribut ${i + 1}`}
                onChange={(e) => setAtribut(i, e.target.value)}
              />
            ))}
            <span style={{ fontSize: 12 }}>Parametri (tagovi):</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {tagovi.map((t) => (
                <span
                  key={t}
                  style={{ border: "1px solid var(--ink-2)", borderRadius: 4, padding: "1px 6px", fontSize: 12 }}
                >
                  {t}{" "}
                  <span style={{ cursor: "pointer" }} onClick={() => setTagovi(tagovi.filter((x) => x !== t))}>
                    x
                  </span>
                </span>
              ))}
              <input
                className="input"
                style={{ width: 120 }}
                value={tagDraft}
                placeholder="kucaj + Enter"
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagDraft.trim()) {
                    setTagovi([...tagovi, tagDraft.trim()]);
                    setTagDraft("");
                  }
                }}
              />
            </div>
          </div>
        </div>
        <button className="btn primary" onClick={pretrazi} style={{ marginBottom: 10 }}>
          Pretraži
        </button>
        {rezultati && (
          <div className="tablewrap" style={{ maxHeight: 300, overflowY: "auto", marginBottom: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>Ident</th>
                  <th>Naziv</th>
                  <th>Šifra</th>
                  <th>Cena</th>
                </tr>
              </thead>
              <tbody>
                {rezultati.map((r) => (
                  <tr key={r.id} onDoubleClick={() => onPick([r.id])} style={{ cursor: "pointer" }}>
                    <td>
                      <input type="checkbox" checked={izabrani.has(r.id)} onChange={() => toggleRezultat(r.id)} />
                    </td>
                    <td>{r.ident}</td>
                    <td>{r.naziv}</td>
                    <td>{r.sku}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.prodajnaCena !== null ? `${Number(r.prodajnaCena).toLocaleString("sr-RS")} ${r.prodajnaValuta}` : ""}
                    </td>
                  </tr>
                ))}
                {rezultati.length === 0 && (
                  <tr>
                    <td colSpan={5}>Nema rezultata.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={izabrani.size === 0} onClick={() => onPick([...izabrani])}>
            Dodaj izabrane ({izabrani.size})
          </button>
          <button className="btn" onClick={onClose}>
            Zatvori
          </button>
        </div>
      </div>
    </div>
  );
}
