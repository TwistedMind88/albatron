import { z } from "zod";

import { MODULES, type ModulId } from "./moduli.js";

// Resursi nad kojima se proveravaju privilegije = registar modula (faza 14.4: jedan model)
// + posebni resursi van modula (faza 16, RP6: brisanje dokumenata odvojeno od write)
export const EXTRA_RESOURCES = [{ id: "brisanje_dokumenata", label: "Brisanje dokumenata" }] as const;
export const RESOURCES = [...MODULES.map((m) => m.id), ...EXTRA_RESOURCES.map((r) => r.id)] as [
  Resource,
  ...Resource[],
];

// Sistemska grupa administratora (faza 16, RP6): clanstvo = admin, bez matrice
export const ADMIN_ROLE = "admin";

// Tipovi dokumenata (brief 8) - koriste se za statuse po tipu, numeraciju...
export const DOC_TYPES = [
  { id: "ponuda", label: "Ponuda", code: "PON" },
  { id: "predracun", label: "Predračun", code: "PRE" },
  { id: "revers", label: "Revers", code: "REV" },
  { id: "kalkulacija", label: "Kalkulacija", code: "KAL" },
  { id: "otpremnica", label: "Otpremnica", code: "OTP" },
  { id: "racun", label: "Račun", code: "RAC" },
  { id: "avansni_racun", label: "Avansni račun", code: "AVR" },
  { id: "porudzbina", label: "Porudžbina", code: "POR" },
  { id: "priprema_uvoza", label: "Priprema za uvoz", code: "UVZ" },
  { id: "ulaz_robe", label: "Ulaz robe", code: "ULZ" },
] as const;

// Vrste predefinisanih listi (brief 11.3); per-kind konfiguracija kolona (faza 16, RP4)
export interface LookupKind {
  id: string;
  label: string;
  hasRate: boolean;
  // nazivi kolona interna/eksterna vrednost (default "Interna (kratka)"/"Eksterna (puna)")
  labels?: { internal: string; external: string };
  // false = kind nema podrazumevani izbor (kolona se ne prikazuje)
  hasDefault?: boolean;
  // true = bez rucnog redosleda; klik na zaglavlje sortira lokalno (faza 17, RP6)
  noReorder?: boolean;
}

export const LOOKUP_KINDS: readonly LookupKind[] = [
  { id: "porez", label: "Porezi", hasRate: true },
  { id: "nacin_placanja", label: "Načini plaćanja", hasRate: false },
  { id: "paritet", label: "Pariteti (Incoterms)", hasRate: false },
  {
    id: "carinska_tarifa",
    label: "Carinske tarife",
    hasRate: true,
    labels: { internal: "Šifra", external: "Naziv" },
    hasDefault: false,
    noReorder: true,
  },
  { id: "status_dokumenta", label: "Statusi dokumenata", hasRate: false },
] as const;

export type Resource = ModulId | (typeof EXTRA_RESOURCES)[number]["id"];

export const loginSchema = z.object({
  username: z.string().min(1, "Korisnicko ime je obavezno"),
  password: z.string().min(1, "Lozinka je obavezna"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
  // resurs -> nivo pristupa
  privileges: Record<string, "read" | "write">;
}
