// Integracioni test faze 12 (zavrsnica) - pokrece se rucno:
//   cd apps/server && pnpm tsx --env-file=../../.env src/test-faza12.ts
// Zahteva pokrenut dev server na :3000 i prethodno pokrenut db:seed.
import assert from "node:assert";
import { inArray, like, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";

async function ocisti() {
  await db.delete(schema.documents).where(like(schema.documents.klijentNaziv, "F12%"));
  const stari = await db.select({ id: schema.articles.id }).from(schema.articles).where(sql`ident like 'F12%'`);
  if (stari.length) await db.delete(schema.articles).where(inArray(schema.articles.id, stari.map((a) => a.id)));
  await db.delete(schema.subjects).where(like(schema.subjects.naziv, "F12%"));
  await db.delete(schema.categories).where(like(schema.categories.name, "F12%"));
}

const BASE = "http://localhost:3000";
let cookie = "";
let prosle = 0;

function ok(uslov: boolean, poruka: string) {
  assert(uslov, poruka);
  prosle++;
  console.log(`  ok - ${poruka}`);
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? { cookie } : { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

async function main() {
  await ocisti();
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  ok(login.status === 200 && cookie !== "", "login admin");

  // --- seed default podaci (liste i role) ---
  let r = await call("GET", "/api/liste");
  ok(r.status === 200, "liste dostupne");
  const liste = r.json as { kind: string; internalValue: string; isDefault: boolean; rate: string | null }[];
  // seed garantuje da nijedna vrsta liste nije prazna (postojece podatke ne dira)
  for (const kind of ["porez", "nacin_placanja", "paritet"]) {
    ok(liste.some((l) => l.kind === kind), `lista ${kind} nije prazna posle seed-a`);
  }

  r = await call("GET", "/api/role");
  ok(r.status === 200, "role dostupne");
  const role = r.json as { name: string; privileges: { resource: string; level: string }[] }[];
  for (const naziv of ["Komercijala", "Nabavka", "Magacin"]) {
    const rola = role.find((x) => x.name === naziv);
    ok(!!rola && rola.privileges.length > 0, `rola ${naziv} sa privilegijama`);
  }

  // --- dokumentacija tree: dokumenti-za po subjektu i artiklu ---
  const [klijent] = await db
    .insert(schema.subjects)
    .values({ role: "klijent", naziv: "F12 Kupac", puniNaziv: "F12 Kupac doo", pib: "998877012", mb: "11223312", adresa: "Ulica 1", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [kat] = await db.insert(schema.categories).values({ name: "F12 Kategorija" }).returning();
  const [art] = await db
    .insert(schema.articles)
    .values({ ident: "F12001", naziv: "F12 Artikal", glavnaKategorijaId: kat!.id, prodajnaCena: "500" } as never)
    .returning();

  const danas = new Date().toISOString().slice(0, 10);
  r = await call("POST", "/api/dokumenti", {
    tip: "ponuda", datum: danas, klijentId: klijent!.id, klijentNaziv: "F12 Kupac",
    items: [{ articleId: art!.id, ident: "F12001", naziv: "F12 Artikal", kolicina: 1, cena: 500, popust: 0, porezStopa: 20 }],
  });
  ok(r.status === 201, "kreirana ponuda za tree");

  r = await call("GET", `/api/dokumenti-za?subjekatId=${klijent!.id}`);
  ok(r.status === 200 && r.json.length === 1 && r.json[0].tip === "ponuda", "tree po subjektu vraca ponudu");
  r = await call("GET", `/api/dokumenti-za?artikalId=${art!.id}`);
  ok(r.status === 200 && r.json.length === 1, "tree po artiklu vraca ponudu");

  // --- privilegije: neprijavljen korisnik nema pristup ---
  const anon = await fetch(BASE + "/api/dokumenti?tip=ponuda");
  ok(anon.status === 401, "bez prijave nema pristupa dokumentima");

  await ocisti();
  console.log(`\nFaza 12: svih ${prosle} provera proslo.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Test pao:", e);
  process.exit(1);
});
