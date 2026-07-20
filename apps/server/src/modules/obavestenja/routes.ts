import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";

// Obavestenja su licni podaci - gejtovana samo prijavom (attachUser), bez privilegije.
function gate(req: { user: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
  return null;
}

export async function obavestenjaRoutes(app: FastifyInstance) {
  app.get("/api/obavestenja", async (req, reply) => {
    if (gate(req, reply)) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 50, 200);
    return db
      .select()
      .from(schema.obavestenja)
      .where(eq(schema.obavestenja.userId, req.user!.id))
      .orderBy(desc(schema.obavestenja.createdAt))
      .limit(limit);
  });

  app.get("/api/obavestenja/broj-nepr", async (req, reply) => {
    if (gate(req, reply)) return;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.obavestenja)
      .where(and(eq(schema.obavestenja.userId, req.user!.id), eq(schema.obavestenja.procitano, false)));
    return { n: row?.n ?? 0 };
  });

  app.post("/api/obavestenja/:id/procitano", async (req, reply) => {
    if (gate(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    await db
      .update(schema.obavestenja)
      .set({ procitano: true })
      .where(and(eq(schema.obavestenja.id, id), eq(schema.obavestenja.userId, req.user!.id)));
    return { ok: true };
  });

  app.post("/api/obavestenja/procitano-sve", async (req, reply) => {
    if (gate(req, reply)) return;
    await db
      .update(schema.obavestenja)
      .set({ procitano: true })
      .where(eq(schema.obavestenja.userId, req.user!.id));
    return { ok: true };
  });

  app.get("/api/obavestenja/pretplate", async (req, reply) => {
    if (gate(req, reply)) return;
    return db
      .select({ tip: schema.obavestenjaPretplate.tip, dokumentTip: schema.obavestenjaPretplate.dokumentTip })
      .from(schema.obavestenjaPretplate)
      .where(eq(schema.obavestenjaPretplate.userId, req.user!.id));
  });

  app.put("/api/obavestenja/pretplate", async (req, reply) => {
    if (gate(req, reply)) return;
    const parsed = z
      .object({ items: z.array(z.object({ tip: z.string().min(1), dokumentTip: z.string().default("") })) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    await db.transaction(async (tx) => {
      await tx.delete(schema.obavestenjaPretplate).where(eq(schema.obavestenjaPretplate.userId, req.user!.id));
      if (parsed.data.items.length) {
        await tx.insert(schema.obavestenjaPretplate).values(
          parsed.data.items.map((i) => ({ userId: req.user!.id, tip: i.tip, dokumentTip: i.dokumentTip })),
        );
      }
    });
    return { ok: true };
  });
}
