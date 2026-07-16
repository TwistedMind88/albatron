// Integracioni test faze 13 (opcioni artikli, numeracija, discontinued) - pokrece se rucno:
//   cd apps/server && pnpm tsx --env-file=../../.env src/test-faza13.ts
// Zahteva pokrenut dev server na :3000.
import assert from "node:assert";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";

async function ocisti() {
  await db.delete(schema.documents).where(like(schema.documents.klijentNaziv, "F13%"));
  const stari = await db.select({ id: schema.articles.id }).from(schema.articles).where(sql`ident like 'F13%'`);
  if (stari.length) await db.delete(schema.articles).where(inArray(schema.articles.id, stari.map((a) => a.id)));
  await db.delete(schema.pricelists).where(like(schema.pricelists.naziv, "F13%"));
  await db.delete(schema.subjects).where(like(schema.subjects.naziv, "F13%"));
  await db.delete(schema.categories).where(like(schema.categories.name, "F13%"));
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "numeracija"));
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

  const [klijent] = await db
    .insert(schema.subjects)
    .values({ role: "klijent", naziv: "F13 Kupac", puniNaziv: "F13 Kupac doo", pib: "998877013", mb: "11223313", adresa: "Ulica 1", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [dobavljac] = await db
    .insert(schema.subjects)
    .values({ role: "dobavljac", naziv: "F13 Dobavljac", puniNaziv: "F13 Dobavljac doo", pib: "998877113", mb: "11223413", adresa: "Ulica 2", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [kat] = await db.insert(schema.categories).values({ name: "F13 Kategorija" }).returning();
  const danas = new Date().toISOString().slice(0, 10);

  // --- 1. opcioni artikli u izvestaju: dve tabele, sume bez opcionih ---
  let r = await call("POST", "/api/dokumenti", {
    tip: "ponuda", datum: danas, klijentId: klijent!.id, klijentNaziv: "F13 Kupac",
    items: [
      { ident: "F13R", naziv: "F13 Redovan", kolicina: 1, cena: 100, popust: 0, porezStopa: 20 },
      { ident: "F13O", naziv: "F13 Opcioni", kolicina: 1, cena: 999, popust: 0, porezStopa: 20, opcioni: true },
    ],
  });
  ok(r.status === 201, "kreirana ponuda sa opcionom stavkom");
  const ponudaId = r.json.id;

  const izv = await fetch(`${BASE}/api/dokumenti/${ponudaId}/izvestaj`, { headers: { cookie } });
  const html = await izv.text();
  ok(izv.status === 200, "izvestaj se renderuje");
  ok(html.includes("Opcioni artikli"), "izvestaj sadrzi tabelu opcionih");
  const glavni = html.split("Opcioni artikli")[0]!;
  const opcioniDeo = html.split("Opcioni artikli")[1]!;
  ok(glavni.includes("F13 Redovan") && !glavni.includes("F13 Opcioni"), "glavna tabela bez opcionih");
  ok(opcioniDeo.includes("F13 Opcioni"), "opcioni artikal u drugoj tabeli");
  ok(html.includes("120,00"), "ukupno racuna samo redovne (100 + 20% PDV)");

  // --- 2. numeracija: format po tipu, validacija ---
  r = await call("PUT", "/api/numeracija", { predracun: "{GGGG}-011-{NNN}" });
  ok(r.status === 200, "format numeracije snimljen");
  r = await call("PUT", "/api/numeracija", { predracun: "bez brojaca" });
  ok(r.status === 400, "format bez brojaca odbijen");
  r = await call("GET", "/api/numeracija");
  ok(r.json.predracun === "{GGGG}-011-{NNN}", "format se cita iz podesavanja");

  r = await call("POST", "/api/dokumenti", {
    tip: "predracun", datum: danas, klijentId: klijent!.id, klijentNaziv: "F13 Kupac",
    items: [{ ident: "F13R", naziv: "F13 Redovan", kolicina: 1, cena: 100, popust: 0, porezStopa: 20 }],
  });
  const god = new Date().getFullYear();
  const ocekivanPrefix = `${god}-011-`;
  ok(r.status === 201 && String(r.json.broj).startsWith(ocekivanPrefix) && String(r.json.broj).length === ocekivanPrefix.length + 3,
    `predracun numerisan po formatu (${r.json.broj})`);

  // --- 3. cenovnik sa discontinued stavkama ---
  await db.insert(schema.articles).values({ ident: "F13A1", naziv: "F13 Aktivan", glavnaKategorijaId: kat!.id, dobavljacId: dobavljac!.id, sku: "F13-SKU-1", prodajnaCena: "100" } as never);
  r = await call("POST", "/api/cenovnici", {
    naziv: "F13 Cenovnik", dobavljacId: dobavljac!.id, valuta: "EUR", vaziOd: danas,
    items: [
      { sku: "F13-SKU-1", naziv: "Artikal 1", cena: 10, discontinued: true },
      { sku: "F13-SKU-2", naziv: "Artikal 2", cena: 20 },
    ],
  });
  ok(r.status === 201, "cenovnik sa discontinued stavkom uvezen");
  const cenovnikId = r.json.id;

  r = await call("GET", `/api/cenovnici/${cenovnikId}`);
  const stavke = r.json.items as { sku: string; discontinued: boolean }[];
  ok(stavke.find((s) => s.sku === "F13-SKU-1")?.discontinued === true, "stavka nosi discontinued flag");
  ok(stavke.find((s) => s.sku === "F13-SKU-2")?.discontinued === false, "obicna stavka bez flaga");

  r = await call("GET", `/api/cenovnici/${cenovnikId}/novi-discontinued`);
  ok(r.status === 200 && r.json.length === 1 && r.json[0].sku === "F13-SKU-1", "novi-discontinued vraca aktivan artikal");
  const artikalId = r.json[0].id;

  r = await call("POST", "/api/artikli-discontinued", { ids: [artikalId] });
  ok(r.status === 200, "artikal oznacen discontinued");
  r = await call("GET", `/api/cenovnici/${cenovnikId}/novi-discontinued`);
  ok(r.json.length === 0, "oznacen artikal vise nije u listi");

  await ocisti();
  console.log(`\nFaza 13: svih ${prosle} provera proslo.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Test pao:", e);
  process.exit(1);
});
