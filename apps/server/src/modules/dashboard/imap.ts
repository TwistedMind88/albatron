import type { FastifyInstance } from "fastify";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";

export interface ImapCfg {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  folder?: string;
}

// ponytail: bez konekcijskog pool-a - connect/fetch/logout po zahtevu.
// LAN alat, mali broj korisnika; dodati pool tek ako latencija zasmeta.
export function imapKlijent(cfg: ImapCfg): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // ne drzi konekciju - jedna operacija pa logout
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

// Ucitava IMAP podesavanja tekuceg korisnika iz baze.
async function korisnikovImap(userId: number): Promise<ImapCfg | null> {
  const rows = await db
    .select({ imap: schema.users.imap })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return (rows[0]?.imap as ImapCfg | null) ?? null;
}

interface Poruka {
  folder: string;
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
}

// Read-only IMAP widget (plan 20, faza 7). Licni podaci - samo attachUser.
export function imapRoutes(app: FastifyInstance) {
  // Lista foldera (za izbor u podešavanjima / config-u widgeta).
  app.get("/api/dashboard/imap/folders", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const cfg = await korisnikovImap(req.user.id);
    if (!cfg?.host) return reply.code(400).send({ error: "IMAP nije podešen" });

    const client = imapKlijent(cfg);
    try {
      await client.connect();
      const mboxes = await client.list();
      // delimiter za tree prikaz (podfolderi) u config-u vidzeta
      return mboxes.map((m) => ({ path: m.path, delimiter: m.delimiter ?? "/" }));
    } catch (err) {
      return reply.code(502).send({ error: `IMAP: ${(err as Error).message}` });
    } finally {
      await client.logout().catch(() => {});
    }
  });

  // Lista poruka - jedan ili vise foldera (folders=a,b), najnovije prvo, spojeno.
  app.get<{ Querystring: { folder?: string; folders?: string; limit?: string } }>(
    "/api/dashboard/imap/poruke",
    async (req, reply) => {
      if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
      const cfg = await korisnikovImap(req.user.id);
      if (!cfg?.host) return reply.code(400).send({ error: "IMAP nije podešen" });

      const lista = (req.query.folders || req.query.folder || cfg.folder || "INBOX")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

      const client = imapKlijent(cfg);
      try {
        await client.connect();
        const poruke: Poruka[] = [];
        // jedna konekcija, redom zakljucava svaki folder (getMailboxLock je serijski)
        for (const folder of lista) {
          const lock = await client.getMailboxLock(folder);
          try {
            const total = typeof client.mailbox === "object" ? client.mailbox.exists : 0;
            if (total === 0) continue;
            const od = Math.max(1, total - limit + 1);
            for await (const m of client.fetch(`${od}:${total}`, {
              uid: true,
              envelope: true,
              flags: true,
            })) {
              poruke.push({
                folder,
                uid: m.uid,
                from: m.envelope?.from?.[0]?.address ?? "",
                subject: m.envelope?.subject ?? "(bez naslova)",
                date: m.envelope?.date?.toISOString() ?? "",
                seen: m.flags?.has("\\Seen") ?? false,
              });
            }
          } finally {
            lock.release();
          }
        }
        // spojeno iz svih foldera - najnovije prvo, pa odseci na limit
        poruke.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        return poruke.slice(0, limit);
      } catch (err) {
        return reply.code(502).send({ error: `IMAP: ${(err as Error).message}` });
      } finally {
        await client.logout().catch(() => {});
      }
    },
  );

  // Jedna poruka - pun tekst (read-only prikaz). Fetch source + MIME parse.
  app.get<{ Querystring: { folder?: string; uid?: string } }>(
    "/api/dashboard/imap/poruka",
    async (req, reply) => {
      if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
      const cfg = await korisnikovImap(req.user.id);
      if (!cfg?.host) return reply.code(400).send({ error: "IMAP nije podešen" });

      const folder = req.query.folder || cfg.folder || "INBOX";
      const uid = Number(req.query.uid);
      if (!uid) return reply.code(400).send({ error: "Neispravan uid" });

      const client = imapKlijent(cfg);
      try {
        await client.connect();
        const lock = await client.getMailboxLock(folder);
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) return reply.code(404).send({ error: "Poruka ne postoji" });
          const parsed = await simpleParser(msg.source);
          return {
            subject: parsed.subject ?? "(bez naslova)",
            from: parsed.from?.text ?? "",
            to: parsed.to
              ? Array.isArray(parsed.to)
                ? parsed.to.map((a) => a.text).join(", ")
                : parsed.to.text
              : "",
            date: parsed.date?.toISOString() ?? "",
            text: parsed.text ?? "",
            html: typeof parsed.html === "string" ? parsed.html : "",
          };
        } finally {
          lock.release();
        }
      } catch (err) {
        return reply.code(502).send({ error: `IMAP: ${(err as Error).message}` });
      } finally {
        await client.logout().catch(() => {});
      }
    },
  );
}
