import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_ROLE, EXTRA_RESOURCES, MODULES } from "@albatron/shared";
import { api } from "../../api";

interface RolaSaPrivilegijama {
  id: number;
  name: string;
  privileges: { resource: string; level: "read" | "write" }[];
}

type Nivo = "none" | "read" | "write";

// Grupe korisnika (stavke 7-8): levo lista grupa, desno matrica modul x nivo prava.
// Jedan model - resursi privilegija su moduli iz registra (MODULES).
export function Grupe() {
  const qc = useQueryClient();
  const [aktivnaId, setAktivnaId] = useState<number | null>(null);
  const [novoIme, setNovoIme] = useState("");
  const [ime, setIme] = useState("");
  const [matrica, setMatrica] = useState<Record<string, Nivo>>({});

  const role = useQuery({ queryKey: ["role"], queryFn: () => api<RolaSaPrivilegijama[]>("/api/role") });
  const aktivna = (role.data ?? []).find((r) => r.id === aktivnaId) ?? null;

  // pri izboru grupe napuni formu iz podataka
  useEffect(() => {
    if (!aktivna) return;
    setIme(aktivna.name);
    const m: Record<string, Nivo> = {};
    for (const p of aktivna.privileges) m[p.resource] = p.level;
    setMatrica(m);
  }, [aktivnaId, role.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["role"] });

  const create = useMutation({
    mutationFn: () => api<{ id: number }>("/api/role", { method: "POST", body: { name: novoIme } }),
    onSuccess: (r) => {
      setNovoIme("");
      setAktivnaId(r.id);
      invalidate();
    },
    onError: (e) => alert(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/role/${aktivnaId}`, {
        method: "PUT",
        body: {
          name: ime,
          privileges: Object.entries(matrica)
            .filter(([, v]) => v !== "none")
            .map(([resource, level]) => ({ resource, level })),
        },
      }),
    onSuccess: invalidate,
    onError: (e) => alert(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/role/${aktivnaId}`, { method: "DELETE" }),
    onSuccess: () => {
      setAktivnaId(null);
      invalidate();
    },
    onError: (e) => alert(e.message),
  });

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ width: 220, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            className="input"
            placeholder="Nova grupa..."
            value={novoIme}
            onChange={(e) => setNovoIme(e.target.value)}
          />
          <button className="btn primary" disabled={!novoIme} onClick={() => create.mutate()}>
            +
          </button>
        </div>
        {(role.data ?? []).map((r) => (
          <div
            key={r.id}
            onClick={() => setAktivnaId(r.id)}
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              fontSize: "12.5px",
              fontWeight: r.id === aktivnaId ? 600 : 400,
              background: r.id === aktivnaId ? "var(--accent-soft)" : undefined,
              color: r.id === aktivnaId ? "var(--accent-ink)" : "var(--ink)",
            }}
          >
            {r.name}
          </div>
        ))}
      </div>
      {aktivna?.name === ADMIN_ROLE ? (
        <div style={{ fontSize: 12.5, color: "var(--muted, #888)", paddingTop: 8 }}>
          Sistemska grupa: članovi su administratori sa svim pravima. Ne menja se i ne briše.
        </div>
      ) : aktivna ? (
        <div style={{ maxWidth: 560, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1 }}>
              Naziv grupe
              <input className="input" value={ime} onChange={(e) => setIme(e.target.value)} />
            </label>
            <button className="btn primary" disabled={!ime} onClick={() => save.mutate()}>
              Snimi
            </button>
            <button className="btn" onClick={() => confirm(`Obrisati grupu "${aktivna.name}"?`) && remove.mutate()}>
              Obriši
            </button>
          </div>
          <div className="tablewrap">
            <table className="data" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>Modul</th>
                  <th style={{ width: 70, textAlign: "center" }}>Nema</th>
                  <th style={{ width: 70, textAlign: "center" }}>Čitanje</th>
                  <th style={{ width: 70, textAlign: "center" }}>Pisanje</th>
                </tr>
              </thead>
              <tbody>
                {/* posebni resursi van modula (faza 16, RP6): brisanje je binarno - nema/pisanje */}
                {[...MODULES, ...EXTRA_RESOURCES.map((r) => ({ ...r, binaran: true }))].map((m) => {
                  const nivo: Nivo = matrica[m.id] ?? "none";
                  const radio = (v: Nivo) => (
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="radio"
                        name={`priv-${m.id}`}
                        checked={nivo === v}
                        onChange={() => setMatrica((prev) => ({ ...prev, [m.id]: v }))}
                      />
                    </td>
                  );
                  const binaran = "binaran" in m && m.binaran;
                  return (
                    <tr key={m.id}>
                      <td>{m.label}</td>
                      {radio("none")}
                      {binaran ? <td /> : radio("read")}
                      {radio("write")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted, #888)", paddingTop: 8 }}>
          Izaberite grupu levo ili napravite novu.
        </div>
      )}
    </div>
  );
}
