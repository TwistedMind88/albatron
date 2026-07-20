import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { TIP_INFO } from "../dokumenti/common";

interface Pretplata {
  tip: string;
  dokumentTip: string;
}

// Pretplate na obavestenja: checkbox po tipu dokumenta = "kreiranje dokumenta tog tipa".
// Koristi je i podesavanja i dashboard widget config (faza 5).
export function PretplateForm({ onSaved }: { onSaved?: () => void }) {
  const q = useQuery({ queryKey: ["obavestenja-pretplate"], queryFn: () => api<Pretplata[]>("/api/obavestenja/pretplate") });
  const [izabrani, setIzabrani] = useState<Set<string>>(new Set());
  const [poruka, setPoruka] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setIzabrani(new Set(q.data.filter((p) => p.tip === "dokument_kreiran").map((p) => p.dokumentTip)));
  }, [q.data]);

  function toggle(tip: string) {
    const s = new Set(izabrani);
    if (s.has(tip)) s.delete(tip);
    else s.add(tip);
    setIzabrani(s);
  }

  async function sacuvaj() {
    setPoruka("");
    const items = [...izabrani].map((dokumentTip) => ({ tip: "dokument_kreiran", dokumentTip }));
    await api("/api/obavestenja/pretplate", { method: "PUT", body: { items } });
    setPoruka("Sačuvano.");
    onSaved?.();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12.5, opacity: 0.8 }}>Obaveštenja o kreiranju dokumenta tipa:</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {Object.entries(TIP_INFO).map(([tip, info]) => (
          <label key={tip} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={izabrani.has(tip)} onChange={() => toggle(tip)} />
            {info.mnozina}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={() => void sacuvaj()}>Sačuvaj pretplate</button>
        {poruka && <span style={{ fontSize: 12, opacity: 0.7 }}>{poruka}</span>}
      </div>
    </div>
  );
}
