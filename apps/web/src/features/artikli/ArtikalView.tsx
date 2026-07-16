import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { procenjenaNabavna, zarada } from "@albatron/shared";
import { api, ApiError } from "../../api";
import { Autocomplete } from "../../components/Autocomplete";
import { ArtikalAutocomplete } from "../../components/ArtikalAutocomplete";
import { TarifaAutocomplete } from "../../components/TarifaAutocomplete";
import { ZemljaAutocomplete } from "../../components/ZemljaAutocomplete";
import type { Artikal } from "./ArtikliPage";
import type { Lookup } from "../podesavanja/Liste";
import type { Subjekat } from "../subjekti/SubjektiPage";
import { PovezaniPopup } from "./PovezaniPopup";
import { FajloviSekcija, type ArtikalFajl } from "./FajloviSekcija";
import { ZaliheTab } from "./ZaliheTab";
import { SerijskiFlagPopup } from "./SerijskiFlagPopup";
import { DokumentacijaTab } from "../../components/DokumentacijaTab";
import { NumInput } from "../../components/NumInput";
import Toggle from "../../components/Toggle";

interface Kategorija {
  id: number;
  parentId: number | null;
  code: string | null;
  name: string;
}

const katLabel = (k: Kategorija) => (k.code ? `${k.code} - ${k.name}` : k.name);

export interface ArtikalForm {
  tip: string;
  parentId: number | null;
  naziv: string;
  opis: string;
  napomena: string;
  dobavljacId: number | null;
  sku: string;
  prodajnaCena: number | null;
  prodajnaValuta: string;
  kurs: number | null;
  marza: number | null;
  dobavljacevaCena: number | null;
  dobavljacevaValuta: string;
  ocekivaniPopust: number | null;
  carinskaStopa: number | null;
  sertifikacijaStopa: number | null;
  dodatniTroskoviStopa: number | null;
  zemljaPorekla: string;
  carinskaTarifa: string;
  porezId: number | null;
  glavnaKategorijaId: number | null;
  sekundarnaKategorijaId: number | null;
  active: boolean;
  discontinued: boolean;
  akcijaProcenat: number | null;
  akcijaOd: string | null;
  akcijaDo: string | null;
  akcijaNeograniceno: boolean;
  serijskiBrojevi: boolean;
}

export const PRAZAN_ARTIKAL: ArtikalForm = {
  tip: "obican",
  parentId: null,
  naziv: "",
  opis: "",
  napomena: "",
  dobavljacId: null,
  sku: "",
  prodajnaCena: null,
  prodajnaValuta: "RSD",
  kurs: null,
  marza: null,
  dobavljacevaCena: null,
  dobavljacevaValuta: "RSD",
  ocekivaniPopust: null,
  carinskaStopa: null,
  sertifikacijaStopa: null,
  dodatniTroskoviStopa: null,
  zemljaPorekla: "",
  carinskaTarifa: "",
  porezId: null,
  glavnaKategorijaId: null,
  sekundarnaKategorijaId: null,
  active: true,
  discontinued: false,
  akcijaProcenat: null,
  akcijaOd: null,
  akcijaDo: null,
  akcijaNeograniceno: false,
  serijskiBrojevi: false,
};

function fromApi(a: Artikal): ArtikalForm {
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    ...a,
    prodajnaCena: n(a.prodajnaCena),
    kurs: n(a.kurs),
    marza: n(a.marza),
    dobavljacevaCena: n(a.dobavljacevaCena),
    ocekivaniPopust: n(a.ocekivaniPopust),
    carinskaStopa: n(a.carinskaStopa),
    sertifikacijaStopa: n(a.sertifikacijaStopa),
    dodatniTroskoviStopa: n(a.dodatniTroskoviStopa),
    akcijaProcenat: n(a.akcijaProcenat),
    akcijaOd: a.akcijaOd ? a.akcijaOd.slice(0, 10) : null,
    akcijaDo: a.akcijaDo ? a.akcijaDo.slice(0, 10) : null,
  };
}

export function ArtikalView({
  id,
  onBack,
  onOpen,
}: {
  id: number | null;
  onBack: () => void;
  onOpen: (id: number) => void;
}) {
  const [tab, setTab] = useState<"podaci" | "zalihe" | "dokumentacija" | "istorija">("podaci");
  const [savedId, setSavedId] = useState(id);
  const [a, setA] = useState<ArtikalForm>(PRAZAN_ARTIKAL);
  const [ident, setIdent] = useState("");
  const [atributi, setAtributi] = useState<string[]>([]);
  const [povezani, setPovezani] = useState<{ relatedId: number; naziv: string; ident: string }[]>([]);
  const [varijacije, setVarijacije] = useState<Artikal[]>([]);
  const [fajlovi, setFajlovi] = useState<ArtikalFajl[]>([]);
  const [noveVarijacije, setNoveVarijacije] = useState<ArtikalForm[]>([]); // za novi parent
  const [showPovezani, setShowPovezani] = useState(false);
  const [showAkcije, setShowAkcije] = useState(false);
  const [showNovaVar, setShowNovaVar] = useState(false);
  const [serijskiFlag, setSerijskiFlag] = useState<boolean | null>(null); // ciljna vrednost flaga (RP3)
  const [parentNaziv, setParentNaziv] = useState(""); // izabrani parent za novu varijaciju (RP7.4)
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const liste = useQuery({ queryKey: ["liste"], queryFn: () => api<Lookup[]>("/api/liste") });
  const porezi = (liste.data ?? []).filter((l) => l.kind === "porez" && l.active);
  const carinskeTarife = (liste.data ?? []).filter((l) => l.kind === "carinska_tarifa" && l.active);
  const kategorije = useQuery({ queryKey: ["kategorije"], queryFn: () => api<Kategorija[]>("/api/kategorije") });
  const dobavljaci = useQuery({
    queryKey: ["subjekti", "dobavljac"],
    queryFn: () => api<Subjekat[]>("/api/subjekti?uloga=dobavljac"),
  });
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<{ zalihe: boolean }>("/api/moduli") });
  // parent artikli za izbor pri kreiranju varijacije (RP7.4)
  const sviArtikli = useQuery({
    queryKey: ["artikli"],
    queryFn: () => api<Artikal[]>("/api/artikli"),
    enabled: a.tip === "varijacija" && savedId === null,
  });
  const parenti = (sviArtikli.data ?? [])
    .filter((x) => x.tip === "parent")
    .map((x) => ({ id: x.id, ident: x.ident, naziv: x.naziv }));

  // izbor parenta prepisuje nasledjena polja kao NovaVarijacijaPopup, uz potvrdu
  // ako je korisnik vec uneo vrednosti (RP7.4)
  async function izaberiParenta(pid: number) {
    const imaUnos = a.naziv || a.sku || a.prodajnaCena !== null || a.dobavljacevaCena !== null;
    if (imaUnos && !window.confirm("Preuzeti podatke sa parent artikla? Nasleđena polja će biti prepisana.")) return;
    const p = await api<Artikal>(`/api/artikli/${pid}`);
    setA((prev) => ({
      ...fromApi(p),
      tip: "varijacija",
      parentId: pid,
      // naziv, SKU i cene se ne nasledjuju (kao NovaVarijacijaPopup)
      naziv: prev.naziv,
      sku: prev.sku,
      prodajnaCena: prev.prodajnaCena,
      dobavljacevaCena: prev.dobavljacevaCena,
    }));
    setParentNaziv(p.naziv);
  }

  async function reload(aid: number) {
    const data = await api<Artikal & { atributi: { value: string }[]; povezani: typeof povezani; varijacije: Artikal[]; fajlovi: ArtikalFajl[] }>(`/api/artikli/${aid}`);
    setA(fromApi(data));
    setIdent(data.ident);
    setAtributi(data.atributi.map((x) => x.value));
    setPovezani(data.povezani);
    setVarijacije(data.varijacije);
    setFajlovi(data.fajlovi);
  }

  useEffect(() => {
    if (savedId !== null) reload(savedId);
  }, [savedId]);

  function set<K extends keyof ArtikalForm>(key: K, value: ArtikalForm[K]) {
    let next = { ...a, [key]: value };
    // marza se preracunava od dobavljaceve cene uvecane za troskove
    // (carina, sertifikacija, dodatni troskovi - faza 14.2, ispravka briefa 5.1)
    const osnovMarze = (f: ArtikalForm) => {
      if (f.dobavljacevaCena === null) return null;
      let osnov =
        f.dobavljacevaCena *
        (1 + ((f.carinskaStopa ?? 0) + (f.sertifikacijaStopa ?? 0) + (f.dodatniTroskoviStopa ?? 0)) / 100);
      if (f.dobavljacevaValuta !== f.prodajnaValuta && f.kurs) osnov *= f.kurs;
      return osnov;
    };
    if (key === "marza" && value !== null) {
      const osnov = osnovMarze(next);
      if (osnov !== null) next.prodajnaCena = Math.round(osnov * (1 + Number(value) / 100) * 100) / 100;
    }
    if (key === "prodajnaCena") {
      const osnov = osnovMarze(next);
      next.marza =
        value !== null && osnov !== null && osnov !== 0
          ? Math.round(((Number(value) - osnov) / osnov) * 10000) / 100
          : null;
    }
    // valuta dobavljaca se automatski popunjava iz podataka dobavljaca (brief 5.1)
    if (key === "dobavljacId" && value !== null) {
      const d = (dobavljaci.data ?? []).find((s) => s.id === value);
      if (d) next.dobavljacevaValuta = d.valuta;
    }
    setA(next);
  }

  async function save() {
    setError("");
    if (savedId === null && a.tip === "varijacija" && a.parentId === null) {
      setError("Varijacija mora imati izabran parent artikal");
      return;
    }
    try {
      if (savedId === null) {
        const body: Record<string, unknown> = { ...a };
        if (a.tip === "parent") body.varijacije = noveVarijacije;
        const created = await api<{ id: number }>("/api/artikli", { method: "POST", body });
        setSavedId(created.id);
      } else {
        await api(`/api/artikli/${savedId}`, { method: "PUT", body: a });
        await api(`/api/artikli/${savedId}/atributi`, { method: "PUT", body: { atributi } });
        await reload(savedId);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  const nabavna = procenjenaNabavna(a);
  const z = zarada(a.prodajnaCena, nabavna);
  const jeParent = a.tip === "parent";
  const glavneKategorije = (kategorije.data ?? []).filter((k) => k.parentId === null);
  // sekundarna filtrirana po glavnoj (brief 5.3): svi potomci izabrane glavne
  function potomci(id: number): Kategorija[] {
    const direktni = (kategorije.data ?? []).filter((k) => k.parentId === id);
    return [...direktni, ...direktni.flatMap((d) => potomci(d.id))];
  }
  const sekundarne = a.glavnaKategorijaId ? potomci(a.glavnaKategorijaId) : [];

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
        ← Nazad na listu
      </button>
      <div className="page-head">
        <h1>
          {savedId === null ? "Novi artikal" : `${ident} - ${a.naziv}`}
          {!a.active && <span style={{ color: "var(--danger)", fontSize: 12, marginLeft: 8 }}>NEAKTIVAN</span>}
        </h1>
        <div className="grow" />
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
        {error && <span className="login-error">{error}</span>}
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(moduli.data?.zalihe
          ? (["podaci", "zalihe", "dokumentacija", "istorija"] as const)
          : (["podaci", "dokumentacija", "istorija"] as const)
        ).map((t) => (
          <button key={t} className={`btn${tab === t ? " primary" : ""}`} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "podaci" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* osnovni podaci i finansije jedno pored drugog (brief 5.7) */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div className="card" style={{ flex: 1, minWidth: 340, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontSize: 13, margin: 0, color: "var(--ink-2)" }}>OSNOVNI PODACI</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ width: 120 }}>
                  Tip
                  <select
                    className="input"
                    value={a.tip}
                    disabled={savedId !== null}
                    onChange={(e) => {
                      // promena tipa sa varijacije cisti parentId (RP7.4)
                      const tip = e.target.value;
                      setA((prev) => ({ ...prev, tip, parentId: tip === "varijacija" ? prev.parentId : null }));
                      if (tip !== "varijacija") setParentNaziv("");
                    }}
                  >
                    <option value="obican">Običan</option>
                    <option value="parent">Parent</option>
                    <option value="varijacija">Varijacija</option>
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Naziv *
                  <input className="input" value={a.naziv} onChange={(e) => set("naziv", e.target.value)} />
                </label>
              </div>
              {a.tip === "varijacija" && savedId === null && (
                <label className="field">
                  Parent artikal *{parentNaziv ? ` (izabran: ${parentNaziv})` : ""}
                  <ArtikalAutocomplete
                    artikli={parenti}
                    polje="naziv"
                    placeholder="kucaj naziv parent artikla..."
                    onIzbor={(pid) => void izaberiParenta(pid)}
                  />
                </label>
              )}
              <label className="field">
                Opis
                <textarea
                  className="input"
                  rows={2}
                  value={a.opis}
                  onChange={(e) => set("opis", e.target.value)}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  Glavna kategorija
                  <Autocomplete
                    options={glavneKategorije.map((k) => ({ id: k.id, label: katLabel(k) }))}
                    value={
                      a.glavnaKategorijaId !== null
                        ? {
                            id: a.glavnaKategorijaId,
                            label: (() => {
                              const k = (kategorije.data ?? []).find((x) => x.id === a.glavnaKategorijaId);
                              return k ? katLabel(k) : "";
                            })(),
                          }
                        : null
                    }
                    onChange={(o) => set("glavnaKategorijaId", o ? Number(o.id) : null)}
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Sekundarna (krajnja)
                  <Autocomplete
                    options={sekundarne.map((k) => ({ id: k.id, label: katLabel(k) }))}
                    value={
                      a.sekundarnaKategorijaId !== null
                        ? {
                            id: a.sekundarnaKategorijaId,
                            label: (() => {
                              const k = (kategorije.data ?? []).find((x) => x.id === a.sekundarnaKategorijaId);
                              return k ? katLabel(k) : "";
                            })(),
                          }
                        : null
                    }
                    onChange={(o) => set("sekundarnaKategorijaId", o ? Number(o.id) : null)}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  Dobavljač {jeParent ? "" : "*"}
                  <Autocomplete
                    options={(dobavljaci.data ?? []).filter((d) => d.active).map((d) => ({ id: d.id, label: d.naziv }))}
                    value={
                      a.dobavljacId !== null
                        ? { id: a.dobavljacId, label: (dobavljaci.data ?? []).find((d) => d.id === a.dobavljacId)?.naziv ?? "" }
                        : null
                    }
                    onChange={(opt) => set("dobavljacId", opt === null ? null : Number(opt.id))}
                  />
                </label>
                {!jeParent && (
                  <label className="field" style={{ width: 140 }}>
                    SKU *
                    <input className="input" value={a.sku} onChange={(e) => set("sku", e.target.value)} />
                  </label>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  Zemlja porekla
                  {/* fiksna lista zemalja predlaze, slobodan unos ostaje (RP7.2) */}
                  <ZemljaAutocomplete value={a.zemljaPorekla} onChange={(v) => set("zemljaPorekla", v)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Carinska tarifa
                  {/* izbor iz sifarnika popunjava i procenat carine (RP7.3) */}
                  <TarifaAutocomplete
                    value={a.carinskaTarifa}
                    tarife={carinskeTarife}
                    onCommit={(sifra, stopa) =>
                      setA((prev) => ({ ...prev, carinskaTarifa: sifra, ...(stopa !== undefined ? { carinskaStopa: stopa } : {}) }))
                    }
                  />
                </label>
              </div>
              <label className="field">
                Napomena
                <textarea className="input" rows={2} value={a.napomena} onChange={(e) => set("napomena", e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 16, fontSize: 12.5 }}>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <Toggle checked={a.active} onChange={(v) => set("active", v)} />
                  Aktivan
                </label>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <Toggle checked={a.discontinued} onChange={(v) => set("discontinued", v)} />
                  Discontinued
                </label>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <Toggle
                    checked={a.serijskiBrojevi}
                    onChange={(v) => {
                      // snimljen artikal: promena ide kroz posebnu rutu sa potvrdom (faza 15, RP3)
                      if (savedId === null) set("serijskiBrojevi", v);
                      else setSerijskiFlag(v);
                    }}
                  />
                  Vođenje serijskih brojeva
                </label>
              </div>
            </div>

            {!jeParent && (
              <div className="card" style={{ flex: 1, minWidth: 380, display: "flex", flexDirection: "column", gap: 8 }}>
                <h2 style={{ fontSize: 13, margin: 0, color: "var(--ink-2)" }}>FINANSIJE</h2>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <label className="field">
                    Dobavljačeva cena *
                    <NumInput value={a.dobavljacevaCena} onChange={(v) => set("dobavljacevaCena", v)} />
                  </label>
                  <button
                    className="btn"
                    title="Pronađi najnoviju cenu iz cenovnika dobavljača po SKU"
                    disabled={a.dobavljacId === null || !a.sku}
                    onClick={async () => {
                      const res = await api<{ cena: string | null; valuta: string } | null>(
                        `/api/cenovnici-cena?dobavljacId=${a.dobavljacId}&sku=${encodeURIComponent(a.sku)}`,
                      );
                      if (res?.cena !== null && res?.cena !== undefined) {
                        setA((prev) => ({ ...prev, dobavljacevaCena: Number(res.cena), dobavljacevaValuta: res.valuta }));
                      }
                    }}
                  >
                    Pronađi cenu
                  </button>
                  <label className="field" style={{ width: 80 }}>
                    Valuta
                    <select className="input" value={a.dobavljacevaValuta} onChange={(e) => set("dobavljacevaValuta", e.target.value)}>
                      {["RSD", "EUR", "USD"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Očekivani popust %
                    <NumInput value={a.ocekivaniPopust} onChange={(v) => set("ocekivaniPopust", v)} width={90} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <label className="field">
                    Prodajna cena *
                    <NumInput value={a.prodajnaCena} onChange={(v) => set("prodajnaCena", v)} />
                  </label>
                  <label className="field" style={{ width: 80 }}>
                    Valuta
                    <select className="input" value={a.prodajnaValuta} onChange={(e) => set("prodajnaValuta", e.target.value)}>
                      {["RSD", "EUR", "USD"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ width: 90 }}>
                    Kurs
                    <NumInput value={a.kurs} onChange={(v) => set("kurs", v)} width={90} />
                  </label>
                  <label className="field" style={{ width: 90 }}>
                    Marža %
                    <NumInput value={a.marza} onChange={(v) => set("marza", v)} width={90} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <label className="field">
                    Carina %
                    <NumInput value={a.carinskaStopa} onChange={(v) => set("carinskaStopa", v)} width={90} />
                  </label>
                  <label className="field">
                    Sertifikacija %
                    <NumInput value={a.sertifikacijaStopa} onChange={(v) => set("sertifikacijaStopa", v)} width={90} />
                  </label>
                  <label className="field">
                    Dodatni troškovi %
                    <NumInput value={a.dodatniTroskoviStopa} onChange={(v) => set("dodatniTroskoviStopa", v)} width={90} />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Porez
                    <select
                      className="input"
                      value={a.porezId ?? ""}
                      onChange={(e) => set("porezId", e.target.value === "" ? null : Number(e.target.value))}
                    >
                      <option value="">-</option>
                      {porezi.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.internalValue}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ fontSize: 12.5, background: "var(--accent-soft)", borderRadius: "var(--radius)", padding: "8px 10px" }}>
                  Procenjena nabavna: <b>{nabavna !== null ? `${nabavna.toLocaleString("sr-RS")} ${a.prodajnaValuta}` : "-"}</b>
                  {z && (
                    <span style={{ marginLeft: 12 }}>
                      Zarada: <b style={{ color: z.iznos >= 0 ? "var(--ok)" : "var(--danger)" }}>
                        {z.iznos.toLocaleString("sr-RS")} {a.prodajnaValuta}
                        {z.procenat !== null ? ` (${z.procenat}%)` : ""}
                      </b>
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <label className="field">
                    Akcija %
                    <NumInput value={a.akcijaProcenat} onChange={(v) => set("akcijaProcenat", v)} width={80} />
                  </label>
                  <label className="field">
                    Od
                    <input
                      className="input"
                      type="date"
                      disabled={a.akcijaNeograniceno}
                      value={a.akcijaOd ?? ""}
                      onChange={(e) => set("akcijaOd", e.target.value || null)}
                    />
                  </label>
                  <label className="field">
                    Do
                    <input
                      className="input"
                      type="date"
                      disabled={a.akcijaNeograniceno}
                      value={a.akcijaDo ?? ""}
                      onChange={(e) => set("akcijaDo", e.target.value || null)}
                    />
                  </label>
                  <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, paddingBottom: 6 }}>
                    <Toggle checked={a.akcijaNeograniceno} onChange={(v) => set("akcijaNeograniceno", v)} />
                    Neograničeno
                  </label>
                  {savedId !== null && (
                    <button className="btn" onClick={() => setShowAkcije(true)}>
                      Istorija akcija
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* povezani / varijacije / atributi - tri kompaktne sekcije (brief 5.7) */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div className="card" style={{ flex: 1, minWidth: 260 }}>
              <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>
                POVEZANI ARTIKLI{" "}
                {savedId !== null && (
                  <button className="btn" style={{ padding: "1px 8px" }} onClick={() => setShowPovezani(true)}>
                    + Dodaj
                  </button>
                )}
              </h2>
              <div className="tablewrap">
                <table className="data">
                  <tbody>
                    {povezani.map((p) => (
                      <tr key={p.relatedId} onDoubleClick={() => onOpen(p.relatedId)}>
                        <td>{p.ident}</td>
                        <td>{p.naziv}</td>
                        <td>
                          <button
                            className="btn"
                            style={{ padding: "0 6px" }}
                            onClick={async () => {
                              await api(`/api/artikli/${savedId}/povezani/${p.relatedId}`, { method: "DELETE" });
                              if (savedId) reload(savedId);
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {(jeParent || varijacije.length > 0 || savedId === null) && jeParent && (
              <div className="card" style={{ flex: 1, minWidth: 260 }}>
                <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>
                  VARIJACIJE{" "}
                  <button className="btn" style={{ padding: "1px 8px" }} onClick={() => setShowNovaVar(true)}>
                    + Nova varijacija
                  </button>
                </h2>
                <div className="tablewrap">
                  <table className="data">
                    <tbody>
                      {varijacije.map((v) => (
                        <tr key={v.id} onDoubleClick={() => onOpen(v.id)}>
                          <td>{v.ident}</td>
                          <td>{v.naziv}</td>
                          <td>{v.prodajnaCena !== null ? `${Number(v.prodajnaCena).toLocaleString("sr-RS")} ${v.prodajnaValuta}` : ""}</td>
                        </tr>
                      ))}
                      {noveVarijacije.map((v, i) => (
                        <tr key={`nova-${i}`}>
                          <td>(novo)</td>
                          <td>{v.naziv}</td>
                          <td>{v.prodajnaCena?.toLocaleString("sr-RS") ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card" style={{ flex: 1, minWidth: 220 }}>
              <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>ATRIBUTI</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {atributi.map((at, i) => (
                  <span
                    key={i}
                    style={{ border: "1px solid var(--line-strong)", borderRadius: 3, padding: "2px 8px", fontSize: 12 }}
                  >
                    {at}{" "}
                    <span style={{ cursor: "pointer", color: "var(--ink-3)" }} onClick={() => setAtributi(atributi.filter((_, j) => j !== i))}>
                      ×
                    </span>
                  </span>
                ))}
                {atributi.length < 20 && (
                  <input
                    className="input"
                    style={{ width: 110 }}
                    placeholder="+ atribut"
                    onKeyDown={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (e.key === "Enter" && v) {
                        setAtributi([...atributi, v]);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {savedId !== null && <FajloviSekcija articleId={savedId} fajlovi={fajlovi} onChanged={() => reload(savedId)} />}
        </div>
      )}

      {tab === "zalihe" && savedId !== null && <ZaliheTab articleId={savedId} vodiSerijske={a.serijskiBrojevi} />}
      {tab === "zalihe" && savedId === null && <div className="placeholder">Prvo snimite artikal.</div>}

      {tab === "dokumentacija" &&
        (savedId === null ? (
          <div className="placeholder">Prvo snimite artikal.</div>
        ) : (
          <DokumentacijaTab artikalId={savedId} />
        ))}

      {tab === "istorija" && savedId !== null && <IstorijaTab articleId={savedId} />}
      {tab === "istorija" && savedId === null && <div className="placeholder">Prvo snimite artikal.</div>}

      {showPovezani && savedId !== null && (
        <PovezaniPopup
          articleId={savedId}
          onDone={() => {
            setShowPovezani(false);
            reload(savedId);
          }}
          onCancel={() => setShowPovezani(false)}
        />
      )}
      {showAkcije && savedId !== null && <AkcijeIstorijaPopup articleId={savedId} onClose={() => setShowAkcije(false)} />}
      {serijskiFlag !== null && savedId !== null && (
        <SerijskiFlagPopup
          articleId={savedId}
          ident={ident}
          enable={serijskiFlag}
          onDone={() => {
            setSerijskiFlag(null);
            reload(savedId);
          }}
          onCancel={() => setSerijskiFlag(null)}
        />
      )}
      {showNovaVar && (
        <NovaVarijacijaPopup
          parent={a}
          onAdd={async (v) => {
            setShowNovaVar(false);
            if (savedId !== null) {
              await api("/api/artikli", { method: "POST", body: { ...v, tip: "varijacija", parentId: savedId } });
              reload(savedId);
            } else {
              setNoveVarijacije([...noveVarijacije, v]);
            }
          }}
          onCancel={() => setShowNovaVar(false)}
        />
      )}
    </>
  );
}

// Istorija izmena kao tree po parametru (brief 5.7)
function IstorijaTab({ articleId }: { articleId: number }) {
  const q = useQuery({
    queryKey: ["artikal-istorija", articleId],
    queryFn: () =>
      api<{ field: string; oldValue: string | null; newValue: string | null; createdAt: string; user: string | null }[]>(
        `/api/artikli/${articleId}/istorija`,
      ),
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byField = new Map<string, NonNullable<typeof q.data>>();
  for (const row of q.data ?? []) {
    if (!byField.has(row.field)) byField.set(row.field, []);
    byField.get(row.field)!.push(row);
  }
  if ((q.data ?? []).length === 0) return <div className="placeholder">Nema zabeleženih izmena.</div>;
  return (
    <div style={{ maxWidth: 700 }}>
      {[...byField.entries()].map(([field, rows]) => (
        <div key={field} style={{ marginBottom: 4 }}>
          <div
            style={{ cursor: "pointer", fontWeight: 600, fontSize: 12.5, padding: "4px 6px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)" }}
            onClick={() => {
              const next = new Set(open);
              if (next.has(field)) next.delete(field);
              else next.add(field);
              setOpen(next);
            }}
          >
            {open.has(field) ? "▾" : "▸"} {field} ({rows.length})
          </div>
          {open.has(field) &&
            rows.map((r, i) => (
              <div key={i} style={{ fontSize: 12, padding: "3px 6px 3px 24px", color: "var(--ink-2)" }}>
                {new Date(r.createdAt).toLocaleString("sr-RS")} - {r.user ?? "?"}: {r.oldValue ?? "(prazno)"} → {r.newValue ?? "(prazno)"}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function AkcijeIstorijaPopup({ articleId, onClose }: { articleId: number; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["akcije", articleId],
    queryFn: () =>
      api<{ id: number; procenat: string | null; od: string | null; doDatuma: string | null; neograniceno: boolean; createdAt: string }[]>(
        `/api/artikli/${articleId}/akcije`,
      ),
  });
  return (
    <div className="overlay">
      <div className="popup">
        <h2>Istorija akcija</h2>
        <div className="tablewrap" style={{ marginBottom: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Uneto</th>
                <th>%</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleDateString("sr-RS")}</td>
                  <td>{r.procenat ?? "-"}</td>
                  <td>
                    {r.neograniceno
                      ? "neograničeno"
                      : r.od && r.doDatuma
                        ? `${new Date(r.od).toLocaleDateString("sr-RS")} - ${new Date(r.doDatuma).toLocaleDateString("sr-RS")}`
                        : "-"}
                  </td>
                </tr>
              ))}
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

// Popup za novu varijaciju - polja popunjena iz parenta, naziv se kuca ponovo (brief 5.2)
function NovaVarijacijaPopup({
  parent,
  onAdd,
  onCancel,
}: {
  parent: ArtikalForm;
  onAdd: (v: ArtikalForm) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ArtikalForm>({
    ...parent,
    tip: "varijacija",
    naziv: "",
    sku: "",
    prodajnaCena: null,
    dobavljacevaCena: null,
    // slika, dokumenti i povezani se NE kopiraju (dodaju se na varijaciji)
  });
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 460 }}>
        <h2>Nova varijacija</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="field">
            Naziv varijacije * (puni naziv: "{parent.naziv} - ...")
            <input className="input" value={v.naziv} onChange={(e) => setV({ ...v, naziv: e.target.value })} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              SKU *
              <input className="input" value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Prodajna cena *
              <NumInput value={v.prodajnaCena} onChange={(x) => setV({ ...v, prodajnaCena: x })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Dobavljačeva cena *
              <NumInput value={v.dobavljacevaCena} onChange={(x) => setV({ ...v, dobavljacevaCena: x })} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={!v.naziv || !v.sku} onClick={() => onAdd(v)}>
              Dodaj
            </button>
            <button className="btn" onClick={onCancel}>
              Otkaži
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
