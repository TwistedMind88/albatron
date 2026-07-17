import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@albatron/shared";
import { api, clearApiToken, setOnUnauthorized } from "./api";
import { Login, PrijavaForma } from "./features/auth/Login";
import { Shell } from "./shell/Shell";

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [sesijaIstekla, setSesijaIstekla] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    api<SessionUser>("/api/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  // Istekla sesija usred rada: popup za ponovnu prijavu preko aplikacije,
  // stanje tabova i formi ostaje netaknuto
  useEffect(() => {
    if (!user) return;
    setOnUnauthorized(() => setSesijaIstekla(true));
    return () => setOnUnauthorized(null);
  }, [user]);

  if (!checked) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <Shell
        user={user}
        onLogout={() => {
          api("/api/auth/logout", { method: "POST" }).finally(() => {
            clearApiToken();
            setUser(null);
          });
        }}
      />
      {sesijaIstekla && (
        <div className="overlay" style={{ zIndex: 300 }}>
          <div className="popup" style={{ width: "min(340px, 90vw)" }}>
            <h2>Sesija je istekla</h2>
            <p className="subtle" style={{ fontSize: 12, margin: "0 0 10px" }}>
              Prijavite se ponovo da nastavite rad. Nesačuvani podaci ostaju u tabovima.
            </p>
            <PrijavaForma
              onLogin={(u) => {
                setUser(u);
                setSesijaIstekla(false);
                void queryClient.invalidateQueries();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
