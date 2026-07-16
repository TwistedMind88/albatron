import { z } from "zod";

// Predefinisane valute (faza 14.2): svuda se biraju iz padajuceg menija
export const VALUTE = ["RSD", "EUR", "USD"] as const;

export const SUBJECT_ROLES = [
  { id: "klijent", label: "Klijent" },
  { id: "dobavljac", label: "Dobavljač" },
  { id: "oba", label: "Klijent i dobavljač" },
] as const;

export const subjectSchema = z
  .object({
    role: z.enum(["klijent", "dobavljac", "oba"]),
    naziv: z.string().min(1, "Naziv je obavezan"),
    puniNaziv: z.string().min(1, "Puni naziv je obavezan"),
    adresa: z.string().min(1, "Adresa je obavezna"),
    postanskiBroj: z.string().min(1, "Poštanski broj je obavezan"),
    grad: z.string().min(1, "Grad je obavezan"),
    pib: z.string().default(""),
    mb: z.string().default(""),
    drzava: z.string().min(1).default("Srbija"),
    nacinPlacanjaId: z.number().nullable().default(null),
    paritetId: z.number().nullable().default(null),
    valuta: z.string().min(1).default("RSD"),
    active: z.boolean().default(true),
  })
  .check((ctx) => {
    // PIB i MB obavezni samo za subjekte iz Srbije (brief 4.2)
    if (ctx.value.drzava.trim().toLowerCase() === "srbija") {
      if (!ctx.value.pib) {
        ctx.issues.push({ code: "custom", message: "PIB je obavezan za subjekte iz Srbije", input: ctx.value, path: ["pib"] });
      }
      if (!ctx.value.mb) {
        ctx.issues.push({ code: "custom", message: "MB je obavezan za subjekte iz Srbije", input: ctx.value, path: ["mb"] });
      }
    }
  });

export type SubjectInput = z.infer<typeof subjectSchema>;

export const contactSchema = z.object({
  name: z.string().min(1, "Ime je obavezno"),
  phone: z.string().default(""),
  email: z.string().default(""),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type ContactInput = z.infer<typeof contactSchema>;
