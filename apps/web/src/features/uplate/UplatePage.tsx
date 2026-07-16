import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api, ApiError } from "../../api";
import { sacuvajFajl } from "../../download";
import { useTabs } from "../../store/tabs";
import { Autocomplete } from "../../components/Autocomplete";
import { FilterDugme, type FilterVrednosti } from "../../components/FilterDugme";
import type { FilterDef } from "../dokumenti/common";

// Uplate klijenata (faza 16, RP7): kompaktna tabela sa unosom u praznom redu
// na dnu, zakljucavanjem polja posle snimanja i desni-klik kontekst menijem.

export interface Uplata {
  id: number;
  klijentId: number;
  klijentNaziv: string;
  iznos: string;
  pozivNaBroj: string;
  datumUplate: string;
  referent: string;
  avans: boolean;
  napomena: string;
  dokumentId: number | null;
  dokumentTip: string | null;
}

// tip dokumenta -> sidebar sekcija (za otvaranje dokumenta dvoklikom)
const TIP_SEKCIJA: Record<string, string> = {
  ponuda: "ponude",
  predracun: "predracuni",
  revers: "reversi",
  kalkulacija: "kalkulacije",
  otpremnica: "otpremnice",
  racun: "racuni",
  avansni_racun: "avansni-racuni",
  porudzbina: "porudzbine",
  priprema_uvoza: "priprema-za-uvoz",
  ulaz_robe: "ulaz-robe",
};

const KOLONE = [
  { key: "klijentNaziv", label: "Klijent" },
  { key: "iznos", label: "Iznos" },
  { key: "pozivNaBroj", label: "Poziv na broj" },
  { key: "datumUplate", label: "Datum uplate" },
  { key: "referent", label: "Referent" },
  { key: "avans", label: "Avans" },
  { key: "napomena", label: "Napomena" },
] as const;

const FILTERI: FilterDef[] = [
  { key: "klijentNaziv", label: "Klijent", vrsta: "multi" },
  { key: "referent", label: "Referent", vrsta: "multi" },
  { key: "avans", label: "Avans", vrsta: "multi" },
  { key: "datumUplate", label: "Datum uplate", vrsta: "opseg" },
];

function datumPrikaz(iso: string) {
  const [g, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${g}.`;
}

interface Forma {
  klijent: { id: number; naziv: string } | null;
  iznos: string;
  pozivNaBroj: string;
  datumUplate: string;
  referent: string;
  avans: boolean;
  napomena: string;
}

const PRAZNA: Forma = { klijent: null, iznos: "", pozivNaBroj: "", datumUplate: "", referent: "", avans: false, napomena: "" };

export function UplatePage() {
  const openTab = useTabs((s) => s.open);
  const query = useQuery({ queryKey: ["uplate"], queryFn: () => api<Uplata[]>("/api/uplate") });
  const klijenti = useQuery({
    queryKey: ["uplate-klijenti"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/uplate-klijenti"),
  });
  const referenti = useQuery({
    queryKey: ["uplate-referenti"],
    queryFn: () => api<{ fullName: string }[]>("/api/uplate-referenti"),
  });
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api<{ isAdmin: boolean; privileges: Record<string, string> }>("/api/auth/me"),
  });
  const smeWrite = me.data?.isAdmin || me.data?.privileges["uplate"] === "write";

  const [pretraga, setPretraga] = useState("");
  const [filteri, setFilteri] = useState<FilterVrednosti>({});
  const [skrivene, setSkrivene] = useState<Set<string>>(new Set());
  const [pickerOtvoren, setPickerOtvoren] = useState(false);
  const [greska, setGreska] = useState("");
  // nov unos na dnu (samo u rezimu uredjivanja, RP3)
  const [nova, setNova] = useState<Forma>(PRAZNA);
  // globalni rezim uredjivanja: zakljucano = cist tekst, "Unesi podatke" otkljucava (RP3)
  const [edit, setEdit] = useState(false);
  // select mod (desni klik -> Izaberi)
  const [selectMod, setSelectMod] = useState(false);
  const [izabrani, setIzabrani] = useState<Set<number>>(new Set());
  const [meni, setMeni] = useState<{ x: number; y: number; red: Uplata } | null>(null);
  const [napomenaPopup, setNapomenaPopup] = useState<{ x: number; y: number; tekst: string } | null>(null);

  useEffect(() => {
    if (!meni && !napomenaPopup) return;
    const close = () => {
      setMeni(null);
      setNapomenaPopup(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [meni, napomenaPopup]);

  const referentOpcije = (referenti.data ?? []).map((r) => ({ id: r.fullName, label: r.fullName }));
  const klijentOpcije = (klijenti.data ?? []).map((k) => ({ id: k.id, label: k.naziv }));

  const podaci = useMemo(() => {
    let rows = query.data ?? [];
    const p = pretraga.trim().toLowerCase();
    if (p) {
      rows = rows.filter((r) =>
        [r.klijentNaziv, r.pozivNaBroj, r.referent, r.napomena, r.iznos, datumPrikaz(r.datumUplate)]
          .join(" ")
          .toLowerCase()
          .includes(p),
      );
    }
    for (const def of FILTERI) {
      const v = filteri[def.key];
      if (!v) continue;
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        rows = rows.filter((r) => {
          const val = def.key === "avans" ? (r.avans ? "Avans" : "") : String(r[def.key as keyof Uplata] ?? "");
          return v.includes(val);
        });
      } else {
        if (v.od) rows = rows.filter((r) => r.datumUplate >= v.od);
        if (v.do) rows = rows.filter((r) => r.datumUplate <= v.do);
      }
    }
    return rows;
  }, [query.data, pretraga, filteri]);

  const filterOpcije = useMemo(() => {
    const rows = query.data ?? [];
    const uniq = (vals: string[]) => [...new Set(vals)].sort();
    return {
      klijentNaziv: uniq(rows.map((r) => r.klijentNaziv)),
      referent: uniq(rows.map((r) => r.referent)),
      avans: uniq(rows.map((r) => (r.avans ? "Avans" : ""))),
    };
  }, [query.data]);

  async function snimiNovu() {
    setGreska("");
    if (!nova.klijent) return setGreska("Izaberite klijenta iz liste");
    if (!nova.iznos.trim()) return setGreska("Unesite iznos");
    if (!nova.pozivNaBroj.trim()) return setGreska("Unesite poziv na broj");
    if (!nova.datumUplate) return setGreska("Unesite datum uplate");
    try {
      await api("/api/uplate", {
        method: "POST",
        body: {
          klijentId: nova.klijent?.id ?? 0,
          iznos: nova.iznos.replace(",", "."),
          pozivNaBroj: nova.pozivNaBroj.trim(),
          datumUplate: nova.datumUplate,
          referent: nova.referent,
          avans: nova.avans,
          napomena: nova.napomena,
        },
      });
      setNova(PRAZNA);
      void query.refetch();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  async function azuriraj(id: number, polja: Record<string, unknown>) {
    setGreska("");
    try {
      await api(`/api/uplate/${id}`, { method: "PUT", body: polja });
      void query.refetch();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  async function izbrisiIzabrane() {
    if (izabrani.size === 0) return;
    if (!window.confirm(`Nepovratno brisanje ${izabrani.size} unosa. Nastaviti?`)) return;
    setGreska("");
    try {
      await api("/api/uplate-bulk-delete", { method: "POST", body: { ids: [...izabrani] } });
      setSelectMod(false);
      setIzabrani(new Set());
      void query.refetch();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska pri brisanju");
    }
  }

  function exportExcel() {
    const rows = podaci.map((r) => ({
      Klijent: r.klijentNaziv,
      Iznos: Number(r.iznos),
      "Poziv na broj": r.pozivNaBroj,
      "Datum uplate": datumPrikaz(r.datumUplate),
      Referent: r.referent,
      Avans: r.avans ? "Avans" : "",
      Napomena: r.napomena,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Uplate");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    void sacuvajFajl("uplate.xlsx", new Blob([buf]));
  }

  function otvoriKlijenta(red: Uplata) {
    openTab("klijenti", red.klijentNaziv, { forceNew: true, payload: { openId: red.klijentId } });
  }

  function otvoriDokument(red: Uplata) {
    const sekcija = red.dokumentTip ? TIP_SEKCIJA[red.dokumentTip] : undefined;
    if (!red.dokumentId || !sekcija) {
      setGreska(`Dokument "${red.pozivNaBroj}" ne postoji`);
      return;
    }
    openTab(sekcija, red.pozivNaBroj, { forceNew: true, payload: { openId: red.dokumentId } });
  }

  const vidljive = KOLONE.filter((k) => !skrivene.has(k.key));

  // referent/avans/napomena: editabilni i za read korisnika (read sme PUT ovih polja)
  function celijaOtkljucana(kljuc: string, f: Forma, set: (f: Forma) => void) {
    if (kljuc === "referent") {
      return (
        <Autocomplete
          options={referentOpcije}
          value={f.referent ? { id: f.referent, label: f.referent } : null}
          onChange={(o) => set({ ...f, referent: o ? o.label : "" })}
        />
      );
    }
    if (kljuc === "avans") {
      return (
        <select className="input" value={f.avans ? "avans" : ""} onChange={(e) => set({ ...f, avans: e.target.value === "avans" })}>
          <option value=""></option>
          <option value="avans">Avans</option>
        </select>
      );
    }
    return (
      <input
        className="input"
        style={{ width: "20ch" }}
        maxLength={100}
        value={f.napomena}
        onChange={(e) => set({ ...f, napomena: e.target.value })}
      />
    );
  }

  function red(r: Uplata) {
    return (
      <tr
        key={r.id}
        onContextMenu={(e) => {
          e.preventDefault();
          setMeni({ x: e.clientX, y: e.clientY, red: r });
        }}
      >
        {selectMod && (
          <td>
            <input
              type="checkbox"
              checked={izabrani.has(r.id)}
              onChange={(e) => {
                const s = new Set(izabrani);
                if (e.target.checked) s.add(r.id);
                else s.delete(r.id);
                setIzabrani(s);
              }}
            />
          </td>
        )}
        {vidljive.map((k) => {
          switch (k.key) {
            case "klijentNaziv":
              return (
                <td key={k.key} onDoubleClick={() => otvoriKlijenta(r)} style={{ cursor: "pointer" }}>
                  {edit && smeWrite ? (
                    <Autocomplete
                      options={klijentOpcije}
                      value={{ id: r.klijentId, label: r.klijentNaziv }}
                      onChange={(o) => o && void azuriraj(r.id, { klijentId: Number(o.id) })}
                    />
                  ) : (
                    r.klijentNaziv
                  )}
                </td>
              );
            case "iznos":
              return (
                <td key={k.key} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {edit && smeWrite ? (
                    <input
                      className="input"
                      style={{ width: 90, textAlign: "right" }}
                      inputMode="decimal"
                      defaultValue={r.iznos}
                      onBlur={(e) => {
                        const v = e.target.value.replace(",", ".");
                        if (v !== r.iznos) void azuriraj(r.id, { iznos: v });
                      }}
                    />
                  ) : (
                    Number(r.iznos).toLocaleString("sr-RS", { minimumFractionDigits: 2 })
                  )}
                </td>
              );
            case "pozivNaBroj":
              return (
                <td key={k.key} onDoubleClick={() => otvoriDokument(r)} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                  {edit && smeWrite ? (
                    <input
                      className="input"
                      style={{ width: 120 }}
                      defaultValue={r.pozivNaBroj}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== r.pozivNaBroj) void azuriraj(r.id, { pozivNaBroj: e.target.value.trim() });
                      }}
                    />
                  ) : (
                    r.pozivNaBroj
                  )}
                </td>
              );
            case "datumUplate":
              return (
                <td key={k.key} style={{ whiteSpace: "nowrap" }}>
                  {edit && smeWrite ? (
                    <input
                      type="date"
                      className="input"
                      value={r.datumUplate}
                      onChange={(e) => e.target.value && void azuriraj(r.id, { datumUplate: e.target.value })}
                    />
                  ) : (
                    datumPrikaz(r.datumUplate)
                  )}
                </td>
              );
            case "referent":
              return (
                <td key={k.key}>
                  {edit ? (
                    <Autocomplete
                      options={referentOpcije}
                      value={r.referent ? { id: r.referent, label: r.referent } : null}
                      onChange={(o) => void azuriraj(r.id, { referent: o ? o.label : "" })}
                    />
                  ) : (
                    r.referent
                  )}
                </td>
              );
            case "avans":
              return (
                <td key={k.key}>
                  {edit ? (
                    <select
                      className="input"
                      value={r.avans ? "avans" : ""}
                      onChange={(e) => void azuriraj(r.id, { avans: e.target.value === "avans" })}
                    >
                      <option value=""></option>
                      <option value="avans">Avans</option>
                    </select>
                  ) : r.avans ? (
                    "Avans"
                  ) : (
                    ""
                  )}
                </td>
              );
            case "napomena":
              return (
                <td
                  key={k.key}
                  onDoubleClick={(e) => !edit && setNapomenaPopup({ x: e.clientX, y: e.clientY, tekst: r.napomena })}
                >
                  {edit ? (
                    <input
                      className="input"
                      style={{ width: "20ch" }}
                      maxLength={100}
                      defaultValue={r.napomena}
                      onBlur={(e) => {
                        if (e.target.value !== r.napomena) void azuriraj(r.id, { napomena: e.target.value });
                      }}
                      onDoubleClick={(e) =>
                        setNapomenaPopup({ x: e.clientX, y: e.clientY, tekst: r.napomena })
                      }
                    />
                  ) : (
                    r.napomena
                  )}
                </td>
              );
          }
        })}
      </tr>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Uplate</h1>
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Pretraga..." value={pretraga} onChange={(e) => setPretraga(e.target.value)} />
        <FilterDugme defs={FILTERI} opcije={filterOpcije} vrednosti={filteri} onChange={setFilteri} />
        <div className="grow" />
        {selectMod ? (
          <>
            {smeWrite && (
              <button className="btn" style={{ color: "#fff", background: "var(--danger)" }} onClick={() => void izbrisiIzabrane()}>
                Izbriši unose ({izabrani.size})
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                setSelectMod(false);
                setIzabrani(new Set());
              }}
            >
              Odustani
            </button>
          </>
        ) : (
          <>
            <button className={edit ? "btn primary" : "btn"} onClick={() => setEdit(!edit)}>
              {edit ? "Završi" : "Unesi podatke"}
            </button>
            <div style={{ position: "relative" }}>
              <button className="btn" onClick={() => setPickerOtvoren(!pickerOtvoren)}>
                Kolone
              </button>
              {pickerOtvoren && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    zIndex: 60,
                    background: "var(--surface)",
                    border: "1px solid var(--line-strong)",
                    borderRadius: "var(--radius)",
                    padding: 8,
                    boxShadow: "0 4px 12px rgba(0,0,0,.08)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {KOLONE.map((k) => (
                    <label key={k.key} style={{ display: "flex", gap: 6, fontSize: 12, padding: "2px 4px" }}>
                      <input
                        type="checkbox"
                        checked={!skrivene.has(k.key)}
                        onChange={(e) => {
                          const s = new Set(skrivene);
                          if (e.target.checked) s.delete(k.key);
                          else s.add(k.key);
                          setSkrivene(s);
                        }}
                      />
                      {k.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {smeWrite && (
              <button className="btn" onClick={() => openTab("uplate-import", "Import uplata")}>
                Import
              </button>
            )}
            <button className="btn" onClick={exportExcel}>
              Export
            </button>
          </>
        )}
      </div>
      {greska && (
        <div className="login-error" style={{ marginBottom: 8 }}>
          {greska}
        </div>
      )}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              {selectMod && <th />}
              {vidljive.map((k) => (
                <th key={k.key}>{k.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {podaci.map(red)}
            {/* prazan red za nov unos - samo u rezimu uredjivanja sa write pravom (RP3) */}
            {edit && smeWrite && (
            <tr>
              {selectMod && <td />}
              {vidljive.map((k) => (
                <td key={k.key}>
                  {k.key === "klijentNaziv" && (
                    <Autocomplete
                      options={klijentOpcije}
                      value={nova.klijent ? { id: nova.klijent.id, label: nova.klijent.naziv } : null}
                      onChange={(o) => setNova({ ...nova, klijent: o ? { id: Number(o.id), naziv: o.label } : null })}
                      placeholder="Klijent"
                    />
                  )}
                  {k.key === "iznos" && (
                    <input
                      className="input"
                      style={{ width: 90 }}
                      inputMode="decimal"
                      placeholder="Iznos"
                      value={nova.iznos}
                      onChange={(e) => setNova({ ...nova, iznos: e.target.value })}
                    />
                  )}
                  {k.key === "pozivNaBroj" && (
                    <input
                      className="input"
                      style={{ width: 120 }}
                      placeholder="Poziv na broj"
                      value={nova.pozivNaBroj}
                      onChange={(e) => setNova({ ...nova, pozivNaBroj: e.target.value })}
                    />
                  )}
                  {k.key === "datumUplate" && (
                    <input
                      type="date"
                      className="input"
                      value={nova.datumUplate}
                      onChange={(e) => setNova({ ...nova, datumUplate: e.target.value })}
                    />
                  )}
                  {(k.key === "referent" || k.key === "avans" || k.key === "napomena") &&
                    celijaOtkljucana(k.key, nova, setNova)}
                </td>
              ))}
              <td>
                <button className="btn primary" onClick={() => void snimiNovu()}>
                  Snimi
                </button>
              </td>
            </tr>
            )}
          </tbody>
        </table>
      </div>
      {meni &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: meni.y,
              left: meni.x,
              zIndex: 70,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              padding: 4,
              minWidth: 140,
            }}
          >
            <div
              className="ctx-item"
              style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12.5 }}
              onClick={() => {
                setSelectMod(true);
                setIzabrani(new Set([meni.red.id]));
                setMeni(null);
              }}
            >
              Izaberi
            </div>
            <div
              className="ctx-item"
              style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12.5 }}
              onClick={() => {
                setSelectMod(true);
                setIzabrani(new Set(podaci.map((r) => r.id)));
                setMeni(null);
              }}
            >
              Izaberi sve
            </div>
          </div>,
          document.body,
        )}
      {napomenaPopup &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: napomenaPopup.y,
              left: napomenaPopup.x,
              zIndex: 70,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              padding: 10,
              maxWidth: 320,
              fontSize: 12.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {napomenaPopup.tekst || "(prazno)"}
          </div>,
          document.body,
        )}
    </>
  );
}
