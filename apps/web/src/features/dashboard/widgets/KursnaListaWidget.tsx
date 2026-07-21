import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api";
import type { WidgetProps } from "../registry";

interface KursRezultat {
  datum: string;
  kursevi: { valuta: string; srednji: number }[];
}

export function KursnaListaWidget(_props: WidgetProps) {
  const q = useQuery({
    queryKey: ["kurs"],
    queryFn: () => api<KursRezultat>("/api/dashboard/kurs"),
    staleTime: 60 * 60 * 1000,
  });

  if (q.isLoading) return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Učitavanje...</div>;
  if (q.isError || !q.data) return <div style={{ color: "var(--danger)", fontSize: 12.5 }}>Kursna lista nije dostupna.</div>;

  return (
    <div>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          {q.data.kursevi.map((k) => (
            <tr key={k.valuta} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "5px 0", fontWeight: 600 }}>{k.valuta}</td>
              <td style={{ padding: "5px 0", textAlign: "right" }}>{k.srednji.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ opacity: 0.6, fontSize: 11.5, marginTop: 6 }}>
        Srednji kurs, {new Date(q.data.datum).toLocaleDateString("sr-RS")}
      </div>
    </div>
  );
}
