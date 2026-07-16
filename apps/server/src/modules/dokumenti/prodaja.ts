import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requireAnyPrivilege } from "../auth/guard.js";
import { DOC_MODULI } from "@albatron/shared";
import { dodajPromet, proveriSerijske } from "../zalihe/service.js";
export { proveriSerijske };

type Tx = typeof db;

interface ProdajaItem {
  articleId: number | null;
  naziv: string;
  kolicina: number;
  serijskiBrojevi?: string[] | null;
}

// Otpremnica (brief 8.8): skida artikle sa stanja bez zaduzenja klijenta.
// Ponovno snimanje prvo ponisti prethodno knjizenje; serijski brojevi se
// oznacavaju izlazom (izlazId) umesto brisanja da bi izmena bila reverzibilna.
export async function knjiziIzlaz(
  tx: Tx,
  doc: { id: number; datum: Date; skladisteId: number | null },
  items: ProdajaItem[],
  userId: number | null,
) {
  const stari = await tx
    .select()
    .from(schema.stockLedger)
    .where(and(eq(schema.stockLedger.vrsta, "izlaz"), eq(schema.stockLedger.refId, doc.id)));
  for (const s of stari) {
    await tx
      .delete(schema.stockSnapshots)
      .where(
        and(
          eq(schema.stockSnapshots.articleId, s.articleId),
          eq(schema.stockSnapshots.warehouseId, s.warehouseId),
          gte(schema.stockSnapshots.mesec, s.datum.toISOString().slice(0, 7)),
        ),
      );
  }
  await tx
    .delete(schema.stockLedger)
    .where(and(eq(schema.stockLedger.vrsta, "izlaz"), eq(schema.stockLedger.refId, doc.id)));
  await tx.update(schema.serialNumbers).set({ izlazId: null }).where(eq(schema.serialNumbers.izlazId, doc.id));

  await proveriSerijske(tx, items);
  // ponytail: bez skladista nema knjizenja (modul zaliha iskljucen) - samo dokument
  if (!doc.skladisteId) return;
  const datum = new Date(`${doc.datum.toISOString().slice(0, 10)}T12:00:00Z`);
  for (const i of items) {
    if (!i.articleId) continue;
    // zabrana izdavanja preko stanja (brief 8.8) - dodajPromet baca gresku
    await dodajPromet(tx, {
      articleId: i.articleId,
      warehouseId: doc.skladisteId,
      datum,
      kolicina: -Number(i.kolicina),
      vrsta: "izlaz",
      refId: doc.id,
      userId,
    });
    for (const broj of i.serijskiBrojevi ?? []) {
      const [red] = await tx
        .select({ id: schema.serialNumbers.id })
        .from(schema.serialNumbers)
        .where(
          and(
            eq(schema.serialNumbers.articleId, i.articleId),
            eq(schema.serialNumbers.warehouseId, doc.skladisteId),
            eq(schema.serialNumbers.broj, broj),
            isNull(schema.serialNumbers.izlazId),
          ),
        );
      if (!red) throw new Error(`Serijski broj ${broj} (${i.naziv}) nije na stanju izdajnog skladišta`);
      await tx.update(schema.serialNumbers).set({ izlazId: doc.id }).where(eq(schema.serialNumbers.id, red.id));
    }
  }
}

// Iskorisceni deo avansa (suma veza) po avansu
export async function iskoriscenoAvansa(tx: Tx, avansId: number) {
  const [r] = await tx
    .select({ s: sql<string>`coalesce(sum(${schema.avansVeze.iznos}), 0)` })
    .from(schema.avansVeze)
    .where(eq(schema.avansVeze.avansId, avansId));
  return Number(r?.s ?? 0);
}

// Suma racuna sa PDV (bez opcionih stavki)
async function sumaRacuna(tx: Tx, racunId: number) {
  const [r] = await tx
    .select({
      s: sql<string>`coalesce(sum(${schema.documentItems.kolicina} * ${schema.documentItems.cena} * (1 - ${schema.documentItems.popust} / 100) * (1 + ${schema.documentItems.porezStopa} / 100)), 0)`,
    })
    .from(schema.documentItems)
    .where(and(eq(schema.documentItems.documentId, racunId), eq(schema.documentItems.opcioni, false)));
  return Number(r?.s ?? 0);
}

// Vezivanje avansa za racun (brief 8.10): max do preostalog avansa ili preostale
// vrednosti racuna (sta je manje); avans se arhivira kad padne na 0.
export async function veziAvans(tx: Tx, avansId: number, racunId: number, iznos: number) {
  const [avans] = await tx.select().from(schema.documents).where(eq(schema.documents.id, avansId));
  if (!avans || avans.tip !== "avansni_racun") throw new Error("Avansni račun ne postoji");
  const [racun] = await tx.select().from(schema.documents).where(eq(schema.documents.id, racunId));
  if (!racun || racun.tip !== "racun") throw new Error("Račun ne postoji");
  const preostaloAvansa = Number(avans.avansIznos ?? 0) - (await iskoriscenoAvansa(tx, avansId));
  const naRacunu = await avansiRacuna(tx, racunId);
  const preostaloRacuna = (await sumaRacuna(tx, racunId)) - naRacunu.ukupno;
  const max = Math.min(preostaloAvansa, preostaloRacuna);
  if (iznos <= 0 || iznos > max + 0.005) {
    throw new Error(`Iznos mora biti između 0 i ${max.toFixed(2)} (preostali avans / preostala vrednost računa)`);
  }
  await tx.insert(schema.avansVeze).values({ avansId, racunId, iznos: iznos.toFixed(2) });
  if (preostaloAvansa - iznos < 0.005) {
    await tx.update(schema.documents).set({ status: "arhiva" }).where(eq(schema.documents.id, avansId));
  }
}

// Odvezivanje avansa od racuna (RP8, st.25): brise vezu avans-racun i vraca
// iskorisceni iznos; arhivirani avans se vraca u opticaj ako ponovo ima preostalo.
export async function odveziAvans(tx: Tx, avansId: number, racunId: number) {
  const obrisane = await tx
    .delete(schema.avansVeze)
    .where(and(eq(schema.avansVeze.avansId, avansId), eq(schema.avansVeze.racunId, racunId)))
    .returning({ id: schema.avansVeze.id });
  if (obrisane.length === 0) throw new Error("Veza ne postoji");
  const [avans] = await tx.select().from(schema.documents).where(eq(schema.documents.id, avansId));
  if (avans?.status === "arhiva") {
    const preostalo = Number(avans.avansIznos ?? 0) - (await iskoriscenoAvansa(tx, avansId));
    if (preostalo > 0.005) {
      await tx.update(schema.documents).set({ status: "poslato" }).where(eq(schema.documents.id, avansId));
    }
  }
}

// Avansi vezani za racun - za finansijsku sekciju i izvestaj (brief 8.10)
export async function avansiRacuna(tx: Tx, racunId: number) {
  const veze = await tx
    .select({
      avansId: schema.avansVeze.avansId,
      iznos: schema.avansVeze.iznos,
      broj: schema.documents.broj,
      predracunBroj: schema.documents.avansPredracunBroj,
    })
    .from(schema.avansVeze)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.avansVeze.avansId))
    .where(eq(schema.avansVeze.racunId, racunId));
  return {
    veze: veze.map((v) => ({ ...v, iznos: Number(v.iznos) })),
    ukupno: veze.reduce((s, v) => s + Number(v.iznos), 0),
  };
}

export async function prodajaRoutes(app: FastifyInstance) {
  const read = requireAnyPrivilege(DOC_MODULI, "read");
  const write = requireAnyPrivilege(DOC_MODULI, "write");

  // Otvoreni avansi (brief 8.10): preostalo > 0; otvoreni moraju biti vidljivi u obracunima
  app.get("/api/avansi/otvoreni", { preHandler: read }, async (req) => {
    const { predracunId } = req.query as { predracunId?: string };
    let avansi = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.tip, "avansni_racun"))
      .orderBy(desc(schema.documents.id));
    if (predracunId) {
      // samo avansi vezani (documentLinks) za dati predracun
      const linkovi = await db
        .select()
        .from(schema.documentLinks)
        .where(eq(schema.documentLinks.fromId, Number(predracunId)));
      const ids = new Set(linkovi.map((l) => l.toId));
      avansi = avansi.filter((a) => ids.has(a.id));
    }
    const rezultat = [];
    for (const a of avansi) {
      const iskorisceno = await iskoriscenoAvansa(db, a.id);
      const preostalo = Number(a.avansIznos ?? 0) - iskorisceno;
      if (preostalo > 0.005) {
        rezultat.push({
          id: a.id,
          broj: a.broj,
          klijentNaziv: a.klijentNaziv,
          predracunBroj: a.avansPredracunBroj,
          iznos: Number(a.avansIznos ?? 0),
          iskorisceno,
          preostalo,
        });
      }
    }
    return rezultat;
  });

  // Rucno/retroaktivno vezivanje avansa za racun (brief 8.10)
  app.post("/api/avansi/:id/vezi", { preHandler: write }, async (req, reply) => {
    const avansId = Number((req.params as { id: string }).id);
    const parsed = z.object({ racunId: z.number(), iznos: z.number() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    try {
      await db.transaction(async (tx) => {
        await veziAvans(tx as unknown as Tx, avansId, parsed.data.racunId, parsed.data.iznos);
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška" });
    }
  });

  // Odvezivanje avansa od racuna (RP8, st.25)
  app.post("/api/avansi/:id/odvezi", { preHandler: write }, async (req, reply) => {
    const avansId = Number((req.params as { id: string }).id);
    const parsed = z.object({ racunId: z.number() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Neispravan zahtev" });
    try {
      await db.transaction(async (tx) => {
        await odveziAvans(tx as unknown as Tx, avansId, parsed.data.racunId);
      });
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Greška" });
    }
  });

  // Dokumenti ciljnog tipa "u izradi" - prenos na postojeci dokument (brief 8.9)
  app.get("/api/dokumenti-u-izradi", { preHandler: read }, async (req, reply) => {
    const { tip } = req.query as { tip?: string };
    if (!tip) return reply.code(400).send({ error: "tip je obavezan" });
    return db
      .select({
        id: schema.documents.id,
        broj: schema.documents.broj,
        klijentNaziv: schema.documents.klijentNaziv,
        datum: schema.documents.datum,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.tip, tip), inArray(schema.documents.status, ["u izradi", "u obradi"])))
      .orderBy(desc(schema.documents.id));
  });
}
