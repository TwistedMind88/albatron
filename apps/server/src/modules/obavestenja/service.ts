import { and, eq, or } from "drizzle-orm";
import { db as globalDb, schema } from "../../db/index.js";

type Db = typeof globalDb;

export interface ObavestenjeUlaz {
  userIds: number[];
  tip: string;
  naslov: string;
  tekst?: string;
  linkTip?: "dokument" | "zadatak";
  linkId?: number;
  osim?: number; // akter - iskljucuje se iz primalaca
}

// Batch insert obavestenja; iskljucuje aktera i duplikate primalaca.
export async function obavesti(db: Db, u: ObavestenjeUlaz): Promise<void> {
  const primaoci = [...new Set(u.userIds)].filter((id) => id !== u.osim);
  if (primaoci.length === 0) return;
  await db.insert(schema.obavestenja).values(
    primaoci.map((userId) => ({
      userId,
      tip: u.tip,
      naslov: u.naslov,
      tekst: u.tekst ?? "",
      linkTip: u.linkTip ?? null,
      linkId: u.linkId ?? null,
    })),
  );
}

// Nadje pretplatnike za (tip [+ dokumentTip]) i posalje im obavestenje.
// Poklapanje: pretplata bez dokumentTip-a ('') hvata sve tipove dokumenata.
export async function obavestiPretplatnike(
  db: Db,
  filter: { tip: string; dokumentTip?: string; osim?: number },
  payload: Omit<ObavestenjeUlaz, "userIds" | "tip" | "osim">,
): Promise<void> {
  const uslov = filter.dokumentTip
    ? and(
        eq(schema.obavestenjaPretplate.tip, filter.tip),
        or(
          eq(schema.obavestenjaPretplate.dokumentTip, ""),
          eq(schema.obavestenjaPretplate.dokumentTip, filter.dokumentTip),
        ),
      )
    : eq(schema.obavestenjaPretplate.tip, filter.tip);
  const rows = await db
    .select({ userId: schema.obavestenjaPretplate.userId })
    .from(schema.obavestenjaPretplate)
    .where(uslov);
  await obavesti(db, { ...payload, tip: filter.tip, userIds: rows.map((r) => r.userId), osim: filter.osim });
}
