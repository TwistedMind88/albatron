import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../api";
import type { WidgetConfigProps, WidgetProps } from "../registry";

interface RssRezultat {
  title: string;
  items: { title: string; link: string; pubDate: string }[];
}

function urls(c: Record<string, unknown>): string[] {
  return Array.isArray(c.urls) ? (c.urls as string[]).filter((u) => typeof u === "string") : [];
}

function RssFeed({ url }: { url: string }) {
  const q = useQuery({
    queryKey: ["rss", url],
    queryFn: () => api<RssRezultat>(`/api/dashboard/rss?url=${encodeURIComponent(url)}`),
    staleTime: 10 * 60 * 1000,
  });

  if (q.isLoading) return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Učitavanje...</div>;
  if (q.isError || !q.data) return <div style={{ color: "var(--danger)", fontSize: 12.5 }}>Feed nije dostupan.</div>;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 3 }}>{q.data.title}</div>
      {q.data.items.length === 0 && <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema stavki.</div>}
      {q.data.items.map((it, i) => (
        <a
          key={i}
          href={it.link || undefined}
          target="_blank"
          rel="noreferrer"
          style={{ display: "block", padding: "4px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}
        >
          <span className="link">{it.title}</span>
          {it.pubDate && (
            <span style={{ opacity: 0.6, marginLeft: 6, whiteSpace: "nowrap" }}>
              {new Date(it.pubDate).toLocaleDateString("sr-RS")}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}

export function RssWidget({ config }: WidgetProps) {
  const lista = urls(config);
  if (lista.length === 0) {
    return <div style={{ opacity: 0.6, fontSize: 12.5 }}>Nema feedova. Dodajte URL zupčanikom.</div>;
  }
  return (
    <div>
      {lista.map((u) => (
        <RssFeed key={u} url={u} />
      ))}
    </div>
  );
}

export function RssConfig({ config, onChange }: WidgetConfigProps) {
  const lista = urls(config);
  const [novi, setNovi] = useState("");
  function dodaj() {
    const u = novi.trim();
    if (!u || lista.includes(u)) return;
    onChange({ ...config, urls: [...lista, u] });
    setNovi("");
  }
  function ukloni(u: string) {
    onChange({ ...config, urls: lista.filter((x) => x !== u) });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {lista.map((u) => (
        <div key={u} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span>
          <button type="button" className="btn" onClick={() => ukloni(u)}>×</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="url"
          placeholder="https://..."
          value={novi}
          style={{ flex: 1 }}
          onChange={(e) => setNovi(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dodaj()}
        />
        <button type="button" className="btn" onClick={dodaj}>Dodaj</button>
      </div>
    </div>
  );
}
