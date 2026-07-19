import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, ApiError } from "../../api";
import { DataTable } from "../../components/DataTable";
import { Autocomplete } from "../../components/Autocomplete";
import { Grupe } from "./Grupe";
import Toggle from "../../components/Toggle";

interface Korisnik {
  id: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
  active: boolean;
  roleIds: number[];
}

interface Rola {
  id: number;
  name: string;
}

const chipStil = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 10,
  background: "var(--accent-soft)",
  color: "var(--accent-ink)",
  fontSize: 11.5,
  marginRight: 4,
} as const;

// klik na korisnicko ime otvara izmenu, kao link na broj dokumenta (faza 16, st. 1)
const columns = (onOpen: (k: Korisnik) => void, role: Rola[]): ColumnDef<Korisnik, any>[] => [
  {
    accessorKey: "username",
    header: "Korisnicko ime",
    cell: (c) => (
      <a className="link" onClick={() => onOpen(c.row.original)}>
        {c.getValue()}
      </a>
    ),
  },
  { accessorKey: "fullName", header: "Ime i prezime" },
  {
    accessorKey: "roleIds",
    header: "Grupe",
    cell: (c) => (
      <>
        {(c.getValue() as number[]).map((id) => {
          const r = role.find((x) => x.id === id);
          return r ? (
            <span key={id} style={chipStil}>
              {r.name}
            </span>
          ) : null;
        })}
      </>
    ),
  },
  {
    accessorKey: "active",
    header: "Aktivan",
    cell: (c) => (c.getValue() ? "Da" : "Ne"),
  },
];

export function KorisniciPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"korisnici" | "grupe">("korisnici");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Korisnik | null>(null);

  const korisnici = useQuery({
    queryKey: ["korisnici"],
    queryFn: () => api<Korisnik[]>("/api/korisnici"),
  });
  const role = useQuery({
    queryKey: ["role"],
    queryFn: () => api<Rola[]>("/api/role"),
  });

  const close = () => {
    setShowNew(false);
    setEditing(null);
  };
  const done = () => {
    close();
    qc.invalidateQueries({ queryKey: ["korisnici"] });
  };

  return (
    <>
      <div className="page-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1>Korisnici</h1>
        {/* dugmad-tabovi: korisnici / grupe korisnika (stavke 7-8) */}
        <button className={tab === "korisnici" ? "btn primary" : "btn"} onClick={() => setTab("korisnici")}>
          Korisnici
        </button>
        <button className={tab === "grupe" ? "btn primary" : "btn"} onClick={() => setTab("grupe")}>
          Grupe
        </button>
      </div>
      {tab === "grupe" ? (
        <Grupe />
      ) : (
        <DataTable
          tableId="korisnici"
          data={korisnici.data ?? []}
          columns={columns(setEditing, role.data ?? [])}
          onRowDoubleClick={(row) => setEditing(row)}
          toolbar={
            <button className="btn primary" onClick={() => setShowNew(true)}>
              + Novi korisnik
            </button>
          }
        />
      )}
      {(showNew || editing) && (
        <KorisnikPopup role={role.data ?? []} korisnik={editing} onDone={done} onCancel={close} />
      )}
    </>
  );
}

function KorisnikPopup({
  role,
  korisnik,
  onDone,
  onCancel,
}: {
  role: Rola[];
  korisnik: Korisnik | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    username: korisnik?.username ?? "",
    password: "",
    fullName: korisnik?.fullName ?? "",
    active: korisnik?.active ?? true,
  });
  // vise grupa po korisniku (faza 16, RP6): chips + autocomplete za dodavanje
  const [grupe, setGrupe] = useState<number[]>(korisnik?.roleIds ?? []);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        username: form.username,
        fullName: form.fullName,
        roleIds: grupe,
      };
      if (korisnik) {
        body.active = form.active;
        if (form.password) body.password = form.password;
        return api(`/api/korisnici/${korisnik.id}`, { method: "PUT", body });
      }
      body.password = form.password;
      return api("/api/korisnici", { method: "POST", body });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Greska pri snimanju"),
  });

  return (
    <div className="overlay">
      <div className="popup">
        <h2>{korisnik ? "Izmena korisnika" : "Novi korisnik"}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="field">
            Korisnicko ime
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="field">
            Ime i prezime
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </label>
          <label className="field">
            {korisnik ? "Nova lozinka (reset, prazno = bez izmene)" : "Lozinka"}
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="field">
            Grupe
            <div style={{ marginBottom: grupe.length ? 4 : 0 }}>
              {grupe.map((id) => {
                const r = role.find((x) => x.id === id);
                return (
                  <span key={id} style={{ ...chipStil, cursor: "pointer" }} title="Ukloni" onClick={() => setGrupe(grupe.filter((g) => g !== id))}>
                    {r?.name ?? id} ✕
                  </span>
                );
              })}
            </div>
            <Autocomplete
              options={role.filter((r) => !grupe.includes(r.id)).map((r) => ({ id: r.id, label: r.name }))}
              value={null}
              onChange={(o) => o && setGrupe([...grupe, Number(o.id)])}
              placeholder="Dodaj grupu..."
            />
          </label>
          {korisnik && (
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
              Aktivan
            </label>
          )}
          {error && <div className="login-error">{error}</div>}
          <div className="actions" style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn primary" onClick={() => save.mutate()}>
              Snimi
            </button>
            <button className="btn" onClick={onCancel}>
              Otkazi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
