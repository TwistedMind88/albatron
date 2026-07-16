// Podesiva numeracija dokumenata (brief 14.2): format sa tokenima u viticastim zagradama.
// Tokeni: {GGGG} {GG} {MM} {DD} i tacno jedan brojac {N}..{NNNNNNNN} (padding = broj N).
// Literal tekst van zagrada je slobodan (npr. "PON", "011").
import { DOC_TYPES } from "./auth.js";

const TOKEN_RE = /\{([^}]*)\}/g;

export function podrazumevaniFormat(tip: string) {
  const code = DOC_TYPES.find((d) => d.id === tip)?.code ?? "DOK";
  return `{GG}-${code}-{NNNNN}`;
}

// Vraca poruku greske ili null ako je format validan
export function validirajFormat(format: string): string | null {
  if (!format.trim()) return "Format je obavezan";
  if (format.length > 50) return "Format je predugacak (max 50)";
  let brojaca = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    const t = m[1]!;
    if (/^N{1,8}$/.test(t)) brojaca++;
    else if (!["GGGG", "GG", "MM", "DD"].includes(t)) return `Nepoznat token {${t}}`;
  }
  if (brojaca !== 1) return "Format mora imati tacno jedan brojac ({N} do {NNNNNNNN})";
  return null;
}

export function formatirajBroj(format: string, datum: Date, redniBroj: number): string {
  return format.replace(TOKEN_RE, (m, t: string) => {
    if (/^N{1,8}$/.test(t)) return String(redniBroj).padStart(t.length, "0");
    if (t === "GGGG") return String(datum.getFullYear());
    if (t === "GG") return String(datum.getFullYear()).slice(-2);
    if (t === "MM") return String(datum.getMonth() + 1).padStart(2, "0");
    if (t === "DD") return String(datum.getDate()).padStart(2, "0");
    return m;
  });
}
