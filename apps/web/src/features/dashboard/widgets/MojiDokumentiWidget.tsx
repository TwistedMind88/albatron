import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api";
import { useTabs } from "../../../store/tabs";
import { TIP_INFO, TIP_SEKCIJA } from "../../dokumenti/common";

interface Red {
  id: number;
  tip: string;
  broj: string;
  datum: string;
}

// Svi moji dokumenti u statusu "u izradi" (agregat po tipovima).
export function MojiDokumentiWidget() {
  const openTab = useTabs((s) => s.open);
  const q = useQuery({
    queryKey: ["dashboard-moji-dokumenti"],
    queryFn: () => api<Red[]>("/api/dashboard/moji-dokumenti"),
  });
  const rows = q.data ?? [];

  function otvori(r: Red) {
    const sekcija = TIP_SEKCIJA[r.tip];
    if (sekcija) openTab(sekcija, r.broj, { forceNew: true, payload: { openId: r.id } });
  }

  return (
    <div>
      {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema dokumenata u izradi.</div>}
      {rows.map((r) => (
        <div
          key={r.id}
          onClick={() => otvori(r)}
          style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 12.5 }}
        >
          <span className="link">{r.broj}</span>
          <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{TIP_INFO[r.tip]?.label ?? r.tip}</span>
        </div>
      ))}
    </div>
  );
}
