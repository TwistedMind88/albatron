// Integracioni test faze 10 (prodajni lanac) - pokrece se rucno:
//   cd apps/server && pnpm tsx --env-file=../../.env src/test-faza10.ts
// Zahteva pokrenut dev server na :3000 i upisuje F10* test podatke u dev bazu.
import assert from "node:assert";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";

// ciscenje podataka prethodnog pokretanja - test je idempotentan
async function ocisti() {
  await db.delete(schema.documents).where(like(schema.documents.klijentNaziv, "F10%"));
  const stari = await db.select({ id: schema.articles.id }).from(schema.articles).where(sql`ident like 'F10%'`);
  if (stari.length) await db.delete(schema.articles).where(inArray(schema.articles.id, stari.map((a) => a.id)));
  await db.delete(schema.subjects).where(like(schema.subjects.naziv, "F10%"));
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
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as Record<string, unknown> & { error?: string } };
}

async function main() {
  await ocisti();
  // --- setup: login ---
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  ok(login.status === 200 && cookie !== "", "login admin");

  // --- setup: modul zaliha + primarno skladiste + subjekti + artikli (direktno u bazi) ---
  await db
    .insert(schema.appSettings)
    .values({ key: "moduli", value: { zalihe: true } })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: { zalihe: true } } });
  let [skl] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.isPrimary, true));
  if (!skl) [skl] = await db.insert(schema.warehouses).values({ naziv: "F10 Glavno", isPrimary: true }).returning();

  const [klijent] = await db
    .insert(schema.subjects)
    .values({ role: "klijent", naziv: "F10 Kupac", puniNaziv: "F10 Kupac doo", pib: "998877001", mb: "11223301", adresa: "Ulica 1", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [dobavljac] = await db
    .insert(schema.subjects)
    .values({ role: "dobavljac", naziv: "F10 Dob", puniNaziv: "F10 Dob doo", pib: "998877002", mb: "11223302", adresa: "Ulica 2", postanskiBroj: "11000", grad: "Beograd" } as never)
    .returning();
  const [a1] = await db
    .insert(schema.articles)
    .values({ ident: "F10001", naziv: "F10 Obican artikal", tip: "roba", dobavljacId: dobavljac!.id } as never)
    .returning();
  const [a2] = await db
    .insert(schema.articles)
    .values({ ident: "F10002", naziv: "F10 Serijski artikal", tip: "roba", serijskiBrojevi: true, dobavljacId: dobavljac!.id } as never)
    .returning();

  // ulaz na stanje: A1 x10, A2 x2 sa serijskim brojevima
  let r = await call("POST", "/api/zalihe/ulaz", {
    articleId: a1!.id, warehouseId: skl!.id, datum: new Date().toISOString(), kolicina: 10, serijskiBrojevi: [],
  });
  ok(r.status === 201, "test ulaz A1 x10");
  r = await call("POST", "/api/zalihe/ulaz", {
    articleId: a2!.id, warehouseId: skl!.id, datum: new Date().toISOString(), kolicina: 2, serijskiBrojevi: ["SN-F10-1", "SN-F10-2"],
  });
  ok(r.status === 201, "test ulaz A2 x2 + serijski");

  // --- predracun: A1 x10 @100 (20%), A2 x2 @50 (20%) ---
  const danas = new Date().toISOString().slice(0, 10);
  const stavka = (aid: number, ident: string, naziv: string, kolicina: number, cena: number) => ({
    articleId: aid, ident, naziv, kolicina, cena, popust: 0, porezStopa: 20,
  });
  r = await call("POST", "/api/dokumenti", {
    tip: "predracun", datum: danas, klijentId: klijent!.id, klijentNaziv: "F10 Kupac",
    items: [stavka(a1!.id, "F10001", "F10 Obican artikal", 10, 100), stavka(a2!.id, "F10002", "F10 Serijski artikal", 2, 50)],
  });
  ok(r.status === 201, "predracun kreiran");
  const predracunId = r.json.id as number;

  // --- avansni racun iz predracuna (brief 8.10) ---
  r = await call("POST", `/api/dokumenti/${predracunId}/generisi`, { tip: "avansni_racun", items: [] });
  ok(r.status === 201, "avansni racun generisan iz predracuna");
  const avansId = r.json.id as number;
  const avansDoc = (await call("GET", `/api/dokumenti/${avansId}`)).json;
  ok(avansDoc.avansPredracunBroj !== "", "avans pamti broj predracuna");
  // upis uplacene sume: 500 bez PDV / 600 sa PDV
  const { id: _x, tip: _t, broj: _b, items: _i, veze: _v, referent: _r2, avansi: _a, avansIskorisceno: _ai, ...avansHeader } = avansDoc;
  r = await call("PUT", `/api/dokumenti/${avansId}`, {
    ...avansHeader, datum: danas, vaziDo: null, datumFakture: null,
    avansOsnovica: 500, avansIznos: 600, items: [],
  });
  ok(r.status === 200, "avans: upisana suma 600 sa PDV");

  // --- otpremnica iz predracuna, delimicno: A1 6 od 10 (brief 8.9) ---
  r = await call("POST", `/api/dokumenti/${predracunId}/generisi`, {
    tip: "otpremnica", items: [{ id: null, kolicina: null }],
  });
  const predracun = (await call("GET", `/api/dokumenti/${predracunId}`)).json;
  const pItems = predracun.items as { id: number; articleId: number; prenetaKolicina: string }[];
  const pA1 = pItems.find((x) => x.articleId === a1!.id)!;
  const pA2 = pItems.find((x) => x.articleId === a2!.id)!;
  r = await call("POST", `/api/dokumenti/${predracunId}/generisi`, {
    tip: "otpremnica", items: [{ id: pA1.id, kolicina: 6 }],
  });
  ok(r.status === 201, "otpremnica generisana (A1: 6 od 10)");
  const otpremnicaId = r.json.id as number;
  {
    const p2 = (await call("GET", `/api/dokumenti/${predracunId}`)).json;
    const it = (p2.items as typeof pItems).find((x) => x.articleId === a1!.id)!;
    ok(Number(it.prenetaKolicina) === 6, "preneta kolicina na predracunu = 6");
  }
  // prekoracenje: jos 6 ne moze (preostalo 4)
  r = await call("POST", `/api/dokumenti/${predracunId}/generisi`, {
    tip: "otpremnica", items: [{ id: pA1.id, kolicina: 6 }],
  });
  ok(r.status === 400, "prenos preko preostale kolicine odbijen");

  // --- prenos A2 na POSTOJECU otpremnicu (vise izvora / zbir, brief 8.9) ---
  r = await call("POST", `/api/dokumenti/${predracunId}/generisi`, {
    tip: "otpremnica", items: [{ id: pA2.id, kolicina: 2 }], uDokumentId: otpremnicaId,
  });
  ok(r.status === 201 && (r.json.id as number) === otpremnicaId, "prenos na postojecu otpremnicu");

  // --- snimanje otpremnice: bez serijskih blokirano, sa serijskim skida stanje (brief 8.8) ---
  const otp = (await call("GET", `/api/dokumenti/${otpremnicaId}`)).json;
  const { id: _o1, tip: _o2, broj: _o3, veze: _o5, referent: _o6, avansi: _o7, avansIskorisceno: _o8, ...otpHeader } = otp;
  const otpItems = (otp.items as (Record<string, unknown> & { articleId: number | null })[]).map((i) => ({
    ...i, kolicina: Number(i.kolicina), cena: Number(i.cena), popust: Number(i.popust),
    porezStopa: Number(i.porezStopa), prenetaKolicina: Number(i.prenetaKolicina),
    nabavnaCena: i.nabavnaCena === null ? null : Number(i.nabavnaCena),
    transportTrosak: i.transportTrosak === null ? null : Number(i.transportTrosak),
  }));
  const telo = { ...otpHeader, items: undefined, datum: danas, vaziDo: null, datumFakture: null, skladisteId: skl!.id };
  r = await call("PUT", `/api/dokumenti/${otpremnicaId}`, { ...telo, items: otpItems });
  ok(r.status === 400 && (r.json.error ?? "").includes("serijske"), "snimanje bez serijskih brojeva blokirano");
  const saSerijskim = otpItems.map((i) =>
    i.articleId === a2!.id ? { ...i, serijskiBrojevi: ["SN-F10-1", "SN-F10-2"] } : i,
  );
  r = await call("PUT", `/api/dokumenti/${otpremnicaId}`, { ...telo, items: saSerijskim });
  ok(r.status === 200, "otpremnica snimljena sa serijskim brojevima");
  {
    const st = (await call("GET", `/api/zalihe/stanje?articleId=${a1!.id}&warehouseId=${skl!.id}`)).json;
    ok(Number(st.stanje) === 4, "stanje A1 posle otpremnice = 4 (10 - 6)");
    const sn = await call("GET", `/api/artikli/${a2!.id}/serijski-brojevi?skladisteId=${skl!.id}`);
    ok(Array.isArray(sn.json) && (sn.json as unknown as unknown[]).length === 0, "serijski brojevi A2 skinuti sa stanja");
  }
  // zabrana izdavanja preko stanja
  r = await call("POST", "/api/dokumenti", {
    tip: "otpremnica", datum: danas, klijentId: klijent!.id, klijentNaziv: "F10 Kupac", skladisteId: skl!.id,
    items: [stavka(a1!.id, "F10001", "F10 Obican artikal", 100, 100)],
  });
  ok(r.status === 400, "izdavanje preko stanja odbijeno");

  // --- automatski datum otpremnice u obradi (brief 8.8) ---
  await db
    .update(schema.documents)
    .set({ datum: new Date(Date.now() - 2 * 86400000), status: "u obradi" })
    .where(eq(schema.documents.id, otpremnicaId));
  await call("GET", "/api/dokumenti?tip=otpremnica");
  {
    const [red] = await db.select().from(schema.documents).where(eq(schema.documents.id, otpremnicaId));
    ok(red!.datum.toISOString().slice(0, 10) === danas, "datum otpremnice u obradi automatski na tekuci dan");
  }

  // --- racun iz otpremnice: arhivira je, nasledjuje serijske (brief 8.8, 8.9) ---
  const otp2 = (await call("GET", `/api/dokumenti/${otpremnicaId}`)).json;
  const oItems = otp2.items as { id: number; articleId: number; serijskiBrojevi: string[] | null }[];
  r = await call("POST", `/api/dokumenti/${otpremnicaId}/generisi`, {
    tip: "racun", items: oItems.map((i) => ({ id: i.id, kolicina: null })),
  });
  ok(r.status === 201, "racun generisan iz otpremnice");
  const racunId = r.json.id as number;
  {
    const o3 = (await call("GET", `/api/dokumenti/${otpremnicaId}`)).json;
    ok(o3.status === "arhiva", "otpremnica arhivirana posle kreiranja racuna");
    const rac = (await call("GET", `/api/dokumenti/${racunId}`)).json;
    const rA2 = (rac.items as typeof oItems).find((x) => x.articleId === a2!.id)!;
    ok((rA2.serijskiBrojevi ?? []).length === 2, "racun nasledio serijske brojeve");
  }

  // --- vezivanje avansa: delimicno, do preostalog, arhiva na 0 (brief 8.10) ---
  // racun: A1 6x100x1.2 + A2 2x50x1.2 = 720 + 120 = 840 sa PDV; avans 600
  r = await call("POST", `/api/avansi/${avansId}/vezi`, { racunId, iznos: 10000 });
  ok(r.status === 400, "vezivanje preko preostalog odbijeno");
  r = await call("POST", `/api/avansi/${avansId}/vezi`, { racunId, iznos: 300 });
  ok(r.status === 200, "avans delimicno vezan (300 od 600)");
  {
    const rac = (await call("GET", `/api/dokumenti/${racunId}`)).json;
    const av = rac.avansi as { ukupno: number };
    ok(Math.abs(av.ukupno - 300) < 0.01, "racun vidi avansno uplaceno 300");
    const otvoreni = (await call("GET", "/api/avansi/otvoreni")).json as unknown as { id: number; preostalo: number }[];
    const moj = otvoreni.find((a) => a.id === avansId);
    ok(moj !== undefined && Math.abs(moj.preostalo - 300) < 0.01, "avans otvoren sa preostalih 300");
  }
  r = await call("POST", `/api/avansi/${avansId}/vezi`, { racunId, iznos: 300 });
  ok(r.status === 200, "avans potrosen do kraja");
  {
    const av = (await call("GET", `/api/dokumenti/${avansId}`)).json;
    ok(av.status === "arhiva", "avans automatski arhiviran na 0");
    const otvoreni = (await call("GET", "/api/avansi/otvoreni")).json as unknown as { id: number }[];
    ok(!otvoreni.some((a) => a.id === avansId), "potrosen avans nije medju otvorenima");
  }

  // --- spakovana kolicina u obracunu narudzbina (brief 8.5 + 8.8) ---
  r = await call("POST", "/api/porudzbine/obracun", {
    dobavljacId: dobavljac!.id, statusi: ["u izradi"], skladista: [], zaLager: false, od: "min", dop: "opt", prijemni: [],
  });
  {
    const rows = (r.json.rows ?? []) as { articleId: number; potrebe: number }[];
    const red = rows.find((x) => x.articleId === a1!.id);
    ok(red !== undefined && red.potrebe === 4, "obracun: potreba A1 = 4 (10 - 6 spakovano)");
    ok(!rows.some((x) => x.articleId === a2!.id), "obracun: A2 potpuno spakovan, nema potrebe");
  }

  console.log(`\nSVI TESTOVI PROSLI (${prosle})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("PAO:", e);
    process.exit(1);
  });
