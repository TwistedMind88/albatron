import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import Parser from "rss-parser";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db, schema } from "../../db/index.js";

// --- SSRF zastita za korisnicki zadat RSS URL ---
// Blokira privatne/loopback/link-local/reserved adrese: bez ovoga bi prijavljen
// korisnik mogao naterati server da dohvati internu adresu (metadata, localhost, LAN).
function jePrivatanIpv4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function jePrivatanIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return jePrivatanIpv4(ip);
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return jePrivatanIpv4(mapped[1]!);
    if (/^fe[89ab]/.test(low)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(low)) return true; // ULA fc00::/7
    if (/^ff/.test(low)) return true; // multicast
    return false;
  }
  return true; // nije validan IP = blokiraj
}

// ponytail: DNS se razresava ovde pa fetch ponovo razresava (TOCTOU/rebinding
// rezidual); prihvatljivo za LAN alat. Pinovati razreseni IP tek ako zatreba.
async function siguranHost(host: string): Promise<boolean> {
  if (isIP(host)) return !jePrivatanIp(host);
  try {
    const adrese = await lookup(host, { all: true });
    return adrese.length > 0 && adrese.every((a) => !jePrivatanIp(a.address));
  } catch {
    return false;
  }
}

// Dashboard agregati (plan 20, faza 4). Licni podaci - gejtovani samo attachUser-om.
export async function dashboardRoutes(app: FastifyInstance) {
  // Moji dokumenti u izradi: sve tipove, referent = tekuci korisnik, status "u izradi".
  app.get("/api/dashboard/moji-dokumenti", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    return db
      .select({
        id: schema.documents.id,
        tip: schema.documents.tip,
        broj: schema.documents.broj,
        datum: schema.documents.datum,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.referentId, req.user.id), eq(schema.documents.status, "u izradi")))
      .orderBy(desc(schema.documents.datum))
      .limit(50);
  });

  // --- Faza 6: RSS + kursna lista ---
  // Server-side fetch: izbegava CORS i drzi feed van klijenta. Kes sa TTL-om.
  // ponytail: in-memory kes, jedna instanca; tabela ako ikad multi-instanca.

  const rssParser = new Parser({ timeout: 10000 });
  const RSS_TTL = 10 * 60 * 1000; // 10 min
  const rssKes = new Map<string, { data: RssRezultat; fetchedAt: number }>();

  // RSS/Atom feed: server dohvati i isparsira, klijent samo prikaze.
  app.get<{ Querystring: { url?: string } }>("/api/dashboard/rss", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const url = req.query.url;
    if (!url) return reply.code(400).send({ error: "Neispravan URL" });
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return reply.code(400).send({ error: "Neispravan URL" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reply.code(400).send({ error: "Neispravan URL" });
    }
    if (!(await siguranHost(parsed.hostname))) {
      return reply.code(400).send({ error: "Nedozvoljen host" });
    }

    const kesirano = rssKes.get(url);
    if (kesirano && Date.now() - kesirano.fetchedAt < RSS_TTL) return kesirano.data;

    try {
      // Sopstveni fetch (ne rssParser.parseURL) da bismo zabranili redirekt -
      // redirekt na internu adresu zaobisao bi siguranHost proveru.
      const res = await fetch(parsed, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (Albatron dashboard)" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status >= 300 && res.status < 400) throw new Error("redirect");
      if (!res.ok) throw new Error("http " + res.status);
      const buf = await res.arrayBuffer();
      // ponytail: kap posle preuzimanja (timeout ogranicava trajanje); streaming
      // limit tek ako download-bomba postane problem.
      if (buf.byteLength > 2 * 1024 * 1024) throw new Error("prevelik");
      const feed = await rssParser.parseString(new TextDecoder().decode(buf));
      const data: RssRezultat = {
        title: feed.title ?? url,
        items: (feed.items ?? []).slice(0, 15).map((i) => ({
          title: i.title ?? "(bez naslova)",
          link: i.link ?? "",
          pubDate: i.pubDate ?? i.isoDate ?? "",
        })),
      };
      rssKes.set(url, { data, fetchedAt: Date.now() });
      return data;
    } catch {
      return reply.code(502).send({ error: "Feed nije dostupan ili je neispravan" });
    }
  });

  // Kursna lista (EUR/USD/GBP srednji kurs prema RSD). Kes: jedna vrednost dnevno.
  // ponytail: regex nad fiksnim gadget formatom; ako se HTML promeni, vrati error
  // state umesto pada. Zvanicni NBS SOAP servis kao rezerva ako izvor nestane.
  const KURS_URL = "https://kursna-lista.com/gedzeti/gadget3white.php";
  let kursKes: { datum: string; data: KursRezultat } | null = null;

  app.get("/api/dashboard/kurs", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const danas = new Date().toISOString().slice(0, 10);
    if (kursKes && kursKes.datum === danas) return kursKes.data;

    try {
      const res = await fetch(KURS_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (Albatron dashboard)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("http " + res.status);
      const html = await res.text();
      // Gadget je HTML sa tagovima izmedju valute i broja - skini tagove pa parsiraj.
      const tekst = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
      const m = tekst.match(/EUR\s+([\d.,]+)[\s\S]*?USD\s+([\d.,]+)[\s\S]*?GBP\s+([\d.,]+)/);
      if (!m) throw new Error("format");
      const broj = (s: string) => Number(s.replace(",", "."));
      const data: KursRezultat = {
        datum: danas,
        kursevi: [
          { valuta: "EUR", srednji: broj(m[1]!) },
          { valuta: "USD", srednji: broj(m[2]!) },
          { valuta: "GBP", srednji: broj(m[3]!) },
        ],
      };
      kursKes = { datum: danas, data };
      return data;
    } catch {
      return reply.code(502).send({ error: "Kursna lista trenutno nije dostupna" });
    }
  });
}

interface RssRezultat {
  title: string;
  items: { title: string; link: string; pubDate: string }[];
}
interface KursRezultat {
  datum: string;
  kursevi: { valuta: string; srednji: number }[];
}
