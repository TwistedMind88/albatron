import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { useTabs } from "../../store/tabs";
import { TIP_SEKCIJA } from "../dokumenti/common";

export interface Obavestenje {
  id: number;
  tip: string;
  naslov: string;
  tekst: string;
  linkTip: string | null;
  linkId: number | null;
  procitano: boolean;
  createdAt: string;
}

function datumVreme(iso: string) {
  return new Date(iso).toLocaleString("sr-RS");
}

// Inbox-stil lista obavestenja. Koristi je zvonce popover i (kasnije) dashboard widget.
export function ObavestenjaLista({ limit = 50, onNavigate }: { limit?: number; onNavigate?: () => void }) {
  const qc = useQueryClient();
  const openTab = useTabs((s) => s.open);
  const q = useQuery({
    queryKey: ["obavestenja"],
    queryFn: () => api<Obavestenje[]>(`/api/obavestenja?limit=${limit}`),
  });

  async function oznaciProcitano(id: number) {
    await api(`/api/obavestenja/${id}/procitano`, { method: "POST" });
    void qc.invalidateQueries({ queryKey: ["obavestenja"] });
    void qc.invalidateQueries({ queryKey: ["obavestenja-broj"] });
  }

  async function otvori(o: Obavestenje) {
    if (!o.procitano) void oznaciProcitano(o.id);
    if (o.linkTip === "zadatak" && o.linkId) {
      openTab("zadaci", "Zadaci", { payload: { openId: o.linkId } });
    } else if (o.linkTip === "dokument" && o.linkId) {
      // tip dokumenta odredjuje sekciju - lako se dobija iz samog dokumenta
      const doc = await api<{ tip: string; broj: string }>(`/api/dokumenti/${o.linkId}`).catch(() => null);
      const sekcija = doc ? TIP_SEKCIJA[doc.tip] : undefined;
      if (doc && sekcija) openTab(sekcija, doc.broj, { forceNew: true, payload: { openId: o.linkId } });
    }
    onNavigate?.();
  }

  const podaci = q.data ?? [];

  return (
    <div className="obav-lista">
      {podaci.length === 0 && <div style={{ padding: 12, opacity: 0.6, fontSize: 12.5 }}>Nema obaveštenja.</div>}
      {podaci.map((o) => (
        <div
          key={o.id}
          onClick={() => void otvori(o)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "8px 10px",
            borderBottom: "1px solid var(--line)",
            cursor: "pointer",
            background: o.procitano ? undefined : "var(--accent-soft)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b style={{ fontSize: 12.5, fontWeight: o.procitano ? 400 : 600 }}>{o.naslov}</b>
            <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" }}>{datumVreme(o.createdAt)}</span>
          </div>
          {o.tekst && <div style={{ fontSize: 12, opacity: 0.8 }}>{o.tekst}</div>}
        </div>
      ))}
    </div>
  );
}
