import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
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
}
