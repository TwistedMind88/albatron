import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api";
import { useTabs } from "../../../store/tabs";
import type { ZadatakRed } from "../../zadaci/ZadaciPage";

// Moji aktivni zadaci + pozivnice. Reuse endpoint iz faze 1 (mine=1), bez novog API-ja.
export function ZadaciWidget() {
  const qc = useQueryClient();
  const openTab = useTabs((s) => s.open);
  const q = useQuery({
    queryKey: ["zadaci", "aktivan", "mine"],
    queryFn: () => api<ZadatakRed[]>("/api/zadaci?status=aktivan&mine=1"),
  });
  const rows = q.data ?? [];

  async function odgovori(id: number, akcija: "prihvati" | "odbij") {
    await api(`/api/zadaci/${id}/${akcija}`, { method: "POST" });
    void qc.invalidateQueries({ queryKey: ["zadaci"] });
  }

  return (
    <div>
      {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema zadataka.</div>}
      {rows.map((r) => {
        const istekao = r.rok && new Date(r.rok) < new Date();
        return (
          <div
            key={r.id}
            onClick={() => openTab("zadaci", r.naziv, { payload: { openId: r.id } })}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 12.5 }}
          >
            <span className="link" style={istekao ? { color: "var(--danger)" } : undefined}>{r.naziv}</span>
            {r.mojaPozivnica && (
              <span style={{ display: "flex", gap: 4 }}>
                <button className="btn primary" onClick={(e) => { e.stopPropagation(); void odgovori(r.id, "prihvati"); }}>Prihvati</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); void odgovori(r.id, "odbij"); }}>Odbij</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
