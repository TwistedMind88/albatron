import { useEffect, useState } from "react";
import { api } from "../../api";

interface LabeledValue {
  label: string;
  value: string;
}

interface Profil {
  name: string;
  address: string;
  pib: string;
  maticniBroj: string;
  bankAccounts: LabeledValue[];
  phones: LabeledValue[];
  emails: LabeledValue[];
}

const EMPTY: Profil = {
  name: "",
  address: "",
  pib: "",
  maticniBroj: "",
  bankAccounts: [],
  phones: [],
  emails: [],
};

// Lista sa predpoljima (brief 10): label + vrednost, dodavanje/brisanje redova
function LabeledList({
  title,
  items,
  onChange,
}: {
  title: string;
  items: LabeledValue[];
  onChange: (items: LabeledValue[]) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: "11.5px", color: "var(--ink-2)", marginBottom: 4 }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input
            className="input"
            style={{ width: 140 }}
            placeholder="Naziv"
            value={item.label}
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
            }
          />
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Vrednost"
            value={item.value}
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
          />
          <button className="btn" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...items, { label: "", value: "" }])}>
        + Dodaj
      </button>
    </div>
  );
}

export function ProfilFirme() {
  const [p, setP] = useState<Profil>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Profil | null>("/api/profil-firme").then((data) => data && setP({ ...EMPTY, ...data }));
  }, []);

  async function save() {
    await api("/api/profil-firme", { method: "PUT", body: p });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Profil firme</h1>
      <label className="field">
        Naziv firme
        <input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      </label>
      <label className="field">
        Adresa
        <input className="input" value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} />
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          PIB
          <input className="input" value={p.pib} onChange={(e) => setP({ ...p, pib: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Matični broj
          <input
            className="input"
            value={p.maticniBroj}
            onChange={(e) => setP({ ...p, maticniBroj: e.target.value })}
          />
        </label>
      </div>
      <LabeledList title="Žiro računi" items={p.bankAccounts} onChange={(bankAccounts) => setP({ ...p, bankAccounts })} />
      <LabeledList title="Telefoni" items={p.phones} onChange={(phones) => setP({ ...p, phones })} />
      <LabeledList title="Mailovi" items={p.emails} onChange={(emails) => setP({ ...p, emails })} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={save}>
          Snimi
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Snimljeno</span>}
      </div>
    </div>
  );
}
