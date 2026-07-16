import { api, apiFetch, fajlUrl } from "../../api";
import Toggle from "../../components/Toggle";

export interface ArtikalFajl {
  id: number;
  filename: string;
  isImage: boolean;
  autoAttach: boolean;
}

// Slika (jedna) + dokumenti sa rename, brisanjem i "automatski zakaci u mail" (brief 5.6)
export function FajloviSekcija({
  articleId,
  fajlovi,
  onChanged,
}: {
  articleId: number;
  fajlovi: ArtikalFajl[];
  onChanged: () => void;
}) {
  const slika = fajlovi.find((f) => f.isImage);
  const dokumenti = fajlovi.filter((f) => !f.isImage);

  async function upload(file: File, jeSlika: boolean) {
    const fd = new FormData();
    fd.append("file", file);
    await apiFetch(`/api/artikli/${articleId}/fajlovi${jeSlika ? "?slika=true" : ""}`, {
      method: "POST",
      body: fd,
    });
    onChanged();
  }

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      <div style={{ minWidth: 200 }}>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>SLIKA</h2>
        {slika && (
          <img
            src={fajlUrl(`/api/fajlovi/${slika.id}`)}
            alt={slika.filename}
            style={{ maxWidth: 180, maxHeight: 140, display: "block", marginBottom: 6, border: "1px solid var(--line)", borderRadius: "var(--radius)" }}
          />
        )}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], true)} />
      </div>
      <div style={{ flex: 1, minWidth: 340 }}>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", color: "var(--ink-2)" }}>DOKUMENTI</h2>
        <div className="tablewrap" style={{ marginBottom: 6 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Naziv</th>
                <th style={{ width: 160 }}>Automatski zakači u mail</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {dokumenti.map((f) => (
                <tr key={f.id}>
                  <td>
                    <input
                      className="input"
                      style={{ width: "100%", border: "none", padding: "1px 4px" }}
                      defaultValue={f.filename}
                      onBlur={async (e) => {
                        if (e.target.value !== f.filename && e.target.value.trim()) {
                          await api(`/api/fajlovi/${f.id}`, { method: "PUT", body: { filename: e.target.value.trim() } });
                          onChanged();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <Toggle
                      checked={f.autoAttach}
                      onChange={async (v) => {
                        await api(`/api/fajlovi/${f.id}`, { method: "PUT", body: { autoAttach: v } });
                        onChanged();
                      }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn"
                      style={{ padding: "0 6px" }}
                      onClick={async () => {
                        await api(`/api/fajlovi/${f.id}`, { method: "DELETE" });
                        onChanged();
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], false)} />
      </div>
    </div>
  );
}
