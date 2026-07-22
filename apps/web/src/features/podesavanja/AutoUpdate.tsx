import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";

// Ukljucivanje/iskljucivanje automatskog azuriranja servera (cron u 3h ujutru
// cita flag auto_update iz baze pre povlacenja nove verzije sa GitHuba).

export function AutoUpdate() {
  const queryClient = useQueryClient();
  const stanje = useQuery({
    queryKey: ["auto-update"],
    queryFn: () => api<{ ukljucen: boolean; sat: number }>("/api/podesavanja/auto-update"),
  });

  async function promeni(izmene: { ukljucen: boolean; sat: number }) {
    await api("/api/podesavanja/auto-update", { method: "PUT", body: izmene });
    await queryClient.invalidateQueries({ queryKey: ["auto-update"] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Automatsko ažuriranje</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
        Server svake noći u izabrano vreme proverava da li postoji nova verzija programa i, ako
        postoji, sam se ažurira i ponovo pokreće. Desktop klijenti novu verziju dobijaju dugmetom
        &quot;Ažuriraj&quot; na ekranu za prijavu.
      </p>
      {stanje.data && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={stanje.data.ukljucen}
              onChange={(e) => promeni({ ukljucen: e.target.checked, sat: stanje.data.sat })}
            />
            Automatsko ažuriranje uključeno
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            Vreme ažuriranja
            <select
              className="input"
              style={{ width: "auto" }}
              value={stanje.data.sat}
              disabled={!stanje.data.ukljucen}
              onChange={(e) => promeni({ ukljucen: stanje.data.ukljucen, sat: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-3)" }}>
        Tokom ažuriranja (par minuta) program nije dostupan. Ako ažuriranje ne uspe, detalji su u
        logu na serveru (/var/log/albatron-update.log na Linuxu, update.log u instalacionom
        folderu na Windowsu).
      </p>
    </div>
  );
}
