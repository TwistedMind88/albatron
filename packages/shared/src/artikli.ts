import { z } from "zod";

export const ARTICLE_TIPS = [
  { id: "obican", label: "Običan" },
  { id: "parent", label: "Parent" },
  { id: "varijacija", label: "Varijacija" },
] as const;

const num = z.number().nullable().default(null);

export const articleSchema = z
  .object({
    tip: z.enum(["obican", "parent", "varijacija"]).default("obican"),
    parentId: z.number().nullable().default(null),
    naziv: z.string().min(1, "Naziv je obavezan"),
    opis: z.string().default(""),
    napomena: z.string().default(""),
    dobavljacId: z.number().nullable().default(null),
    sku: z.string().default(""),
    prodajnaCena: num,
    prodajnaValuta: z.string().default("RSD"),
    kurs: num,
    marza: num,
    dobavljacevaCena: num,
    dobavljacevaValuta: z.string().default("RSD"),
    ocekivaniPopust: num,
    carinskaStopa: num,
    sertifikacijaStopa: num,
    dodatniTroskoviStopa: num,
    zemljaPorekla: z.string().default(""),
    carinskaTarifa: z.string().default(""),
    porezId: num,
    glavnaKategorijaId: num,
    sekundarnaKategorijaId: num,
    active: z.boolean().default(true),
    discontinued: z.boolean().default(false),
    akcijaProcenat: num,
    akcijaOd: z.string().nullable().default(null),
    akcijaDo: z.string().nullable().default(null),
    akcijaNeograniceno: z.boolean().default(false),
    serijskiBrojevi: z.boolean().default(false),
  })
  .check((ctx) => {
    const v = ctx.value;
    if (v.tip === "parent") {
      // parent je sablon: nema cenu i SKU (brief 5.2)
      if (v.prodajnaCena !== null || v.dobavljacevaCena !== null || v.sku !== "") {
        ctx.issues.push({ code: "custom", message: "Parent artikal ne moze imati cenu ni SKU", input: v, path: ["tip"] });
      }
    } else {
      // regularan artikal / varijacija: obavezna finansijska polja (brief 5.1)
      if (v.dobavljacId === null)
        ctx.issues.push({ code: "custom", message: "Dobavljač je obavezan", input: v, path: ["dobavljacId"] });
      if (!v.sku) ctx.issues.push({ code: "custom", message: "Dobavljačeva šifra (SKU) je obavezna", input: v, path: ["sku"] });
      if (v.prodajnaCena === null)
        ctx.issues.push({ code: "custom", message: "Prodajna cena je obavezna", input: v, path: ["prodajnaCena"] });
      if (v.dobavljacevaCena === null)
        ctx.issues.push({ code: "custom", message: "Dobavljačeva cena je obavezna", input: v, path: ["dobavljacevaCena"] });
    }
    if (v.tip === "varijacija" && v.parentId === null) {
      ctx.issues.push({ code: "custom", message: "Varijacija mora imati parent artikal", input: v, path: ["parentId"] });
    }
  });

export type ArticleInput = z.infer<typeof articleSchema>;

// Procenjena nabavna cena i zarada (brief 5.1)
// ponytail: konverzija valuta samo dobavljaceva->prodajna preko kursa kad se razlikuju
export function procenjenaNabavna(a: {
  dobavljacevaCena: number | null;
  ocekivaniPopust: number | null;
  carinskaStopa: number | null;
  sertifikacijaStopa: number | null;
  dodatniTroskoviStopa?: number | null;
  kurs: number | null;
  dobavljacevaValuta: string;
  prodajnaValuta: string;
}): number | null {
  if (a.dobavljacevaCena === null) return null;
  const osnovna = a.dobavljacevaCena * (1 - (a.ocekivaniPopust ?? 0) / 100);
  let nabavna =
    osnovna *
    (1 + (a.carinskaStopa ?? 0) / 100 + (a.sertifikacijaStopa ?? 0) / 100 + (a.dodatniTroskoviStopa ?? 0) / 100);
  if (a.dobavljacevaValuta !== a.prodajnaValuta && a.kurs) nabavna *= a.kurs;
  return Math.round(nabavna * 100) / 100;
}

export function zarada(prodajnaCena: number | null, nabavna: number | null) {
  if (prodajnaCena === null || nabavna === null) return null;
  const iznos = Math.round((prodajnaCena - nabavna) * 100) / 100;
  const procenat = nabavna !== 0 ? Math.round((iznos / nabavna) * 10000) / 100 : null;
  return { iznos, procenat };
}

// Aktivna akcija (brief 5.1): procenat > 0 i (neograniceno ili danas u periodu)
export function aktivnaAkcija(a: {
  akcijaProcenat: number | null;
  akcijaOd: string | Date | null;
  akcijaDo: string | Date | null;
  akcijaNeograniceno: boolean;
}): boolean {
  if (!a.akcijaProcenat || a.akcijaProcenat <= 0) return false;
  if (a.akcijaNeograniceno) return true;
  const now = Date.now();
  const od = a.akcijaOd ? new Date(a.akcijaOd).getTime() : null;
  const doD = a.akcijaDo ? new Date(a.akcijaDo).getTime() : null;
  return od !== null && doD !== null && now >= od && now <= doD;
}
