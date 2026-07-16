import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DOC_TYPES } from "@albatron/shared";
import { api } from "../api";
import { DokumentView } from "../features/dokumenti/DokumentView";

// Kartica Dokumentacija (brief 4/5): tree svih dokumenata vezanih za
// subjekat ili artikal, grupisano po tipu, klik otvara dokument.

interface DokRed {
  id: number;
  broj: string;
  tip: string;
  datum: string;
  status: string;
  klijentNaziv: string;
}

export function DokumentacijaTab({ subjekatId, artikalId }: { subjekatId?: number; artikalId?: number }) {
  const param = subjekatId != null ? `subjekatId=${subjekatId}` : `artikalId=${artikalId}`;
  const [openDoc, setOpenDoc] = useState<DokRed | null>(null);

  const query = useQuery({
    queryKey: ["dokumenti-za", param],
    queryFn: () => api<DokRed[]>(`/api/dokumenti-za?${param}`),
  });

  if (openDoc) {
    return (
      <DokumentView
        tip={openDoc.tip}
        id={openDoc.id}
        onBack={() => setOpenDoc(null)}
        onOpenDoc={(id) => setOpenDoc({ ...openDoc, id })}
      />
    );
  }

  if (query.isLoading) return <div className="placeholder">Učitavanje...</div>;
  const docs = query.data ?? [];
  const grupe = DOC_TYPES.map((t) => ({ ...t, docs: docs.filter((d) => d.tip === t.id) })).filter(
    (g) => g.docs.length > 0,
  );
  if (grupe.length === 0) return <div className="placeholder">Nema vezanih dokumenata.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
      {grupe.map((g) => (
        <details key={g.id} open>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            {g.label} ({g.docs.length})
          </summary>
          <ul style={{ listStyle: "none", margin: "4px 0", padding: "0 0 0 16px" }}>
            {g.docs.map((d) => (
              <li key={d.id} style={{ padding: "2px 0" }}>
                <button className="btn" onClick={() => setOpenDoc(d)}>
                  {d.broj}
                </button>{" "}
                <span className="subtle">
                  {new Date(d.datum).toLocaleDateString("sr-RS")} - {d.status}
                  {d.klijentNaziv ? ` - ${d.klijentNaziv}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
