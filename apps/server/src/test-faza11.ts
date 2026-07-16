// Integracioni test faze 11 (obracuni i projekti) - pokrece se rucno:
//   cd apps/server && pnpm tsx --env-file=../../.env src/test-faza11.ts
// Zahteva pokrenut dev server na :3000 i upisuje F11* test podatke u dev bazu.
import assert from "node:assert";
import { inArray, like, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";

// ciscenje podataka prethodnog pokretanja - test je idempotentan
async function ocisti() {
  await db.delete(schema.projects).where(like(schema.projects.naziv, "F11%"));
  await db.delete(schema.documents).where(like(schema.documents.klijentNaziv, "F11%"));
  const stari = await db.select({ id: schema.articles.id }).from(schema.articles).where(sql`ident like 'F11%'`);
  if (stari.length) await db.delete(schema.articles).where(inArray(schema.articles.id, stari.map((a) => a.id)));
  await db.delete(schema.subjects).where(like(schema.subjects.naziv, "F11%"));
  await db.delete(schema.categories).where(like(schema.categories.name, "F11%"));
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

  // --- setup: klijent, kategorija, artikal, dokumenti ---
  const [klijent] = await db
    .insert(schema.subjects)
    .values({ role: "klijent", naziv: "F11 Kupac", puniNaziv: "F11 Kupac doo", pib: "998877011", mb: "11223311", adresa: "Ulica 1", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [kat] = await db.insert(schema.categories).values({ name: "F11 Kategorija" }).returning();
  const [art] = await db
    .insert(schema.articles)
    .values({ ident: "F11001", naziv: "F11 Artikal", glavnaKategorijaId: kat!.id, prodajnaCena: "500" } as never)
    .returning();

  const danas = new Date().toISOString().slice(0, 10);
  let r = await call("POST", "/api/dokumenti", {
    tip: "ponuda", datum: danas, klijentId: klijent!.id, klijentNaziv: "F11 Kupac",
    items: [{ articleId: art!.id, ident: "F11001", naziv: "F11 Artikal", kolicina: 2, cena: 500, popust: 0, porezStopa: 20 }],
  });
  ok(r.status === 201, "kreirana ponuda");
  const ponudaId = r.json.id as number;

  r = await call("POST", "/api/dokumenti", {
    tip: "avansni_racun", datum: danas, klijentId: klijent!.id, klijentNaziv: "F11 Kupac",
    avansOsnovica: 100, avansIznos: 120, items: [],
  });
  ok(r.status === 201, "kreiran avansni racun");

  // --- obracun dokumenti (brief 9.1) ---
  r = await call("GET", "/api/obracun/dokumenti?klijent=F11");
  ok(r.status === 200 && r.json.length === 2, "obracun: filter po klijentu nalazi oba dokumenta");
  const avans = r.json.find((d: any) => d.tip === "avansni_racun");
  ok(Number(avans.avansOtvoreno) === 120, "obracun: otvoreni avans vidljiv (120)");

  r = await call("GET", "/api/obracun/dokumenti?klijent=F11&tipovi=ponuda");
  ok(r.json.length === 1 && r.json[0].tip === "ponuda", "obracun: filter po tipu");

  r = await call("GET", "/api/obracun/dokumenti?klijent=F11&artikal=F11001");
  ok(r.json.length === 1 && r.json[0].id === ponudaId, "obracun: filter po artiklu (ident)");

  r = await call("GET", `/api/obracun/dokumenti?klijent=F11&kategorijaId=${kat!.id}`);
  ok(r.json.length === 1 && r.json[0].id === ponudaId, "obracun: filter po kategoriji artikla");

  r = await call("GET", "/api/obracun/dokumenti?klijent=F11&sumaOd=900&sumaDo=1100");
  ok(r.json.length === 1 && Number(r.json[0].suma) === 1000, "obracun: filter po sumi (1000 bez PDV)");

  r = await call("GET", "/api/obracun/dokumenti?klijent=F11&datumOd=2099-01-01");
  ok(r.json.length === 0, "obracun: filter po periodu iskljucuje sve");

  // --- obracun artikli (brief 9.2) ---
  r = await call("GET", "/api/obracun/artikli?klijent=F11");
  ok(r.status === 200 && r.json.length === 1 && r.json[0].ident === "F11001", "obracun artikli: po klijentu na dokumentima");

  r = await call("GET", `/api/obracun/artikli?kategorijaId=${kat!.id}&cenaOd=400&cenaDo=600`);
  ok(r.json.length === 1, "obracun artikli: kategorija + raspon cene");

  r = await call("GET", "/api/obracun/artikli?klijent=F11&datumOd=2099-01-01");
  ok(r.json.length === 0, "obracun artikli: period iskljucuje");

  // --- projekti (brief 13) ---
  r = await call("POST", "/api/projekti", {
    naziv: "F11 Projekat", klijentId: klijent!.id, ocekivanja: "Etapna isporuka",
    planPocetak: danas, planKraj: null,
  });
  ok(r.status === 201, "kreiran projekat");
  const projId = r.json.id as number;

  r = await call("PUT", `/api/projekti/${projId}`, {
    naziv: "F11 Projekat", klijentId: klijent!.id, status: "u toku", ocekivanja: "Etapna isporuka",
    planPocetak: danas, planKraj: danas,
  });
  ok(r.status === 200 && r.json.status === "u toku", "izmena projekta (status)");

  r = await call("POST", `/api/projekti/${projId}/dokumenti`, { documentId: ponudaId });
  ok(r.status === 201, "dokument pridruzen projektu");
  const vezaId = r.json.id as number;

  r = await call("POST", `/api/projekti/${projId}/dokumenti`, { documentId: ponudaId });
  ok(r.status === 400, "duplo pridruzivanje odbijeno");

  r = await call("POST", `/api/projekti/${projId}/stavke`, {
    vrsta: "napomena", datum: danas, tekst: "Prva napomena",
  });
  ok(r.status === 201, "dodata napomena");

  r = await call("POST", `/api/projekti/${projId}/stavke`, {
    vrsta: "komunikacija", osoba: "Pera Peric", datum: danas, tekst: "Poslata ponuda mailom",
  });
  ok(r.status === 201, "dodata komunikacija");
  const komId = r.json.id as number;

  r = await call("POST", `/api/projekti/${projId}/stavke`, {
    vrsta: "ucesnik", osoba: "Mika Mikic", datum: danas, tekst: "",
  });
  ok(r.status === 201, "dodat ucesnik");

  r = await call("GET", `/api/projekti/${projId}`);
  ok(r.status === 200 && r.json.klijentNaziv === "F11 Kupac", "detalj projekta sa klijentom");
  ok(r.json.dokumenti.length === 1 && r.json.dokumenti[0].broj, "hronologija: pridruzeni dokument");
  ok(r.json.stavke.length === 3, "hronologija: 3 stavke");
  ok(r.json.stavke.find((s: any) => s.vrsta === "komunikacija")?.osoba === "Pera Peric", "komunikacija sa posiljaocem");

  r = await call("DELETE", `/api/projekti/stavke/${komId}`);
  ok(r.status === 200, "brisanje stavke");

  r = await call("DELETE", `/api/projekti/${projId}/dokumenti/${vezaId}`);
  ok(r.status === 200, "uklanjanje dokumenta sa projekta");

  r = await call("GET", `/api/projekti/${projId}`);
  ok(r.json.stavke.length === 2 && r.json.dokumenti.length === 0, "stanje posle brisanja");

  r = await call("GET", "/api/projekti");
  ok(r.json.some((p: any) => p.naziv === "F11 Projekat" && p.klijentNaziv === "F11 Kupac"), "lista projekata");

  console.log(`\nSve proslo: ${prosle} provera.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("PAO TEST:", e);
  process.exit(1);
});
