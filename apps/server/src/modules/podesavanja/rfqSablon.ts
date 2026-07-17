import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { requireAdmin } from "../auth/guard.js";

// Export upita za dobavljaca po xlsx sablonu: SVA specificna konfiguracija
// (template fajl kao base64 + naziv dobavljaca + mapiranje celija i sekcija)
// zivi u bazi (appSettings) - javni kod ne sadrzi nista vezano za konkretnog
// dobavljaca, a update instalacije (pregazi kod, bazu ne dira) je ne brise.
// Bez konfiguracije opcija exporta se ne prikazuje.

const celija = z.string().regex(/^[A-Z]{1,2}[0-9]{1,3}$/);
const kolona = z.string().regex(/^[A-Z]{1,2}$/);

const sablonSchema = z.object({
  label: z.string().min(1),
  imeFajla: z.string().min(1),
  dobavljacNaziv: z.string().min(1),
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
  // code-a glavne kategorije artikla; slotova = broj redova u sablonu
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
  templateBase64: z.string().min(1),
});

export type RfqSablon = z.infer<typeof sablonSchema>;

const KEY = "rfq_sablon";

export async function getRfqSablon(): Promise<RfqSablon | null> {
  const row = (await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)))[0];
  if (!row) return null;
  const parsed = sablonSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

export async function rfqSablonRoutes(app: FastifyInstance) {
  // info za meni kalkulacije i prikaz u podesavanjima - bez sadrzaja template-a
  app.get("/api/rfq-sablon", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    const cfg = await getRfqSablon();
    if (!cfg) return null;
    const { templateBase64: _t, ...info } = cfg;
    return info;
  });

  app.put("/api/rfq-sablon", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = sablonSchema.safeParse(req.body);
    if (!parsed.success) {
      const prva = parsed.error.issues[0];
      return reply.code(400).send({ error: `Neispravna konfiguracija: ${prva?.path.join(".")} - ${prva?.message}` });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(parsed.data.templateBase64)) {
      return reply.code(400).send({ error: "Neispravna konfiguracija: templateBase64 nije base64" });
    }
    await db
      .insert(schema.appSettings)
      .values({ key: KEY, value: parsed.data })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: parsed.data } });
    return { ok: true };
  });

  app.delete("/api/rfq-sablon", { preHandler: requireAdmin }, async () => {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, KEY));
    return { ok: true };
  });
}
