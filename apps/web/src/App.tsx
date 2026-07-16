import { useEffect, useState } from "react";
import type { SessionUser } from "@albatron/shared";
import { api, clearApiToken } from "./api";
import { Login } from "./features/auth/Login";
import { Shell } from "./shell/Shell";

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api<SessionUser>("/api/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <Shell
      user={user}
      onLogout={() => {
        api("/api/auth/logout", { method: "POST" }).finally(() => {
          clearApiToken();
          setUser(null);
        });
      }}
    />
  );
}
