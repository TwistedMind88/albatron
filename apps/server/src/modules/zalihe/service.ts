import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";

type Tx = typeof db;

function mesecOd(d: Date) {
  return d.toISOString().slice(0, 7); // 'YYYY-MM'
}

function krajMeseca(mesec: string) {
  const [g, m] = mesec.split("-").map(Number);
  return new Date(Date.UTC(g!, m!, 0, 23, 59, 59, 999)); // dan 0 sledeceg = poslednji dan
}

// Stanje artikla u skladistu na kraju datog dana:
// poslednji snapshot pre tog datuma + suma ledgera posle snapshota do datuma.
export async function stanjeNaDan(
  tx: Tx,
  articleId: number,
  warehouseId: number,
  datum: Date,
): Promise<number> {
  const [snap] = await tx
    .select()
    .from(schema.stockSnapshots)
    .where(
      and(
        eq(schema.stockSnapshots.articleId, articleId),
        eq(schema.stockSnapshots.warehouseId, warehouseId),
        sql`${schema.stockSnapshots.mesec} < ${mesecOd(datum)}`,
      ),
    )
    .orderBy(sql`${schema.stockSnapshots.mesec} desc`)
    .limit(1);
  const od = snap ? krajMeseca(snap.mesec) : null;
  const uslovi = [
    eq(schema.stockLedger.articleId, articleId),
    eq(schema.stockLedger.warehouseId, warehouseId),
    lte(schema.stockLedger.datum, datum),
  ];
  if (od) uslovi.push(gt(schema.stockLedger.datum, od));
  const [suma] = await tx
    .select({ s: sql<string>`coalesce(sum(${schema.stockLedger.kolicina}), 0)` })
    .from(schema.stockLedger)
    .where(and(...uslovi));
  return Number(snap?.kolicina ?? 0) + Number(suma?.s ?? 0);
}

// Blokada snimanja bez serijskih brojeva (brief 8.8, 8.9): za artikle koji ih vode,
// broj unetih mora odgovarati kolicini.
export async function proveriSerijske(
  tx: Tx,
  items: { articleId: number | null; naziv: string; kolicina: number; serijskiBrojevi?: string[] | null }[],
) {
  for (const i of items) {
    if (!i.articleId) continue;
    const [a] = await tx
      .select({ serijskiBrojevi: schema.articles.serijskiBrojevi })
      .from(schema.articles)
      .where(eq(schema.articles.id, i.articleId));
    const brojevi = i.serijskiBrojevi ?? [];
    if (a?.serijskiBrojevi && brojevi.length !== Number(i.kolicina)) {
      throw new Error(
        `Artikal "${i.naziv}" vodi serijske brojeve: uneto ${brojevi.length}, potrebno ${Number(i.kolicina)}`,
      );
    }
  }
}

// Upis prometa. Za skidanje (kolicina < 0) proverava da stanje na dan prometa
// i svakog kasnijeg dana ne pada ispod nule (brief 12: greska ako robe nije bilo na dan).
export async function dodajPromet(
  tx: Tx,
  p: {
    articleId: number;
    warehouseId: number;
    datum: Date;
    kolicina: number;
    vrsta: string;
    refId?: number | null;
    userId?: number | null;
  },
) {
  if (p.kolicina < 0) {
    const stanje = await stanjeNaDan(tx, p.articleId, p.warehouseId, p.datum);
    if (stanje + p.kolicina < 0) {
      throw new Error(
        `Nema dovoljno na stanju na dan ${p.datum.toISOString().slice(0, 10)} (stanje: ${stanje})`,
      );
    }
    // buduce promene ne smeju otici u minus zbog ovog skidanja
    const buduci = await tx
      .select({ kolicina: schema.stockLedger.kolicina })
      .from(schema.stockLedger)
      .where(
        and(
          eq(schema.stockLedger.articleId, p.articleId),
          eq(schema.stockLedger.warehouseId, p.warehouseId),
          gt(schema.stockLedger.datum, p.datum),
        ),
      )
      .orderBy(asc(schema.stockLedger.datum), asc(schema.stockLedger.id));
    let tekuce = stanje + p.kolicina;
    for (const b of buduci) {
      tekuce += Number(b.kolicina);
      if (tekuce < 0) throw new Error("Skidanje bi odvelo kasnije stanje u minus");
    }
  }
  // promet u proslosti obara snapshote od tog meseca nadalje
  await tx
    .delete(schema.stockSnapshots)
    .where(
      and(
        eq(schema.stockSnapshots.articleId, p.articleId),
        eq(schema.stockSnapshots.warehouseId, p.warehouseId),
        gte(schema.stockSnapshots.mesec, mesecOd(p.datum)),
      ),
    );
  await tx.insert(schema.stockLedger).values({
    articleId: p.articleId,
    warehouseId: p.warehouseId,
    datum: p.datum,
    kolicina: p.kolicina.toString(),
    vrsta: p.vrsta,
    refId: p.refId ?? null,
    userId: p.userId ?? null,
  });
  // lenja izrada snapshota za poslednji zavrseni mesec
  const sad = new Date();
  const prosliMesec = mesecOd(new Date(Date.UTC(sad.getUTCFullYear(), sad.getUTCMonth(), 0)));
  const [postoji] = await tx
    .select({ id: schema.stockSnapshots.id })
    .from(schema.stockSnapshots)
    .where(
      and(
        eq(schema.stockSnapshots.articleId, p.articleId),
        eq(schema.stockSnapshots.warehouseId, p.warehouseId),
        eq(schema.stockSnapshots.mesec, prosliMesec),
      ),
    );
  if (!postoji) {
    const kolicina = await stanjeNaDan(tx, p.articleId, p.warehouseId, krajMeseca(prosliMesec));
    await tx.insert(schema.stockSnapshots).values({
      articleId: p.articleId,
      warehouseId: p.warehouseId,
      mesec: prosliMesec,
      kolicina: kolicina.toString(),
    });
  }
}
