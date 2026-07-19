import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, schema } from "../../db/index.js";
import { requireAdmin } from "../auth/guard.js";

// Export upita za dobavljaca po xlsx sablonu: SVA specificna konfiguracija
// (template fajl kao base64 + veza sa dobavljacem + mapiranje celija i sekcija)
// zivi u bazi (appSettings) - javni kod ne sadrzi nista vezano za konkretnog
// dobavljaca, a update instalacije (pregazi kod, bazu ne dira) je ne brise.
// Vise konfiguracija = vise opcija exporta u meniju kalkulacije; bez ijedne
// konfiguracije opcija se ne prikazuje.

const celija = z.string().regex(/^[A-Z]{1,2}[0-9]{1,3}$/);
const kolona = z.string().regex(/^[A-Z]{1,2}$/);

// zajednicka polja mapiranja (dolaze iz JSON fajla korisnika)
const mapiranjeSchema = z.object({
  imeFajla: z.string().min(1),
  sheet: z.string().min(1),
  // fiksne semantike -> adresa celije u sablonu; izostavljeno polje se ne upisuje
  polja: z
    .object({
      puniNaziv: celija,
      adresa: celija,
      drzava: celija,
      grad: celija,
      postanskiBroj: celija,
      kontaktIme: celija,
      kontaktPrezime: celija,
      kontaktEmail: celija,
      kontaktTelefon: celija,
    })
    .partial(),
  // sekcije proizvoda: stavka ide u sekciju ciji prefiks odgovara pocetku
  // code-a glavne kategorije artikla; slotova = broj redova u sablonu;
  // prazan kodPrefiksi = catch-all sekcija (prima sve sto druge ne prime)
  sekcije: z
    .array(
      z.object({
        naslov: z.string().min(1),
        prviRed: z.number().int().positive(),
        slotova: z.number().int().positive(),
        kodPrefiksi: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  pnKolona: kolona,
  kolicinaKolona: kolona,
});

// stari oblik (jedna konfiguracija pod kljucem rfq_sablon) - samo za migraciju
const legacySchema = mapiranjeSchema.extend({
  label: z.string().min(1),
  dobavljacNaziv: z.string().min(1),
  templateBase64: z.string().min(1),
});

const sablonSchema = mapiranjeSchema.extend({
  id: z.string().min(1),
  label: z.string().min(1),
  // dobavljac po id-u (novi nacin); dobavljacNaziv ostaje kao fallback za migrirane
  dobavljacId: z.number().int().positive().optional(),
  dobavljacNaziv: z.string().min(1).optional(),
  templateBase64: z.string().min(1),
});

const listaSchema = z.object({ sabloni: z.array(sablonSchema) });

export type RfqSablon = z.infer<typeof sablonSchema>;

const KEY = "rfq_sabloni";
const LEGACY_KEY = "rfq_sablon";

async function upisiListu(sabloni: RfqSablon[]) {
  const value = { sabloni };
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

export async function getRfqSabloni(): Promise<RfqSablon[]> {
  const row = (await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)))[0];
  if (row) {
    const parsed = listaSchema.safeParse(row.value);
    return parsed.success ? parsed.data.sabloni : [];
  }
  // migracija stare pojedinacne konfiguracije u listu (jednokratno, pri prvom citanju)
  const legacy = (
    await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, LEGACY_KEY))
  )[0];
  if (!legacy) return [];
  const parsed = legacySchema.safeParse(legacy.value);
  if (!parsed.success) return [];
  const [dobavljac] = await db
    .select({ id: schema.subjects.id })
    .from(schema.subjects)
    .where(eq(schema.subjects.naziv, parsed.data.dobavljacNaziv));
  const sablon: RfqSablon = { id: randomUUID(), dobavljacId: dobavljac?.id, ...parsed.data };
  await upisiListu([sablon]);
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, LEGACY_KEY));
  return [sablon];
}

const noviBodySchema = sablonSchema.omit({ id: true });
const izmenaBodySchema = noviBodySchema.extend({ templateBase64: z.string().min(1).optional() });

function proveriBody(body: unknown, zaIzmenu: boolean) {
  const parsed = (zaIzmenu ? izmenaBodySchema : noviBodySchema).safeParse(body);
  if (!parsed.success) {
    const prva = parsed.error.issues[0];
    return { greska: `Neispravna konfiguracija: ${prva?.path.join(".")} - ${prva?.message}` } as const;
  }
  if (parsed.data.dobavljacId === undefined && parsed.data.dobavljacNaziv === undefined) {
    return { greska: "Neispravna konfiguracija: dobavljac nije izabran" } as const;
  }
  if (parsed.data.templateBase64 && !/^[A-Za-z0-9+/=]+$/.test(parsed.data.templateBase64)) {
    return { greska: "Neispravna konfiguracija: templateBase64 nije base64" } as const;
  }
  return { data: parsed.data } as const;
}

export async function rfqSablonRoutes(app: FastifyInstance) {
  // info za meni kalkulacije i prikaz u podesavanjima - bez sadrzaja template-a
  app.get("/api/rfq-sabloni", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const sabloni = await getRfqSabloni();
    return sabloni.map(({ templateBase64: _t, ...info }) => info);
  });

  app.post("/api/rfq-sabloni", { preHandler: requireAdmin }, async (req, reply) => {
    const r = proveriBody(req.body, false);
    if ("greska" in r) return reply.code(400).send({ error: r.greska });
    const sabloni = await getRfqSabloni();
    const sablon: RfqSablon = { id: randomUUID(), ...r.data, templateBase64: r.data.templateBase64! };
    await upisiListu([...sabloni, sablon]);
    return { ok: true, id: sablon.id };
  });

  app.put("/api/rfq-sabloni/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const sabloni = await getRfqSabloni();
    const postojeci = sabloni.find((s) => s.id === id);
    if (!postojeci) return reply.code(404).send({ error: "Konfiguracija ne postoji" });
    const r = proveriBody(req.body, true);
    if ("greska" in r) return reply.code(400).send({ error: r.greska });
    // bez novog template-a zadrzava se postojeci
    const noviSablon: RfqSablon = {
      ...r.data,
      id,
      templateBase64: r.data.templateBase64 ?? postojeci.templateBase64,
    };
    await upisiListu(sabloni.map((s) => (s.id === id ? noviSablon : s)));
    return { ok: true };
  });

  app.delete("/api/rfq-sabloni/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const sabloni = await getRfqSabloni();
    if (!sabloni.some((s) => s.id === id)) return reply.code(404).send({ error: "Konfiguracija ne postoji" });
    await upisiListu(sabloni.filter((s) => s.id !== id));
    return { ok: true };
  });
}
