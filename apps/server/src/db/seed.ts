import { eq } from "drizzle-orm";
import { db, schema } from "./index.js";
import { hashPassword } from "../modules/auth/password.js";

// Kreira admin nalog ako ne postoji (admin / admin123 - promeniti posle prve prijave)
const existing = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.username, "admin"));

if (existing.length === 0) {
  await db.insert(schema.users).values({
    username: "admin",
    passwordHash: hashPassword("admin123"),
    fullName: "Administrator",
    isAdmin: true,
  });
  console.log("Admin nalog kreiran (admin / admin123)");
} else {
  console.log("Admin nalog vec postoji");
}

const profile = await db.select().from(schema.companyProfile);
if (profile.length === 0) {
  await db.insert(schema.companyProfile).values({});
  console.log("Prazan profil firme kreiran");
}

// --- Default podaci po instalaciji (faza 12): porezi, nacini placanja, pariteti ---
// Statusi dokumenata se automatski seeduju po tipu u modulu dokumenata.
const defaultLookups: {
  kind: string;
  internalValue: string;
  externalValue?: string;
  rate?: string;
  isDefault?: boolean;
}[] = [
  { kind: "porez", internalValue: "20%", externalValue: "Opšta stopa PDV 20%", rate: "20", isDefault: true },
  { kind: "porez", internalValue: "10%", externalValue: "Posebna stopa PDV 10%", rate: "10" },
  { kind: "porez", internalValue: "0%", externalValue: "Oslobođeno PDV", rate: "0" },
  { kind: "nacin_placanja", internalValue: "virman", externalValue: "Virman (uplata na račun)", isDefault: true },
  { kind: "nacin_placanja", internalValue: "gotovina", externalValue: "Gotovinsko plaćanje" },
  { kind: "nacin_placanja", internalValue: "avans", externalValue: "Avansno plaćanje" },
  { kind: "paritet", internalValue: "EXW", externalValue: "EXW - Ex Works" },
  { kind: "paritet", internalValue: "FCA", externalValue: "FCA - Free Carrier" },
  { kind: "paritet", internalValue: "CIF", externalValue: "CIF - Cost, Insurance and Freight" },
  { kind: "paritet", internalValue: "DAP", externalValue: "DAP - Delivered at Place", isDefault: true },
  { kind: "paritet", internalValue: "DDP", externalValue: "DDP - Delivered Duty Paid" },
];

for (const kind of [...new Set(defaultLookups.map((l) => l.kind))]) {
  const postoji = await db.select().from(schema.lookups).where(eq(schema.lookups.kind, kind));
  if (postoji.length > 0) continue;
  await db.insert(schema.lookups).values(
    defaultLookups
      .filter((l) => l.kind === kind)
      .map((l, i) => ({ ...l, externalValue: l.externalValue ?? "", sortOrder: i })),
  );
  console.log(`Default lista kreirana: ${kind}`);
}

// --- Default role po radnim mestima (brief 10) ---
// privilegije po modulima (faza 14.4: jedan model, resurs == modul)
const dokumentiSvi = (level: "read" | "write"): [string, "read" | "write"][] =>
  ["ponude", "predracuni", "racuni", "avansni_racuni", "otpremnice", "reversi", "kalkulacije", "porudzbine", "priprema_uvoza", "ulaz_robe"].map((m) => [m, level]);
const defaultRole: { name: string; priv: [string, "read" | "write"][] }[] = [
  {
    name: "Komercijala",
    priv: [
      ["klijenti", "write"], ["dobavljaci", "write"], ...dokumentiSvi("write"), ["obracuni", "write"], ["projekti", "write"],
      ["artikli", "read"], ["cenovnici", "read"], ["zalihe", "read"], ["podesavanja", "read"], ["zadaci", "write"],
    ],
  },
  {
    name: "Nabavka",
    priv: [
      ["artikli", "write"], ["cenovnici", "write"], ...dokumentiSvi("write"), ["zalihe", "write"],
      ["klijenti", "read"], ["dobavljaci", "read"], ["obracuni", "read"], ["podesavanja", "read"], ["zadaci", "write"],
    ],
  },
  {
    name: "Magacin",
    priv: [["zalihe", "write"], ...dokumentiSvi("read"), ["artikli", "read"], ["zadaci", "write"]],
  },
];

const postojeceRole = await db.select().from(schema.roles);
for (const r of defaultRole) {
  if (postojeceRole.some((x) => x.name === r.name)) continue;
  const [role] = await db.insert(schema.roles).values({ name: r.name }).returning();
  await db.insert(schema.privileges).values(
    r.priv.map(([resource, level]) => ({ roleId: role!.id, resource, level })),
  );
  console.log(`Default rola kreirana: ${r.name}`);
}

process.exit(0);
