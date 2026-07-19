import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  roleId: integer("role_id").references(() => roles.id),
  // SMTP podesavanja po korisniku (brief 10): host, port, secure, user, pass, fromName, fromEmail
  smtp: jsonb("smtp"),
  // raspored sidebara po korisniku (brief 3.1)
  sidebarLayout: jsonb("sidebar_layout"),
  // genericke UI preference po korisniku (faza 14.4, stavka 15): { stavkeKolone: { [tip]: { hidden: string[] } } }
  uiPrefs: jsonb("ui_prefs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Vise grupa po korisniku (faza 16, RP6): join tabela; users.roleId je deprecated.
// Clanstvo u sistemskoj grupi "admin" = administrator (uz legacy users.isAdmin).
export const userRoles = pgTable(
  "user_roles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("user_roles_idx").on(t.userId, t.roleId)],
);

// Matrica privilegija: (rola ILI korisnik) x resurs x nivo.
// Individualni override (user_id popunjen) ima prioritet nad rolom.
export const privileges = pgTable("privileges", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").references(() => roles.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  resource: varchar("resource", { length: 100 }).notNull(),
  level: varchar("level", { length: 10 }).notNull(), // 'read' | 'write'
});

export const sessions = pgTable("sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Liste predefinisanih izbora (brief 11.3): porezi, nacini placanja, pariteti,
// statusi dokumenata (po tipu). Jedna tabela za sve vrste listi.
export const lookups = pgTable("lookups", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 40 }).notNull(), // 'porez' | 'nacin_placanja' | 'paritet' | 'status_dokumenta'
  docType: varchar("doc_type", { length: 40 }), // samo za statuse dokumenata
  internalValue: varchar("internal_value", { length: 200 }).notNull(), // kratka vrednost (bira se u dokumentu)
  externalValue: varchar("external_value", { length: 500 }).notNull().default(""), // puna vrednost (ide na izvestaj)
  rate: numeric("rate", { precision: 6, scale: 2 }), // samo za poreze (stopa u %)
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

// Kategorije artikala (brief 5.3): stablo proizvoljne dubine
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),
  code: varchar("code", { length: 9 }), // A01020000: 1 slovo (glavna) + 4x2 cifre (podnivoi)
  name: varchar("name", { length: 200 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  porezId: integer("porez_id").references(() => lookups.id), // porez na krajnjoj kategoriji
  carina: numeric("carina", { precision: 6, scale: 2 }), // carina u %
});

// Subjekti - jedinstvena baza klijenata i dobavljaca (brief 4)
export const subjects = pgTable("subjects", {
  id: serial("id").primaryKey(),
  role: varchar("role", { length: 20 }).notNull(), // 'klijent' | 'dobavljac' | 'oba'
  naziv: varchar("naziv", { length: 200 }).notNull(), // interni, skraceni
  puniNaziv: varchar("puni_naziv", { length: 400 }).notNull(),
  adresa: varchar("adresa", { length: 300 }).notNull(),
  postanskiBroj: varchar("postanski_broj", { length: 20 }).notNull(),
  grad: varchar("grad", { length: 100 }).notNull(),
  pib: varchar("pib", { length: 30 }).notNull().default(""), // obavezan samo za Srbiju
  mb: varchar("mb", { length: 30 }).notNull().default(""),
  drzava: varchar("drzava", { length: 100 }).notNull().default("Srbija"),
  nacinPlacanjaId: integer("nacin_placanja_id").references(() => lookups.id),
  paritetId: integer("paritet_id").references(() => lookups.id),
  valuta: varchar("valuta", { length: 10 }).notNull().default("RSD"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Kontakt osobe subjekta (brief 4.3)
export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 60 }).notNull().default(""),
  email: varchar("email", { length: 200 }).notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

// Artikli (brief 5). Parent i varijacija su redovi iste tabele (plan 4.10).
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  ident: varchar("ident", { length: 6 }).notNull().unique(), // automatski, sestocifren
  tip: varchar("tip", { length: 15 }).notNull().default("obican"), // 'obican' | 'parent' | 'varijacija'
  parentId: integer("parent_id"),
  naziv: varchar("naziv", { length: 300 }).notNull(),
  opis: text("opis").notNull().default(""),
  napomena: text("napomena").notNull().default(""),
  dobavljacId: integer("dobavljac_id").references(() => subjects.id),
  sku: varchar("sku", { length: 100 }).notNull().default(""),
  prodajnaCena: numeric("prodajna_cena", { precision: 14, scale: 2 }),
  prodajnaValuta: varchar("prodajna_valuta", { length: 10 }).notNull().default("RSD"),
  kurs: numeric("kurs", { precision: 12, scale: 4 }),
  marza: numeric("marza", { precision: 8, scale: 2 }),
  dobavljacevaCena: numeric("dobavljaceva_cena", { precision: 14, scale: 2 }),
  dobavljacevaValuta: varchar("dobavljaceva_valuta", { length: 10 }).notNull().default("RSD"),
  ocekivaniPopust: numeric("ocekivani_popust", { precision: 8, scale: 2 }),
  carinskaStopa: numeric("carinska_stopa", { precision: 8, scale: 2 }),
  sertifikacijaStopa: numeric("sertifikacija_stopa", { precision: 8, scale: 2 }),
  dodatniTroskoviStopa: numeric("dodatni_troskovi_stopa", { precision: 8, scale: 2 }),
  zemljaPorekla: varchar("zemlja_porekla", { length: 100 }).notNull().default(""),
  carinskaTarifa: varchar("carinska_tarifa", { length: 50 }).notNull().default(""),
  porezId: integer("porez_id").references(() => lookups.id),
  glavnaKategorijaId: integer("glavna_kategorija_id").references(() => categories.id),
  sekundarnaKategorijaId: integer("sekundarna_kategorija_id").references(() => categories.id),
  active: boolean("active").notNull().default(true),
  discontinued: boolean("discontinued").notNull().default(false),
  // akcija (brief 5.1): aktivna = procenat > 0 i (neograniceno ili danas u periodu)
  akcijaProcenat: numeric("akcija_procenat", { precision: 8, scale: 2 }),
  akcijaOd: timestamp("akcija_od"),
  akcijaDo: timestamp("akcija_do"),
  akcijaNeograniceno: boolean("akcija_neograniceno").notNull().default(false),
  serijskiBrojevi: boolean("serijski_brojevi").notNull().default(false),
  // zalihe (brief 12): zbirna jedinica mere + parametri porucivanja
  zbirnaNasaKolicina: numeric("zbirna_nasa_kolicina", { precision: 14, scale: 2 }),
  zbirnaNasaJm: varchar("zbirna_nasa_jm", { length: 20 }).notNull().default(""),
  zbirnaDobKolicina: numeric("zbirna_dob_kolicina", { precision: 14, scale: 2 }),
  zbirnaDobJm: varchar("zbirna_dob_jm", { length: 20 }).notNull().default(""),
  minPorucivanje: numeric("min_porucivanje", { precision: 14, scale: 2 }),
  korakPorucivanja: numeric("korak_porucivanja", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Atributi artikla - slobodan unos (brief 5.4)
export const articleAttributes = pgTable("article_attributes", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  value: varchar("value", { length: 200 }).notNull(),
});

// Povezani artikli - jednosmerna veza (brief 5.5)
export const relatedArticles = pgTable("related_articles", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  relatedId: integer("related_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
});

// Fajlovi artikla: slika (jedna, isImage) i dokumenti (brief 5.6)
export const articleFiles = pgTable("article_files", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 300 }).notNull(), // prikazno ime (moze se preimenovati)
  storedPath: varchar("stored_path", { length: 500 }).notNull(),
  isImage: boolean("is_image").notNull().default(false),
  autoAttach: boolean("auto_attach").notNull().default(false), // automatski zakaci u mail
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Istorija akcija artikla (brief 5.1)
export const akcijaIstorija = pgTable("akcija_istorija", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  procenat: numeric("procenat", { precision: 8, scale: 2 }),
  od: timestamp("od"),
  doDatuma: timestamp("do_datuma"),
  neograniceno: boolean("neograniceno").notNull().default(false),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Genericki audit log izmena (plan 4.9) - kartica Istorija i log dokumenata
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  entity: varchar("entity", { length: 50 }).notNull(),
  entityId: integer("entity_id").notNull(),
  field: varchar("field", { length: 100 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Cenovnici dobavljaca (brief 6) - svaki uvoz je nova verzija
export const pricelists = pgTable("pricelists", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 300 }).notNull(),
  dobavljacId: integer("dobavljac_id")
    .notNull()
    .references(() => subjects.id),
  valuta: varchar("valuta", { length: 10 }).notNull().default("EUR"), // opsta opcija cenovnika
  vaziOd: timestamp("vazi_od").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pricelistItems = pgTable("pricelist_items", {
  id: serial("id").primaryKey(),
  pricelistId: integer("pricelist_id")
    .notNull()
    .references(() => pricelists.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 100 }).notNull(),
  naziv: varchar("naziv", { length: 400 }).notNull().default(""),
  cena: numeric("cena", { precision: 14, scale: 2 }),
  opis: text("opis").notNull().default(""),
  discontinued: boolean("discontinued").notNull().default(false),
  napomena: varchar("napomena", { length: 400 }).notNull().default(""), // faza 16 RP9
  custom: jsonb("custom").$type<Record<string, string>>(), // faza 16 RP9: { "Naziv kolone": "vrednost" }
});

// Zajednicki model dokumenta (brief 7): ponuda, predracun, revers, kalkulacija.
// Podaci klijenta su snapshot - izmene vaze samo za dokument (brief 7.1).
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    tip: varchar("tip", { length: 20 }).notNull(), // 'ponuda' | 'predracun' | 'revers' | 'kalkulacija'
    godina: integer("godina").notNull(),
    redniBroj: integer("redni_broj").notNull(),
    broj: varchar("broj", { length: 60 }).notNull(), // format podesiv po tipu (brief 14.2)
    status: varchar("status", { length: 100 }).notNull().default("u izradi"),
    // klijent (snapshot)
    klijentId: integer("klijent_id").references(() => subjects.id),
    klijentNaziv: varchar("klijent_naziv", { length: 200 }).notNull().default(""),
    klijentPuniNaziv: varchar("klijent_puni_naziv", { length: 400 }).notNull().default(""),
    klijentPib: varchar("klijent_pib", { length: 30 }).notNull().default(""),
    klijentAdresa: varchar("klijent_adresa", { length: 300 }).notNull().default(""),
    klijentPostanskiBroj: varchar("klijent_postanski_broj", { length: 20 }).notNull().default(""),
    klijentGrad: varchar("klijent_grad", { length: 100 }).notNull().default(""),
    kontaktOsoba: varchar("kontakt_osoba", { length: 200 }).notNull().default(""),
    kontaktTelefon: varchar("kontakt_telefon", { length: 60 }).notNull().default(""),
    kontaktEmail: varchar("kontakt_email", { length: 200 }).notNull().default(""),
    // kartice Adresa slanja i Posrednik (brief 7.1) - slobodna polja
    adresaSlanja: jsonb("adresa_slanja").notNull().default({}),
    posrednik: jsonb("posrednik").notNull().default({}),
    // podaci dokumenta
    valuta: varchar("valuta", { length: 10 }).notNull().default("RSD"),
    kurs: numeric("kurs", { precision: 12, scale: 4 }),
    paritet: varchar("paritet", { length: 200 }).notNull().default(""),
    nacinPlacanja: varchar("nacin_placanja", { length: 200 }).notNull().default(""),
    datum: timestamp("datum").notNull().defaultNow(),
    rokVazenja: integer("rok_vazenja").notNull().default(30), // broj dana
    vaziDo: timestamp("vazi_do"),
    referentId: integer("referent_id").references(() => users.id),
    referencaKupca: varchar("referenca_kupca", { length: 200 }).notNull().default(""),
    // revers (brief 8.3): izdavanje ili povrat
    smer: varchar("smer", { length: 15 }),
    // revers uz modul zaliha (brief 12): izdajno/prijemno skladiste ili bez skladista
    skladisteId: integer("skladiste_id"),
    // kalkulacija (brief 8.4): troskovi uneti u zaglavlju pune sve stavke
    troskoviZaglavlje: jsonb("troskovi_zaglavlje"),
    // priprema za uvoz / ulaz robe (brief 8.6, 8.7)
    brojFakture: varchar("broj_fakture", { length: 100 }).notNull().default(""),
    datumFakture: timestamp("datum_fakture"),
    ukupanTransport: numeric("ukupan_transport", { precision: 14, scale: 2 }),
    // avansni racun (brief 8.10): jedan red - broj predracuna, iznos bez i sa PDV
    avansPredracunBroj: varchar("avans_predracun_broj", { length: 30 }).notNull().default(""),
    avansOsnovica: numeric("avans_osnovica", { precision: 14, scale: 2 }),
    avansIznos: numeric("avans_iznos", { precision: 14, scale: 2 }),
    // zakljucavanje pri uredjivanju (faza 17, RP11 / migracija M2):
    // lock je aktivan dok je heartbeat mladji od 15 min
    lockedBy: integer("locked_by").references(() => users.id),
    lockHeartbeat: timestamp("lock_heartbeat"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documents_broj_idx").on(t.tip, t.godina, t.redniBroj)],
);

export const documentItems = pgTable("document_items", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pozicija: integer("pozicija").notNull(),
  articleId: integer("article_id").references(() => articles.id),
  ident: varchar("ident", { length: 20 }).notNull().default(""),
  naziv: varchar("naziv", { length: 400 }).notNull(),
  kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull().default("1"),
  cena: numeric("cena", { precision: 14, scale: 2 }).notNull().default("0"), // jedinicna, u valuti dokumenta
  popust: numeric("popust", { precision: 8, scale: 2 }).notNull().default("0"), // %
  porezStopa: numeric("porez_stopa", { precision: 6, scale: 2 }).notNull().default("0"),
  rokIsporuke: varchar("rok_isporuke", { length: 100 }).notNull().default(""),
  napomena: varchar("napomena", { length: 400 }).notNull().default(""), // brief 7.4, max ~300
  opcioni: boolean("opcioni").notNull().default(false), // samo ponuda (brief 8.1)
  serijskiBroj: varchar("serijski_broj", { length: 200 }).notNull().default(""), // samo revers
  nabavnaCena: numeric("nabavna_cena", { precision: 14, scale: 2 }), // snapshot za zaradu/kalkulaciju
  // kalkulacija (brief 8.4): { marza, ekoTaksa, transport, spedicija, kursnaRazlika, carina }
  kalk: jsonb("kalk"),
  vracenaKolicina: numeric("vracena_kolicina", { precision: 14, scale: 2 }).notNull().default("0"),
  // porudzbina (brief 8.5): za koga se porucuje - [{ predracunId, broj, klijentNaziv, kolicina }]
  potrebe: jsonb("potrebe"),
  // priprema za uvoz (brief 8.6)
  zemljaPorekla: varchar("zemlja_porekla", { length: 100 }).notNull().default(""),
  carinskaTarifa: varchar("carinska_tarifa", { length: 50 }).notNull().default(""),
  // procenat carine - snapshot pri izboru tarife (faza 15, RP7 / migracija M3)
  carinskaStopa: numeric("carinska_stopa", { precision: 6, scale: 2 }),
  transportTrosak: numeric("transport_trosak", { precision: 14, scale: 2 }),
  // koleta - snapshot na stavci nabavnih dokumenata (faza 17, RP5 / migracija M1)
  koleta: numeric("koleta", { precision: 14, scale: 2 }),
  // ulaz robe (brief 8.7): uneti serijski brojevi - string[]
  serijskiBrojevi: jsonb("serijski_brojevi"),
  // pravilo prenosa 1:1 (brief 8.9): kolicina preneta na sledeci dokument u lancu
  prenetaKolicina: numeric("preneta_kolicina", { precision: 14, scale: 2 }).notNull().default("0"),
});

// Evidencija porucenog po predracunu (brief 8.5) - trajna, sprecava dupliranje u obracunima
export const porucenoPoPredracunu = pgTable("poruceno_po_predracunu", {
  id: serial("id").primaryKey(),
  predracunId: integer("predracun_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  porudzbinaId: integer("porudzbina_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Veze medju dokumentima (brief 7.6) - dvosmerno vidljive
export const documentLinks = pgTable("document_links", {
  id: serial("id").primaryKey(),
  fromId: integer("from_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  toId: integer("to_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Vezivanje avansa za racune (brief 8.10): delimicno, retroaktivno, vise racuna
export const avansVeze = pgTable("avans_veze", {
  id: serial("id").primaryKey(),
  avansId: integer("avans_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  racunId: integer("racun_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  iznos: numeric("iznos", { precision: 14, scale: 2 }).notNull(), // sa PDV
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Sabloni izvestaja (brief 7.7): HTML sa {placeholder} poljima, po tipu dokumenta
export const reportTemplates = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  docType: varchar("doc_type", { length: 20 }).notNull(),
  naziv: varchar("naziv", { length: 200 }).notNull(),
  html: text("html").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Imenovane definicije tabele stavki za sablone (faza 15 RP5): {stavke_tabela:naziv}
export const reportTableDefs = pgTable("report_table_defs", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 100 }).notNull().unique(), // koristi se u {stavke_tabela:naziv}
  docType: varchar("doc_type", { length: 20 }), // null = dostupna svim tipovima
  // [{ polje, naslov, poravnanje: "left"|"center"|"right", sirina }]
  kolone: jsonb("kolone").notNull(),
});

// Slike za sablone (faza 15 RP5): {slika:naziv} -> data URI
export const reportImages = pgTable("report_images", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 100 }).notNull().unique(),
  filename: varchar("filename", { length: 300 }).notNull(),
  storedPath: varchar("stored_path", { length: 500 }).notNull(),
  mime: varchar("mime", { length: 100 }).notNull(),
});

// Uputstva - PDF dokumenti (faza 16 RP8): sistemska isporucujemo mi, korisnicka se mogu brisati
export const uputstvaDokumenti = pgTable("uputstva_dokumenti", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 200 }).notNull(),
  filename: varchar("filename", { length: 300 }).notNull(),
  storedPath: varchar("stored_path", { length: 500 }).notNull(),
  sistemsko: boolean("sistemsko").notNull().default(false),
});

// --- Modul zaliha (brief 12) ---

// Skladista - samo naziv, jedno primarno (brief 12)
export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 200 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

// Min/opt/max zaliha po artiklu i skladistu (za dopunu lagera, brief 8.5)
export const articleStockLevels = pgTable(
  "article_stock_levels",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    min: numeric("min", { precision: 14, scale: 2 }),
    opt: numeric("opt", { precision: 14, scale: 2 }),
    max: numeric("max", { precision: 14, scale: 2 }),
  },
  (t) => [uniqueIndex("stock_levels_idx").on(t.articleId, t.warehouseId)],
);

// Ledger prometa: svaka promena stanja je red (kolicina sa znakom).
// Stanje na dan = snapshot poslednjeg zavrsenog meseca + suma ledgera posle njega.
export const stockLedger = pgTable("stock_ledger", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  datum: timestamp("datum").notNull(),
  kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull(), // + ulaz, - izlaz
  vrsta: varchar("vrsta", { length: 20 }).notNull(), // 'ulaz' | 'prenos' | ...
  refId: integer("ref_id"), // id prenosa/dokumenta koji je izazvao promet
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Mesecni snapshot stanja (kraj meseca) da ledger sume ne rastu neograniceno
export const stockSnapshots = pgTable(
  "stock_snapshots",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    mesec: varchar("mesec", { length: 7 }).notNull(), // 'YYYY-MM', stanje na kraju tog meseca
    kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("stock_snapshots_idx").on(t.articleId, t.warehouseId, t.mesec)],
);

// Skladiste serijskih brojeva: red = serijski broj trenutno na stanju (brief 12.3)
export const serialNumbers = pgTable("serial_numbers", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  broj: varchar("broj", { length: 200 }).notNull(),
  refId: integer("ref_id"), // id dokumenta ulaza koji je uneo serijski broj
  // otpremnica koja je skinula broj sa stanja (brief 8.8); null = na stanju
  izlazId: integer("izlaz_id"),
  // null = izlazId je dokument (otpremnica); 'presifriranje' = izlazId je presifriranja.id
  izlazVrsta: varchar("izlaz_vrsta", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Prenos medju skladistima - poseban dokument (brief 12)
export const prenosi = pgTable(
  "prenosi",
  {
    id: serial("id").primaryKey(),
    godina: integer("godina").notNull(),
    redniBroj: integer("redni_broj").notNull(),
    broj: varchar("broj", { length: 30 }).notNull(), // GG-PRN-NNNNN
    izdajnoId: integer("izdajno_id")
      .notNull()
      .references(() => warehouses.id),
    prijemnoId: integer("prijemno_id")
      .notNull()
      .references(() => warehouses.id),
    datum: timestamp("datum").notNull(),
    napomena: text("napomena").notNull().default(""),
    // nacrt (generisan iz popisa, ne knjizi) | knjizen
    status: varchar("status", { length: 10 }).notNull().default("knjizen"),
    popisId: integer("popis_id"), // popis iz cijeg je obracuna prenos generisan
    userId: integer("user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prenosi_broj_idx").on(t.godina, t.redniBroj)],
);

export const prenosStavke = pgTable("prenos_stavke", {
  id: serial("id").primaryKey(),
  prenosId: integer("prenos_id")
    .notNull()
    .references(() => prenosi.id, { onDelete: "cascade" }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id),
  ident: varchar("ident", { length: 20 }).notNull().default(""),
  naziv: varchar("naziv", { length: 400 }).notNull(),
  kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull(),
  serijskiBrojevi: jsonb("serijski_brojevi").notNull().default([]), // string[]
  napomena: varchar("napomena", { length: 400 }).notNull().default(""),
});

// Popis (fizicka inventura): zaglavlje sa kriterijumima izbora artikala
export const popisi = pgTable(
  "popisi",
  {
    id: serial("id").primaryKey(),
    godina: integer("godina").notNull(),
    redniBroj: integer("redni_broj").notNull(),
    broj: varchar("broj", { length: 30 }).notNull(), // GG-POP-NNNNN
    datum: timestamp("datum").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("u_toku"), // u_toku | zakljucen
    napomena: text("napomena").notNull().default(""),
    kriterijumi: jsonb("kriterijumi").notNull(), // { skladistaIds, dobavljacIds, kategorijaIds }
    userId: integer("user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("popisi_broj_idx").on(t.godina, t.redniBroj)],
);

// Stavka popisa = (artikal, skladiste); popisano NULL = nepopisano, 0 = popisana nula
export const popisStavke = pgTable(
  "popis_stavke",
  {
    id: serial("id").primaryKey(),
    popisId: integer("popis_id")
      .notNull()
      .references(() => popisi.id, { onDelete: "cascade" }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    ident: varchar("ident", { length: 20 }).notNull().default(""),
    naziv: varchar("naziv", { length: 400 }).notNull(),
    ocekivano: numeric("ocekivano", { precision: 14, scale: 2 }).notNull(),
    popisano: numeric("popisano", { precision: 14, scale: 2 }),
    datumPopisa: timestamp("datum_popisa"),
  },
  (t) => [uniqueIndex("popis_stavke_idx").on(t.popisId, t.articleId, t.warehouseId)],
);

// Presifriranje: interni dokument koji pretvara jedan artikal u drugi (izlaz A + ulaz B)
export const presifriranja = pgTable(
  "presifriranja",
  {
    id: serial("id").primaryKey(),
    godina: integer("godina").notNull(),
    redniBroj: integer("redni_broj").notNull(),
    broj: varchar("broj", { length: 30 }).notNull(), // GG-PSF-NNNNN
    datum: timestamp("datum").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("nacrt"), // nacrt | knjizen
    napomena: text("napomena").notNull().default(""),
    userId: integer("user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("presifriranja_broj_idx").on(t.godina, t.redniBroj)],
);

export const presifriranjeStavke = pgTable("presifriranje_stavke", {
  id: serial("id").primaryKey(),
  presifriranjeId: integer("presifriranje_id")
    .notNull()
    .references(() => presifriranja.id, { onDelete: "cascade" }),
  smer: varchar("smer", { length: 5 }).notNull(), // izlaz | ulaz
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  ident: varchar("ident", { length: 20 }).notNull().default(""),
  naziv: varchar("naziv", { length: 400 }).notNull(),
  kolicina: numeric("kolicina", { precision: 14, scale: 2 }).notNull(),
  serijskiBrojevi: jsonb("serijski_brojevi").notNull().default([]), // string[]
});

// --- Projekti (brief 13): grupa dokumenata po klijentu, jedan posao ---

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  naziv: varchar("naziv", { length: 300 }).notNull(),
  klijentId: integer("klijent_id")
    .notNull()
    .references(() => subjects.id),
  status: varchar("status", { length: 100 }).notNull().default("otvoren"),
  ocekivanja: text("ocekivanja").notNull().default(""),
  planPocetak: timestamp("plan_pocetak"),
  planKraj: timestamp("plan_kraj"),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Dokumenti pridruzeni projektu
export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Sve stavke projekta u jednoj tabeli (napomene, reference, kontakti, datumi,
// ucesnici, komunikacija, attachmenti) - hronologija = union sa dokumentima
export const projectEntries = pgTable("project_entries", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  vrsta: varchar("vrsta", { length: 20 }).notNull(), // 'napomena' | 'referenca' | 'kontakt' | 'datum' | 'ucesnik' | 'komunikacija' | 'attachment'
  osoba: varchar("osoba", { length: 200 }).notNull().default(""), // kontakt/ucesnik/posiljalac poruke
  datum: timestamp("datum").notNull().defaultNow(), // datum desavanja / poruke
  tekst: text("tekst").notNull().default(""),
  // attachment (klijenta ili ponudjaca)
  filename: varchar("filename", { length: 300 }).notNull().default(""),
  storedPath: varchar("stored_path", { length: 500 }).notNull().default(""),
  strana: varchar("strana", { length: 20 }).notNull().default(""), // 'klijent' | 'ponudjac'
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Uplate klijenata (faza 16, RP7): poziv na broj = nas broj dokumenta
export const uplate = pgTable("uplate", {
  id: serial("id").primaryKey(),
  klijentId: integer("klijent_id")
    .notNull()
    .references(() => subjects.id),
  iznos: numeric("iznos", { precision: 14, scale: 2 }).notNull(),
  pozivNaBroj: varchar("poziv_na_broj", { length: 50 }).notNull(),
  datumUplate: date("datum_uplate").notNull(),
  referent: varchar("referent", { length: 100 }).notNull().default(""),
  avans: boolean("avans").notNull().default(false),
  napomena: varchar("napomena", { length: 100 }).notNull().default(""),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Generalna podesavanja kao key-value (npr. podrazumevani izbori za dokumente)
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
});

// Profil firme - jedan red (brief: racuni, telefoni, mailovi sa predpoljima)
export const companyProfile = pgTable("company_profile", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 300 }).notNull().default(""),
  address: text("address").notNull().default(""),
  pib: varchar("pib", { length: 20 }).notNull().default(""),
  maticniBroj: varchar("maticni_broj", { length: 20 }).notNull().default(""),
  // liste sa predpoljima: [{ label: "Ziro racun", value: "..." }]
  bankAccounts: jsonb("bank_accounts").notNull().default([]),
  phones: jsonb("phones").notNull().default([]),
  emails: jsonb("emails").notNull().default([]),
});
