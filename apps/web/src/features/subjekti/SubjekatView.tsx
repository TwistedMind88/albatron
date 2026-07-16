import { useEffect, useState } from "react";
import { SUBJECT_ROLES, VALUTE } from "@albatron/shared";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { DokumentacijaTab } from "../../components/DokumentacijaTab";
import { ZemljaAutocomplete } from "../../components/ZemljaAutocomplete";
import Toggle from "../../components/Toggle";
import type { Subjekat } from "./SubjektiPage";
import type { Lookup } from "../podesavanja/Liste";

interface Kontakt {
  id: number;
  name: string;
  phone: string;
  email: string;
  isDefault: boolean;
  active: boolean;
}

const PRAZAN = {
  role: "klijent" as string,
  naziv: "",
  puniNaziv: "",
  adresa: "",
  postanskiBroj: "",
  grad: "",
  pib: "",
  mb: "",
  drzava: "Srbija",
  nacinPlacanjaId: null as number | null,
  paritetId: null as number | null,
  valuta: "RSD",
  active: true,
};

export function SubjekatView({
  id,
  uloga,
  onBack,
}: {
  id: number | null; // null = novi
  uloga: "klijent" | "dobavljac";
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"podaci" | "kontakti" | "dokumentacija">("podaci");
  const [s, setS] = useState<typeof PRAZAN>({ ...PRAZAN, role: uloga });
  const [savedId, setSavedId] = useState(id);
  const [kontakti, setKontakti] = useState<Kontakt[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const liste = useQuery({ queryKey: ["liste"], queryFn: () => api<Lookup[]>("/api/liste") });
  const naciniPlacanja = (liste.data ?? []).filter((l) => l.kind === "nacin_placanja" && l.active);
  const pariteti = (liste.data ?? []).filter((l) => l.kind === "paritet" && l.active);

  useEffect(() => {
    if (savedId !== null) {
      api<Subjekat & { kontakti: Kontakt[] }>(`/api/subjekti/${savedId}`).then((data) => {
        const { kontakti: k, id: _id, ...rest } = data;
        setS(rest as typeof PRAZAN);
        setKontakti(k);
      });
    }
  }, [savedId]);

  function set<K extends keyof typeof PRAZAN>(key: K, value: (typeof PRAZAN)[K]) {
    let next = { ...s, [key]: value };
    // promena drzave na stranu automatski menja valutu na EUR (brief 4.2)
    if (key === "drzava") {
      const strana = String(value).trim().toLowerCase() !== "srbija";
      next = { ...next, valuta: strana ? "EUR" : "RSD" };
    }
    setS(next);
  }

  async function save() {
    setError("");
    try {
      if (savedId === null) {
        const created = await api<{ id: number }>("/api/subjekti", { method: "POST", body: s });
        setSavedId(created.id);
      } else {
        await api(`/api/subjekti/${savedId}`, { method: "PUT", body: s });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
        ← Nazad na listu
      </button>
      <div className="page-head">
        <h1>{savedId === null ? "Novi subjekat" : s.naziv}</h1>
        <div className="grow" />
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
        {error && <span className="login-error">{error}</span>}
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["podaci", "kontakti", "dokumentacija"] as const).map((t) => (
          <button key={t} className={`btn${tab === t ? " primary" : ""}`} onClick={() => setTab(t)}>
            {t === "podaci" ? "Podaci" : t === "kontakti" ? "Kontakti" : "Dokumentacija"}
          </button>
        ))}
      </div>

      {tab === "podaci" && (
        <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="field">
            Uloga
            <select className="input" value={s.role} onChange={(e) => set("role", e.target.value)}>
              {SUBJECT_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              Naziv * (interni, skraćeni)
              <input className="input" value={s.naziv} onChange={(e) => set("naziv", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 2 }}>
              Puni naziv *
              <input className="input" value={s.puniNaziv} onChange={(e) => set("puniNaziv", e.target.value)} />
            </label>
          </div>
          <label className="field">
            Adresa *
            <input className="input" value={s.adresa} onChange={(e) => set("adresa", e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ width: 130 }}>
              Poštanski broj *
              <input className="input" value={s.postanskiBroj} onChange={(e) => set("postanskiBroj", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Grad *
              <input className="input" value={s.grad} onChange={(e) => set("grad", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Država *
              {/* fiksna lista zemalja predlaze, slobodan unos ostaje (RP7.2) */}
              <ZemljaAutocomplete value={s.drzava} onChange={(v) => set("drzava", v)} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              PIB {s.drzava.trim().toLowerCase() === "srbija" ? "*" : ""}
              <input className="input" value={s.pib} onChange={(e) => set("pib", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              MB {s.drzava.trim().toLowerCase() === "srbija" ? "*" : ""}
              <input className="input" value={s.mb} onChange={(e) => set("mb", e.target.value)} />
            </label>
            <label className="field" style={{ width: 100 }}>
              Valuta
              <select className="input" value={s.valuta} onChange={(e) => set("valuta", e.target.value)}>
                {VALUTE.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              Podrazumevani način plaćanja
              <select
                className="input"
                value={s.nacinPlacanjaId ?? ""}
                onChange={(e) => set("nacinPlacanjaId", e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">-</option>
                {naciniPlacanja.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.internalValue}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              Paritet
              <select
                className="input"
                value={s.paritetId ?? ""}
                onChange={(e) => set("paritetId", e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">-</option>
                {pariteti.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internalValue}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <Toggle checked={s.active} onChange={(v) => set("active", v)} />
            Aktivan
          </label>
        </div>
      )}

      {tab === "kontakti" &&
        (savedId === null ? (
          <div className="placeholder">Prvo snimite subjekat.</div>
        ) : (
          <KontaktiTab subjectId={savedId} kontakti={kontakti} onChanged={() => setSavedId(savedId)} reload={async () => {
            const data = await api<{ kontakti: Kontakt[] }>(`/api/subjekti/${savedId}`);
            setKontakti(data.kontakti);
          }} />
        ))}

      {tab === "dokumentacija" &&
        (savedId === null ? (
          <div className="placeholder">Prvo snimite subjekat.</div>
        ) : (
          <DokumentacijaTab subjekatId={savedId} />
        ))}
    </>
  );
}

function KontaktiTab({
  subjectId,
  kontakti,
  reload,
}: {
  subjectId: number;
  kontakti: Kontakt[];
  onChanged: () => void;
  reload: () => Promise<void>;
}) {
  const [nov, setNov] = useState({ name: "", phone: "", email: "", isDefault: false });

  async function add() {
    await api(`/api/subjekti/${subjectId}/kontakti`, { method: "POST", body: nov });
    setNov({ name: "", phone: "", email: "", isDefault: false });
    await reload();
  }

  async function update(id: number, body: Partial<Kontakt>) {
    await api(`/api/kontakti/${id}`, { method: "PUT", body });
    await reload();
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ime i prezime</th>
              <th>Telefon</th>
              <th>Mail</th>
              <th>Podrazumevana</th>
              <th>Aktivan</th>
            </tr>
          </thead>
          <tbody>
            {kontakti.map((k) => (
              <tr key={k.id} style={{ opacity: k.active ? 1 : 0.5 }}>
                <td>{k.name}</td>
                <td>{k.phone}</td>
                <td>{k.email}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={k.isDefault}
                    onChange={(e) => update(k.id, { isDefault: e.target.checked })}
                  />
                </td>
                <td>
                  <Toggle checked={k.active} onChange={(v) => update(k.id, { active: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1 }}>
          Ime i prezime
          <input className="input" value={nov.name} onChange={(e) => setNov({ ...nov, name: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Telefon
          <input className="input" value={nov.phone} onChange={(e) => setNov({ ...nov, phone: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Mail
          <input className="input" value={nov.email} onChange={(e) => setNov({ ...nov, email: e.target.value })} />
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={nov.isDefault}
            onChange={(e) => setNov({ ...nov, isDefault: e.target.checked })}
          />
          Podrazumevana
        </label>
        <button className="btn primary" disabled={!nov.name} onClick={add}>
          + Dodaj
        </button>
      </div>
    </div>
  );
}
