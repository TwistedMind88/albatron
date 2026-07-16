// Lokalno cuvanje server sesija za login sa izborom servera (stavke 21-23).
// Cuva se PRE prijave, pa ide u localStorage (radi i u Tauri WebView2 i u browseru).
// ponytail: localStorage umesto @tauri-apps/plugin-store; preci na plugin-store
// ako zatreba deljenje sesija van webview profila.

export interface ServerSesija {
  naziv: string;
  url: string; // npr. http://192.168.1.10:3000 ili https://erp.firma.com
  baza: string;
}

const KEY = "serverSesije";

export function ucitajSesije(): ServerSesija[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ServerSesija[];
  } catch {
    return [];
  }
}

export function sacuvajSesije(sesije: ServerSesija[]) {
  localStorage.setItem(KEY, JSON.stringify(sesije));
}

// Aktivira sesiju (ili lokalni server za url="") i restartuje app da api.ts pokupi novi base
export function aktivirajSesiju(url: string) {
  if (url) localStorage.setItem("apiBase", url);
  else localStorage.removeItem("apiBase");
  localStorage.removeItem("apiToken");
  location.reload();
}

// Sastavlja URL iz adrese (IP ili domen, sa ili bez protokola) i opcionog porta
export function napraviUrl(adresa: string, port: string) {
  let a = adresa.trim().replace(/\/+$/, "");
  if (!a) return "";
  if (!/^https?:\/\//.test(a)) a = `http://${a}`;
  return port.trim() ? `${a}:${port.trim()}` : a;
}
