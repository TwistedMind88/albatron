export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Konfigurabilan base URL (stavke 21-23): prazno = relativno (web/dev proxy);
// u Tauri/remote rezimu izabrana server sesija postavlja apiBase, a autentikacija
// ide preko Bearer tokena jer cross-origin cookie ne radi preko plain HTTP.
export const apiBase: string = localStorage.getItem("apiBase") ?? "";

let apiToken = apiBase ? (localStorage.getItem("apiToken") ?? "") : "";

export function setApiToken(token: string) {
  if (!apiBase) return; // isti origin - cookie je dovoljan
  apiToken = token;
  localStorage.setItem("apiToken", token);
}

export function clearApiToken() {
  apiToken = "";
  localStorage.removeItem("apiToken");
}

// fetch sa base URL-om i auth zaglavljem - koristiti umesto golog fetch za /api pozive
export function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
  // remote rezim: bez cookie kredencijala (server ima credentials:false), auth je Bearer
  return fetch(apiBase + path, { credentials: apiBase ? "omit" : "include", ...init, headers });
}

// URL za <img src> / <a href> ka API fajlovima: ne mogu da posalju Authorization
// zaglavlje, pa u remote rezimu token ide kao ?t= query parametar (vidi attachUser)
export function fajlUrl(path: string) {
  if (!apiToken) return apiBase + path;
  return `${apiBase}${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(apiToken)}`;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await apiFetch(path, {
    method: options.method ?? "GET",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? `Greska ${res.status}`);
  }
  return res.json() as Promise<T>;
}
