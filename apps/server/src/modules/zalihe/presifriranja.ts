import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";
import { dodajPromet } from "./service.js";

const read = requirePrivilege("zalihe", "read");
const write = requirePrivilege("zalihe", "write");

const psfSchema = z.object({
  datum: z.string(),
  napomena: z.string().default(""),
  stavke: z
    .array(
      z.object({
        smer: z.enum(["izlaz", "ulaz"]),
        articleId: z.number(),
        warehouseId: z.number(),
        kolicina: z.number().positive(),
        serijskiBrojevi: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
});

type PsfStavkaInput = z.infer<typeof psfSchema>["stavke"][number];

// Upis stavki nacrta (denormalizacija ident/naziv, bez knjizenja)
async function upisiStavke(tx: typeof db, presifriranjeId: number, stavke: PsfStavkaInput[]) {
  for (const s of stavke) {
    const [artikal] = await tx
      .select({ ident: schema.articles.ident, naziv: schema.articles.naziv })
      .from(schema.articles)
      .where(eq(schema.articles.id, s.articleId));
    if (!artikal) throw new Error("Artikal ne postoji");
    if (s.serijskiBrojevi.length > s.kolicina) {
      throw new Error("Vise serijskih brojeva nego sto je kolicina stavke");
    }
    await tx.insert(schema.presifriranjeStavke).values({
      presifriranjeId,
      smer: s.smer,
      articleId: s.articleId,
      warehouseId: s.warehouseId,
      ident: artikal.ident,
      naziv: artikal.naziv,
      kolicina: s.kolicina.toString(),
      serijskiBrojevi: s.serijskiBrojevi,
    });
  }
}

export async function presifriranjaRoutes(app: FastifyInstance) {
  app.get("/api/presifriranja", { preHandler: read }, async () => {
    return db
      .select({
        id: schema.presifriranja.id,
        broj: schema.presifriranja.broj,
        datum: schema.presifriranja.datum,
        status: schema.presifriranja.status,
        napomena: schema.presifriranja.napomena,
        referent: schema.users.fullName,
      })
      .from(schema.presifriranja)
      .leftJoin(schema.users, eq(schema.presifriranja.userId, schema.users.id))
      .orderBy(desc(schema.presifriranja.id));
  });

  app.get("/api/presifriranja/:id", { preHandler: read }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [p] = await db.select().from(schema.presifriranja).where(eq(schema.presifriranja.id, id));
    if (!p) return reply.code(404).send({ error: "Presifriranje ne postoji" });
    const stavke = await db
      .select()
      .from(schema.presifriranjeStavke)
      .where(eq(schema.presifriranjeStavke.presifriranjeId, id))
      .orderBy(asc(schema.presifriranjeStavke.id));
    return { ...p, stavke };
  });

  app.post("/api/presifriranja", { preHandler: write }, async (req, reply) => {
    const parsed = psfSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const p = parsed.data;
    try {
      const kreiran = await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const godina = new Date().getFullYear();
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${schema.presifriranja.redniBroj}), 0)` })
          .from(schema.presifriranja)
          .where(eq(schema.presifriranja.godina, godina));
        const redniBroj = (max?.n ?? 0) + 1;
        const [red] = await tx
          .insert(schema.presifriranja)
          .values({
            godina,
            redniBroj,
            broj: `${String(godina).slice(-2)}-PSF-${String(redniBroj).padStart(5, "0")}`,
            datum: new Date(`${p.datum.slice(0, 10)}T12:00:00Z`),
            napomena: p.napomena,
            status: "nacrt",
            userId: req.user?.id ?? null,
          })
          .returning();
        await upisiStavke(txdb, red!.id, p.stavke);
        return red!;
      });
      return reply.code(201).send({ id: kreiran.id, broj: kreiran.broj });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Kreiranje nije uspelo" });
    }
  });

  app.put("/api/presifriranja/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = psfSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [stari] = await db.select().from(schema.presifriranja).where(eq(schema.presifriranja.id, id));
    if (!stari) return reply.code(404).send({ error: "Presifriranje ne postoji" });
    if (stari.status !== "nacrt") return reply.code(400).send({ error: "Knjizeno presifriranje se ne moze menjati" });
    const p = parsed.data;
    try {
      await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        await tx.delete(schema.presifriranjeStavke).where(eq(schema.presifriranjeStavke.presifriranjeId, id));
        await upisiStavke(txdb, id, p.stavke);
        await tx
          .update(schema.presifriranja)
          .set({ datum: new Date(`${p.datum.slice(0, 10)}T12:00:00Z`), napomena: p.napomena })
          .where(eq(schema.presifriranja.id, id));
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Izmena nije uspela" });
    }
  });

  // Primena: izlazi prvo (validacija stanja i serijskih), pa ulazi; guard update
  // sprecava duplu primenu. Serijski izlaza se markiraju izlazVrsta='presifriranje',
  // serijski ulaza se upisuju kao novi brojevi.
  app.post("/api/presifriranja/:id/primeni", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      await db.transaction(async (tx) => {
        const txdb = tx as unknown as typeof db;
        const [p] = await tx
          .update(schema.presifriranja)
          .set({ status: "knjizen" })
          .where(and(eq(schema.presifriranja.id, id), eq(schema.presifriranja.status, "nacrt")))
          .returning();
        if (!p) throw new Error("Presifriranje nije nacrt ili ne postoji");
        const stavke = await tx
          .select()
          .from(schema.presifriranjeStavke)
          .where(eq(schema.presifriranjeStavke.presifriranjeId, id))
          .orderBy(asc(schema.presifriranjeStavke.id));
        const izlazi = stavke.filter((s) => s.smer === "izlaz");
        const ulazi = stavke.filter((s) => s.smer === "ulaz");
        if (!izlazi.length || !ulazi.length) throw new Error("Potrebna je bar jedna izlazna i jedna ulazna stavka");
        for (const s of izlazi) {
          const kolicina = Number(s.kolicina);
          const brojevi = (s.serijskiBrojevi ?? []) as string[];
          const [artikal] = await tx
            .select({ serijski: schema.articles.serijskiBrojevi })
            .from(schema.articles)
            .where(eq(schema.articles.id, s.articleId));
          if (artikal?.serijski && brojevi.length !== kolicina) {
            throw new Error(`Artikal ${s.ident} vodi serijske brojeve: izaberite tacno ${kolicina} brojeva`);
          }
          await dodajPromet(txdb, {
            articleId: s.articleId,
            warehouseId: s.warehouseId,
            datum: p.datum,
            kolicina: -kolicina,
            vrsta: "presifriranje",
            refId: p.id,
            userId: req.user?.id ?? null,
          });
          for (const broj of brojevi) {
            const [red] = await tx
              .select({ id: schema.serialNumbers.id })
              .from(schema.serialNumbers)
              .where(
                and(
                  eq(schema.serialNumbers.articleId, s.articleId),
                  eq(schema.serialNumbers.warehouseId, s.warehouseId),
                  eq(schema.serialNumbers.broj, broj),
                  isNull(schema.serialNumbers.izlazId),
                ),
              );
            if (!red) throw new Error(`Serijski broj ${broj} nije na stanju u izlaznom skladistu`);
            await tx
              .update(schema.serialNumbers)
              .set({ izlazId: p.id, izlazVrsta: "presifriranje" })
              .where(eq(schema.serialNumbers.id, red.id));
          }
        }
        for (const s of ulazi) {
          const kolicina = Number(s.kolicina);
          const brojevi = (s.serijskiBrojevi ?? []) as string[];
          const [artikal] = await tx
            .select({ serijski: schema.articles.serijskiBrojevi })
            .from(schema.articles)
            .where(eq(schema.articles.id, s.articleId));
          if (artikal?.serijski && brojevi.length !== kolicina) {
            throw new Error(`Artikal ${s.ident} vodi serijske brojeve: unesite tacno ${kolicina} novih brojeva`);
          }
          await dodajPromet(txdb, {
            articleId: s.articleId,
            warehouseId: s.warehouseId,
            datum: p.datum,
            kolicina,
            vrsta: "presifriranje",
            refId: p.id,
            userId: req.user?.id ?? null,
          });
          for (const broj of brojevi) {
            await tx.insert(schema.serialNumbers).values({
              articleId: s.articleId,
              warehouseId: s.warehouseId,
              broj,
              refId: p.id,
            });
          }
        }
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Primena nije uspela" });
    }
  });

  app.delete("/api/presifriranja/:id", { preHandler: write }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [p] = await db.select().from(schema.presifriranja).where(eq(schema.presifriranja.id, id));
    if (!p) return reply.code(404).send({ error: "Presifriranje ne postoji" });
    if (p.status !== "nacrt") return reply.code(400).send({ error: "Samo nacrt se moze obrisati" });
    await db.delete(schema.presifriranja).where(eq(schema.presifriranja.id, id));
    return { ok: true };
  });
}
