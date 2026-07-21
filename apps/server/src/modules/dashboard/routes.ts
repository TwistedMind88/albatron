import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import Parser from "rss-parser";
import { db, schema } from "../../db/index.js";

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
    if (!url || !/^https?:\/\//i.test(url)) return reply.code(400).send({ error: "Neispravan URL" });

    const kesirano = rssKes.get(url);
    if (kesirano && Date.now() - kesirano.fetchedAt < RSS_TTL) return kesirano.data;

    try {
      const feed = await rssParser.parseURL(url);
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
      const m = html.match(/EUR\s+([\d.,]+)[\s\S]*?USD\s+([\d.,]+)[\s\S]*?GBP\s+([\d.,]+)/);
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
