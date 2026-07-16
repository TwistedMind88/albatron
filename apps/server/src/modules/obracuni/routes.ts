import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { requirePrivilege } from "../auth/guard.js";

const read = requirePrivilege("obracuni", "read");

// suma dokumenta bez PDV, bez opcionih stavki (isto kao lista dokumenata)
const sumaSql = sql<string>`coalesce((select sum(${schema.documentItems.kolicina} * ${schema.documentItems.cena} * (1 - ${schema.documentItems.popust} / 100)) from ${schema.documentItems} where ${schema.documentItems.documentId} = ${schema.documents.id} and not ${schema.documentItems.opcioni}), 0)`;

// Obracuni (brief 9): preseci nad svim dokumentima i artiklima.
// Default sve ukljuceno - filter se primenjuje samo ako je prosledjen.
export async function obracuniRoutes(app: FastifyInstance) {
  app.get("/api/obracun/dokumenti", { preHandler: read }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const w: SQL[] = [];
    if (q.tipovi) w.push(inArray(schema.documents.tip, q.tipovi.split(",")));
    // multi-izbor filteri (faza 14.4, stavke 59-64): comma-separated liste
    if (q.statusi) w.push(inArray(schema.documents.status, q.statusi.split(",")));
    if (q.klijenti) w.push(inArray(schema.documents.klijentId, q.klijenti.split(",").map(Number)));
    if (q.klijent) w.push(ilike(schema.documents.klijentNaziv, `%${q.klijent}%`));
    if (q.referent) w.push(ilike(schema.users.fullName, `%${q.referent}%`));
    if (q.datumOd) w.push(gte(schema.documents.datum, new Date(q.datumOd)));
    if (q.datumDo) w.push(lte(schema.documents.datum, new Date(`${q.datumDo}T23:59:59`)));
    if (q.sumaOd) w.push(sql`${sumaSql} >= ${Number(q.sumaOd)}`);
    if (q.sumaDo) w.push(sql`${sumaSql} <= ${Number(q.sumaDo)}`);
    // stavke (stavka 63): naziv i ident artikla su odvojena polja
    if (q.artikal) {
      w.push(
        sql`exists (select 1 from ${schema.documentItems} where ${schema.documentItems.documentId} = ${schema.documents.id} and ${schema.documentItems.naziv} ilike ${`%${q.artikal}%`})`,
      );
    }
    if (q.ident) {
      w.push(
        sql`exists (select 1 from ${schema.documentItems} where ${schema.documentItems.documentId} = ${schema.documents.id} and ${schema.documentItems.ident} ilike ${`%${q.ident}%`})`,
      );
    }
    // primarna ili sekundarna kategorija artikla sa dokumenta (stavka 64: multi)
    if (q.kategorije) {
      const kids = q.kategorije.split(",").map(Number);
      w.push(
        sql`exists (select 1 from ${schema.documentItems} join ${schema.articles} on ${schema.articles.id} = ${schema.documentItems.articleId} where ${schema.documentItems.documentId} = ${schema.documents.id} and (${inArray(schema.articles.glavnaKategorijaId, kids)} or ${inArray(schema.articles.sekundarnaKategorijaId, kids)}))`,
      );
    }

    return db
      .select({
        id: schema.documents.id,
        tip: schema.documents.tip,
        broj: schema.documents.broj,
        datum: schema.documents.datum,
        status: schema.documents.status,
        klijentNaziv: schema.documents.klijentNaziv,
        referencaKupca: schema.documents.referencaKupca,
        valuta: schema.documents.valuta,
        referent: schema.users.fullName,
        suma: sumaSql,
        // otvoreni avans (brief 9.1): preostalo za vezivanje na avansnom racunu
        avansOtvoreno: sql<string | null>`case when ${schema.documents.tip} = 'avansni_racun' then coalesce(${schema.documents.avansIznos}, 0) - coalesce((select sum(${schema.avansVeze.iznos}) from ${schema.avansVeze} where ${schema.avansVeze.avansId} = ${schema.documents.id}), 0) end`,
      })
      .from(schema.documents)
      .leftJoin(schema.users, eq(schema.documents.referentId, schema.users.id))
      .where(w.length ? and(...w) : undefined)
      .orderBy(desc(schema.documents.datum), desc(schema.documents.id));
  });

  // lista referenata koji se pojavljuju na dokumentima (stavka 62: autocomplete)
  app.get("/api/obracun/referenti", { preHandler: read }, async () => {
    return db
      .select({ referent: schema.users.fullName })
      .from(schema.documents)
      .innerJoin(schema.users, eq(schema.documents.referentId, schema.users.id))
      .groupBy(schema.users.fullName)
      .orderBy(schema.users.fullName);
  });

  app.get("/api/obracun/artikli", { preHandler: read }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const w: SQL[] = [];
    if (q.tip) w.push(eq(schema.articles.tip, q.tip));
    if (q.dobavljacId) w.push(eq(schema.articles.dobavljacId, Number(q.dobavljacId)));
    if (q.kategorijaId) {
      const kid = Number(q.kategorijaId);
      w.push(
        sql`(${schema.articles.glavnaKategorijaId} = ${kid} or ${schema.articles.sekundarnaKategorijaId} = ${kid})`,
      );
    }
    if (q.cenaOd) w.push(sql`${schema.articles.prodajnaCena} >= ${Number(q.cenaOd)}`);
    if (q.cenaDo) w.push(sql`${schema.articles.prodajnaCena} <= ${Number(q.cenaDo)}`);
    // klijent/period: artikal se pojavljuje na dokumentu tog klijenta / u periodu
    if (q.klijent || q.datumOd || q.datumDo) {
      const uslovi: SQL[] = [
        sql`${schema.documentItems.articleId} = ${schema.articles.id}`,
        sql`${schema.documents.id} = ${schema.documentItems.documentId}`,
      ];
      if (q.klijent) uslovi.push(sql`${schema.documents.klijentNaziv} ilike ${`%${q.klijent}%`}`);
      if (q.datumOd) uslovi.push(sql`${schema.documents.datum} >= ${new Date(q.datumOd)}`);
      if (q.datumDo) uslovi.push(sql`${schema.documents.datum} <= ${new Date(`${q.datumDo}T23:59:59`)}`);
      w.push(
        sql`exists (select 1 from ${schema.documentItems}, ${schema.documents} where ${and(...uslovi)})`,
      );
    }

    return db
      .select({
        id: schema.articles.id,
        ident: schema.articles.ident,
        naziv: schema.articles.naziv,
        tip: schema.articles.tip,
        sku: schema.articles.sku,
        prodajnaCena: schema.articles.prodajnaCena,
        prodajnaValuta: schema.articles.prodajnaValuta,
        dobavljac: schema.subjects.naziv,
      })
      .from(schema.articles)
      .leftJoin(schema.subjects, eq(schema.articles.dobavljacId, schema.subjects.id))
      .where(w.length ? and(...w) : undefined)
      .orderBy(schema.articles.ident);
  });
}
