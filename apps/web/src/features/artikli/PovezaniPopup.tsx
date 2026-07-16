import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Artikal } from "./ArtikliPage";

// Popup sa pretragom i multi-select checkboxovima (brief 5.5)
export function PovezaniPopup({
  articleId,
  onDone,
  onCancel,
}: {
  articleId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const artikli = useQuery({ queryKey: ["artikli"], queryFn: () => api<Artikal[]>("/api/artikli") });

  const filtered = (artikli.data ?? []).filter(
    (a) =>
      a.id !== articleId &&
      a.tip !== "parent" &&
      (a.naziv.toLowerCase().includes(q.toLowerCase()) || a.ident.includes(q)),
  );

  async function add() {
    await api(`/api/artikli/${articleId}/povezani`, { method: "POST", body: { ids: [...sel] } });
    onDone();
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 480 }}>
        <h2>Dodaj povezane artikle</h2>
        <input
          className="input"
          style={{ width: "100%", marginBottom: 8 }}
          placeholder="Pretraga po nazivu ili identu..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="tablewrap" style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
          <table className="data">
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={sel.has(a.id)}
                      onChange={() => {
                        const next = new Set(sel);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        setSel(next);
                      }}
                    />
                  </td>
                  <td>{a.ident}</td>
                  <td>{a.naziv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={sel.size === 0} onClick={add}>
            Dodaj ({sel.size})
          </button>
          <button className="btn" onClick={onCancel}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
