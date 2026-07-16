import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { Lookup } from "./Liste";

interface Category {
  id: number;
  parentId: number | null;
  code: string | null;
  name: string;
  sortOrder: number;
  porezId: number | null;
  carina: string | null;
}

// Stablo kategorija (brief 5.3): strelice za redosled unutar nivoa,
// izbor nadkategorije, bulk premestanje, porez i carina na krajnjoj kategoriji
export function Kategorije() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [novaNaziv, setNovaNaziv] = useState("");
  const [noviParent, setNoviParent] = useState<number | "">("");

  const cats = useQuery({ queryKey: ["kategorije"], queryFn: () => api<Category[]>("/api/kategorije") });
  const liste = useQuery({ queryKey: ["liste"], queryFn: () => api<Lookup[]>("/api/liste") });
  const porezi = (liste.data ?? []).filter((l) => l.kind === "porez" && l.active);
  const all = cats.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["kategorije"] });

  const create = useMutation({
    mutationFn: () =>
      api("/api/kategorije", {
        method: "POST",
        body: { name: novaNaziv, parentId: noviParent === "" ? null : noviParent },
      }),
    onSuccess: () => {
      setNovaNaziv("");
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/kategorije/${id}`, { method: "PUT", body }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/kategorije/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => alert(e.message),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api("/api/kategorije-redosled", { method: "PUT", body: { ids } }),
    onSuccess: invalidate,
  });

  const bulkMove = useMutation({
    mutationFn: (parentId: number | null) =>
      api("/api/kategorije-premesti", { method: "PUT", body: { ids: [...selected], parentId } }),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => alert(e.message),
  });

  function siblings(cat: Category) {
    return all
      .filter((c) => c.parentId === cat.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  function move(cat: Category, dir: -1 | 1) {
    const sibs = siblings(cat);
    const i = sibs.findIndex((s) => s.id === cat.id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const ids = sibs.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const isLeaf = (id: number) => !all.some((c) => c.parentId === id);

  function renderLevel(parentId: number | null, depth: number): React.ReactNode {
    const level = all
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    return level.map((cat) => (
      <div key={cat.id}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 6px",
            paddingLeft: 6 + depth * 22,
            borderBottom: "1px solid var(--line)",
            fontSize: "12.5px",
          }}
        >
          <input type="checkbox" checked={selected.has(cat.id)} onChange={() => toggleSelect(cat.id)} />
          <span style={{ fontFamily: "monospace", color: "var(--muted, #888)", fontSize: 11.5 }}>{cat.code ?? ""}</span>
          <span style={{ flex: 1 }}>{cat.name}</span>
          {isLeaf(cat.id) && (
            <>
              <select
                className="input"
                style={{ padding: "1px 4px", fontSize: 11.5 }}
                value={cat.porezId ?? ""}
                title="Porez krajnje kategorije"
                onChange={(e) =>
                  update.mutate({ id: cat.id, body: { porezId: e.target.value === "" ? null : Number(e.target.value) } })
                }
              >
                <option value="">porez: -</option>
                {porezi.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internalValue}
                  </option>
                ))}
              </select>
              <input
                className="input"
                style={{ width: 70, padding: "1px 4px", fontSize: 11.5 }}
                placeholder="carina %"
                title="Carina %"
                defaultValue={cat.carina ?? ""}
                onBlur={(e) =>
                  update.mutate({ id: cat.id, body: { carina: e.target.value === "" ? null : Number(e.target.value) } })
                }
              />
            </>
          )}
          <select
            className="input"
            style={{ padding: "1px 4px", fontSize: 11.5, maxWidth: 130 }}
            value=""
            title="Premesti pod nadkategoriju"
            onChange={(e) =>
              update.mutate({ id: cat.id, body: { parentId: e.target.value === "koren" ? null : Number(e.target.value) } })
            }
          >
            <option value="">premesti...</option>
            <option value="koren">(koren)</option>
            {all
              .filter((c) => c.id !== cat.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button className="btn" style={{ padding: "0 6px" }} onClick={() => move(cat, -1)}>
            ▲
          </button>
          <button className="btn" style={{ padding: "0 6px" }} onClick={() => move(cat, 1)}>
            ▼
          </button>
          <button className="btn" style={{ padding: "0 6px" }} onClick={() => remove.mutate(cat.id)}>
            ×
          </button>
        </div>
        {renderLevel(cat.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 17, margin: "0 0 12px" }}>Kategorije artikala</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1 }}>
          Nova kategorija
          <input className="input" value={novaNaziv} onChange={(e) => setNovaNaziv(e.target.value)} />
        </label>
        <label className="field" style={{ width: 200 }}>
          Pod kategorijom
          <select
            className="input"
            value={noviParent}
            onChange={(e) => setNoviParent(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">(koren)</option>
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={!novaNaziv} onClick={() => create.mutate()}>
          + Dodaj
        </button>
      </div>
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12 }}>Premesti {selected.size} izabranih pod:</span>
          <select
            className="input"
            value=""
            onChange={(e) => bulkMove.mutate(e.target.value === "koren" ? null : Number(e.target.value))}
          >
            <option value="">izaberi...</option>
            <option value="koren">(koren)</option>
            {all
              .filter((c) => !selected.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className="tablewrap">{renderLevel(null, 0)}</div>
    </div>
  );
}
