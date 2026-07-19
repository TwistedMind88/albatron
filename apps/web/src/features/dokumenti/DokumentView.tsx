import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch, ApiError } from "../../api";
import { sacuvajFajl } from "../../download";
import Toggle from "../../components/Toggle";
import { useMarkDirty, useTabs } from "../../store/tabs";
import { Autocomplete, type AutocompleteOption } from "../../components/Autocomplete";
import { ParitetSelect } from "../../components/ParitetSelect";
import {
  KALK_TROSKOVI,
  NABAVNI_TIPOVI,
  PRAZNA_STAVKA,
  TIP_INFO,
  type Potreba,
  type Stavka,
  fmt,
  jePrazna,
  r2,
  sumaBezPdv,
  sumaSaPdv,
  uValutuDokumenta,
  zaradaStavke,
} from "./common";
import { StavkeTabela, dostupneKolone, type ArtikalOpcija } from "./StavkeTabela";
import { PretragaPopup } from "./PretragaPopup";
import { IzvestajPopup } from "./IzvestajPopup";
import { ObracunPopup, type ObracunRed } from "./ObracunPopup";

interface Lookup {
  id: number;
  kind: string;
  docType: string | null;
  internalValue: string;
  externalValue: string;
  rate: string | null;
  isDefault: boolean;
}

interface Subjekat {
  id: number;
  naziv: string;
  puniNaziv: string;
  pib: string;
  adresa: string;
  postanskiBroj: string;
  grad: string;
  valuta: string;
  nacinPlacanjaId: number | null;
  paritetId: number | null;
}

interface Kontakt {
  name: string;
  phone: string;
  email: string;
  isDefault: boolean;
}

interface Veza {
  id: number;
  broj: string;
  tip: string;
  status: string;
  smer: string;
}

interface DokumentForm {
  status: string;
  klijentId: number | null;
  klijentNaziv: string;
  klijentPuniNaziv: string;
  klijentPib: string;
  klijentAdresa: string;
  klijentPostanskiBroj: string;
  klijentGrad: string;
  kontaktOsoba: string;
  kontaktTelefon: string;
  kontaktEmail: string;
  adresaSlanja: Record<string, string>;
  posrednik: Record<string, string>;
  valuta: string;
  kurs: number | null;
  paritet: string;
  nacinPlacanja: string;
  datum: string;
  rokVazenja: number;
  vaziDo: string;
  referencaKupca: string;
  smer: string | null;
  skladisteId: number | null;
  troskoviZaglavlje: Record<string, number | null> | null;
  brojFakture: string;
  datumFakture: string | null;
  ukupanTransport: number | null;
  avansPredracunBroj: string;
  avansOsnovica: number | null;
  avansIznos: number | null;
}

// Avansi vezani za racun (brief 8.10)
interface AvansVeza {
  avansId: number;
  broj: string;
  predracunBroj: string;
  iznos: number;
}

interface OtvorenAvans {
  id: number;
  broj: string;
  klijentNaziv: string;
  predracunBroj: string;
  iznos: number;
  preostalo: number;
}

function danas() {
  return new Date().toISOString().slice(0, 10);
}
function plusDana(datum: string, dana: number) {
  const d = new Date(datum);
  d.setDate(d.getDate() + dana);
  return d.toISOString().slice(0, 10);
}

function prazanDokument(tip: string): DokumentForm {
  // priprema uvoza i ulaz robe nemaju rok vazenja (st.19)
  const bezRoka = tip === "priprema_uvoza" || tip === "ulaz_robe";
  return {
    status: "u izradi",
    klijentId: null,
    klijentNaziv: "",
    klijentPuniNaziv: "",
    klijentPib: "",
    klijentAdresa: "",
    klijentPostanskiBroj: "",
    klijentGrad: "",
    kontaktOsoba: "",
    kontaktTelefon: "",
    kontaktEmail: "",
    adresaSlanja: {},
    posrednik: {},
    valuta: "RSD",
    kurs: null,
    paritet: "",
    nacinPlacanja: "",
    datum: danas(),
    rokVazenja: bezRoka ? 0 : 30,
    vaziDo: bezRoka ? "" : plusDana(danas(), 30),
    referencaKupca: "",
    smer: tip === "revers" ? "izdavanje" : null,
    skladisteId: null,
    troskoviZaglavlje: tip === "kalkulacija" ? {} : null,
    brojFakture: "",
    datumFakture: null,
    ukupanTransport: null,
    avansPredracunBroj: "",
    avansOsnovica: null,
    avansIznos: null,
  };
}

const ADRESA_POLJA = [
  { id: "firma", label: "Firma" },
  { id: "adresa", label: "Adresa" },
  { id: "postanskiBroj", label: "Poštanski broj" },
  { id: "grad", label: "Grad" },
  { id: "kontaktOsoba", label: "Kontakt osoba" },
  { id: "kontaktTelefon", label: "Kontakt telefon" },
];
const POSREDNIK_POLJA = [
  { id: "naziv", label: "Naziv" },
  { id: "puniNaziv", label: "Puni naziv" },
  { id: "pib", label: "PIB" },
  { id: "adresa", label: "Adresa" },
  { id: "grad", label: "Grad" },
];

export function DokumentView({
  tip: propTip,
  id,
  onBack,
  onOpenDoc,
}: {
  tip: string;
  id: number | null;
  onBack: () => void;
  onOpenDoc: (id: number) => void;
}) {
  const [savedId, setSavedId] = useState(id);
  const [d, setD] = useState<DokumentForm>(() => prazanDokument(propTip));
  const [tip, setTip] = useState(propTip);
  const [broj, setBroj] = useState("");
  const [referent, setReferent] = useState("");
  const [stavke, setStavke] = useState<Stavka[]>([]);
  const [veze, setVeze] = useState<Veza[]>([]);
  const [kartica, setKartica] = useState<"klijent" | "adresa" | "posrednik">("klijent");
  const [kontakti, setKontakti] = useState<Kontakt[]>([]);
  const [error, setError] = useState("");
  const [poruka, setPoruka] = useState("");
  const [popup, setPopup] = useState<
    | { vrsta: "pretraga" }
    | { vrsta: "napomena"; idx: number; rect: DOMRect }
    | { vrsta: "povezani"; idx: number; rect: DOMRect }
    | { vrsta: "prenumeracija" }
    | { vrsta: "kolone"; rect: DOMRect }
    | { vrsta: "generisi"; cilj: string }
    | { vrsta: "log" }
    | { vrsta: "izvestaj"; sablon?: number }
    | { vrsta: "obracun" }
    | { vrsta: "potrebe"; idx: number }
    | { vrsta: "serijski"; idx: number }
    | { vrsta: "izborSerijskih"; idx: number }
    | { vrsta: "veziAvans" }
    | { vrsta: "cenovnikCene" }
    | null
  >(null);
  const [meni, setMeni] = useState(false);
  const [stavkeMeni, setStavkeMeni] = useState(false);
  const [izvestajMeni, setIzvestajMeni] = useState(false);
  // avansi (brief 8.10): na racunu vezani avansi, na avansu iskorisceno
  const [avansi, setAvansi] = useState<{ veze: AvansVeza[]; ukupno: number } | null>(null);
  const [avansIskorisceno, setAvansIskorisceno] = useState<number | null>(null);
  // poslednja valuta/kurs primenjeni na stavke - za dugme preracuna (brief 7.4)
  const primenjeno = useRef({ valuta: "RSD", kurs: null as number | null });

  // nesnimljene izmene (faza 14.1): snapshot d+stavke posle ucitavanja,
  // svako odstupanje pali dirty na tabu; snimanje ponovo ucitava pa resetuje
  const snapshot = useRef("");
  const svezeUcitano = useRef(true);
  const [izmenjen, setIzmenjen] = useState(false);
  const [nazadPopup, setNazadPopup] = useState(false);
  useMarkDirty(izmenjen);

  // zakljucavanje dokumenta pri uredjivanju (faza 17, RP11 / st.31):
  // otvaranje je slobodno; na PRVU izmenu se uzima lock, heartbeat na 60s dok traje rad,
  // otpustanje na snimanje (server) / unmount; zaostali lock istice za 15 min na serveru
  const lockDrzim = useRef(false);
  const [lockPoruka, setLockPoruka] = useState("");
  useEffect(() => {
    if (!izmenjen || savedId === null || lockDrzim.current) return;
    let otkazano = false;
    void (async () => {
      try {
        await api(`/api/dokumenti/${savedId}/lock`, { method: "POST" });
        if (!otkazano) lockDrzim.current = true;
      } catch (e) {
        if (otkazano) return;
        setLockPoruka(e instanceof ApiError && e.status === 409 ? e.message : "Zaključavanje dokumenta nije uspelo");
        // izmena se ponistava - revert na snapshot; sledeci pokusaj izmene ponovo trazi lock
        const [sd, ss] = JSON.parse(snapshot.current) as [DokumentForm, Stavka[]];
        svezeUcitano.current = true;
        setD(sd);
        setStavke(ss);
      }
    })();
    return () => {
      otkazano = true;
    };
  }, [izmenjen, savedId]);
  useEffect(() => {
    if (!izmenjen || savedId === null) return;
    const t = setInterval(() => {
      if (lockDrzim.current) void api(`/api/dokumenti/${savedId}/lock-heartbeat`, { method: "POST" }).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [izmenjen, savedId]);
  useEffect(() => {
    if (savedId === null) return;
    const docId = savedId;
    return () => {
      // otpusti lock pri zatvaranju taba / prelasku na drugi dokument
      if (lockDrzim.current) {
        lockDrzim.current = false;
        void apiFetch(`/api/dokumenti/${docId}/lock`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    };
  }, [savedId]);

  // brisanje dokumenta (faza 16, RP6): posebna privilegija "brisanje_dokumenata"
  const [brisanjePopup, setBrisanjePopup] = useState(false);
  // export upita po sablonu: lista spornih stavki iz 400 odgovora (mora biti vidljiva cela)
  const [rfqProblemi, setRfqProblemi] = useState<{ naziv: string; problem: string }[] | null>(null);
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api<{ isAdmin: boolean; privileges: Record<string, string> }>("/api/auth/me"),
  });
  const smeBrisanje = me.data?.isAdmin || me.data?.privileges["brisanje_dokumenata"] === "write";
  async function obrisiDokument() {
    try {
      await api(`/api/dokumenti/${savedId}`, { method: "DELETE" });
      setBrisanjePopup(false);
      onBack();
    } catch (e) {
      setBrisanjePopup(false);
      setError(e instanceof Error ? e.message : "Greška pri brisanju");
    }
  }

  const otvoriTab = useTabs((s) => s.open);
  // dvoklik na naziv subjekta / ident-naziv artikla otvara zapis u svom tabu (stavka 11)
  function otvoriSubjekat() {
    if (d.klijentId === null) return;
    otvoriTab(uloga === "dobavljac" ? "dobavljaci" : "klijenti", d.klijentNaziv || "Subjekat", {
      forceNew: true,
      payload: { openId: d.klijentId },
    });
  }
  function otvoriArtikal(articleId: number, naziv: string) {
    otvoriTab("artikli", naziv || "Artikal", { forceNew: true, payload: { openId: articleId } });
  }

  const jeRevers = tip === "revers";
  const jeKalk = tip === "kalkulacija";
  // nabavni dokumenti: prema dobavljacu, nabavne cene (brief 8.5-8.7)
  const jeNabavni = NABAVNI_TIPOVI.includes(tip);
  const jePriprema = tip === "priprema_uvoza";
  const jeUlaz = tip === "ulaz_robe";
  // prodajni lanac (brief 8.8-8.10)
  const jeOtpremnica = tip === "otpremnica";
  const jeRacun = tip === "racun";
  const jeAvans = tip === "avansni_racun";
  const uloga = jeNabavni ? "dobavljac" : "klijent";

  const sifarnici = useQuery({
    queryKey: ["dokumenti-sifarnici"],
    queryFn: () => api<Lookup[]>("/api/dokumenti-sifarnici"),
  });
  const klijenti = useQuery({
    queryKey: ["subjekti", uloga],
    queryFn: () => api<Subjekat[]>(`/api/subjekti?uloga=${uloga}`),
  });
  const artikli = useQuery({
    queryKey: ["artikli-opcije"],
    queryFn: () => api<ArtikalOpcija[]>("/api/artikli-pretraga"),
  });
  const moduli = useQuery({ queryKey: ["moduli"], queryFn: () => api<{ zalihe: boolean }>("/api/moduli") });

  // export upita po sablonu dobavljaca: konfiguracije zive u bazi (rfqSablon.ts na
  // serveru); svaka konfiguracija = posebno dugme, prazna lista = nema opcija
  const rfqSabloni = useQuery({
    queryKey: ["rfq-sabloni"],
    queryFn: () => api<{ id: string; label: string; imeFajla: string }[]>("/api/rfq-sabloni"),
    enabled: jeKalk,
  });
  // izbor kolona stavki po korisniku i tipu dokumenta (stavka 15)
  const qc = useQueryClient();
  type KolonePrefs = { hidden: string[]; order?: string[]; width?: Record<string, number> };
  const profil = useQuery({
    queryKey: ["moj-profil"],
    queryFn: () => api<{ uiPrefs?: { stavkeKolone?: Record<string, KolonePrefs> } | null }>("/api/moj-profil"),
  });
  const kolonePrefs = profil.data?.uiPrefs?.stavkeKolone?.[tip];
  const skriveneKolone = kolonePrefs?.hidden ?? [];
  // pamcenje vidljivosti/redosleda/sirina kolona po (korisnik, tip dokumenta) - RP14
  async function snimiKolonePrefs(patch: Partial<KolonePrefs>) {
    const prefs = (profil.data?.uiPrefs ?? {}) as Record<string, unknown>;
    const sk = (profil.data?.uiPrefs?.stavkeKolone ?? {}) as Record<string, KolonePrefs>;
    const cur = sk[tip] ?? { hidden: [] };
    await api("/api/moj-profil", {
      method: "PUT",
      body: { uiPrefs: { ...prefs, stavkeKolone: { ...sk, [tip]: { ...cur, ...patch } } } },
    });
    void qc.invalidateQueries({ queryKey: ["moj-profil"] });
  }
  async function toggleKolona(kolId: string) {
    const hidden = skriveneKolone.includes(kolId) ? skriveneKolone.filter((h) => h !== kolId) : [...skriveneKolone, kolId];
    await snimiKolonePrefs({ hidden });
  }
  const skladista = useQuery({
    queryKey: ["skladista"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/skladista"),
    enabled: jeUlaz || jeOtpremnica || (jeRevers && (moduli.data?.zalihe ?? false)),
  });
  const sabloni = useQuery({
    queryKey: ["sabloni", tip],
    queryFn: () => api<{ id: number; naziv: string; isDefault: boolean }[]>(`/api/sabloni?tip=${tip}`),
    enabled: savedId !== null,
  });

  const porezi = (sifarnici.data ?? []).filter((l) => l.kind === "porez");
  const statusi = (sifarnici.data ?? []).filter((l) => l.kind === "status_dokumenta" && l.docType === tip);
  const lookup = (kind: string) => (sifarnici.data ?? []).filter((l) => l.kind === kind);
  const lookupLabel = (id: number | null) => (sifarnici.data ?? []).find((l) => l.id === id)?.internalValue ?? "";

  async function ucitaj(docId: number) {
    const doc = await api<Record<string, unknown>>(`/api/dokumenti/${docId}`);
    setTip(doc.tip as string);
    setBroj(doc.broj as string);
    setReferent((doc.referent as string) ?? "");
    setVeze(doc.veze as Veza[]);
    setAvansi((doc.avansi ?? null) as { veze: AvansVeza[]; ukupno: number } | null);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    setAvansIskorisceno(n(doc.avansIskorisceno));
    svezeUcitano.current = true;
    setD({
      ...(doc as unknown as DokumentForm),
      kurs: n(doc.kurs),
      datum: String(doc.datum).slice(0, 10),
      vaziDo: doc.vaziDo ? String(doc.vaziDo).slice(0, 10) : "",
      adresaSlanja: (doc.adresaSlanja ?? {}) as Record<string, string>,
      posrednik: (doc.posrednik ?? {}) as Record<string, string>,
      troskoviZaglavlje: (doc.troskoviZaglavlje ?? null) as Record<string, number | null> | null,
      datumFakture: doc.datumFakture ? String(doc.datumFakture).slice(0, 10) : null,
      ukupanTransport: n(doc.ukupanTransport),
      avansOsnovica: n(doc.avansOsnovica),
      avansIznos: n(doc.avansIznos),
    });
    primenjeno.current = { valuta: doc.valuta as string, kurs: n(doc.kurs) };
    setStavke(
      (doc.items as Record<string, unknown>[]).map((i) => ({
        id: i.id as number,
        articleId: i.articleId as number | null,
        ident: i.ident as string,
        naziv: i.naziv as string,
        kolicina: Number(i.kolicina),
        cena: Number(i.cena),
        popust: Number(i.popust),
        porezStopa: Number(i.porezStopa),
        rokIsporuke: i.rokIsporuke as string,
        napomena: i.napomena as string,
        opcioni: i.opcioni as boolean,
        serijskiBroj: i.serijskiBroj as string,
        nabavnaCena: n(i.nabavnaCena),
        kalk: (i.kalk ?? null) as Record<string, number | null> | null,
        vracenaKolicina: Number(i.vracenaKolicina ?? 0),
        potrebe: (i.potrebe ?? null) as Potreba[] | null,
        zemljaPorekla: (i.zemljaPorekla as string) ?? "",
        carinskaTarifa: (i.carinskaTarifa as string) ?? "",
        carinskaStopa: n(i.carinskaStopa),
        transportTrosak: n(i.transportTrosak),
        koleta: n(i.koleta),
        serijskiBrojevi: (i.serijskiBrojevi ?? null) as string[] | null,
        prenetaKolicina: Number(i.prenetaKolicina ?? 0),
      })),
    );
    if (doc.klijentId) void ucitajKontakte(doc.klijentId as number);
  }

  // bug st.21: kad roditelj promeni id (klik na vezani dokument) bez remount-a,
  // sinhronizuj savedId pa reload effect ispod povuce novi dokument
  useEffect(() => {
    setSavedId(id);
  }, [id]);

  useEffect(() => {
    if (savedId !== null) void ucitaj(savedId);
  }, [savedId]);

  // detekcija nesnimljenih izmena poredjenjem sa snapshotom
  useEffect(() => {
    const cur = JSON.stringify([d, stavke]);
    if (svezeUcitano.current) {
      snapshot.current = cur;
      svezeUcitano.current = false;
      setIzmenjen(false);
      return;
    }
    setIzmenjen(cur !== snapshot.current);
  }, [d, stavke]);

  // ulaz robe / otpremnica: skladiste automatski primarno (brief 8.7, 8.8)
  useEffect(() => {
    if ((jeUlaz || jeOtpremnica) && savedId === null && d.skladisteId === null && skladista.data?.length) {
      set("skladisteId", skladista.data[0]!.id); // lista je sortirana: primarno prvo
    }
  }, [jeUlaz, jeOtpremnica, skladista.data]);

  async function ucitajKontakte(subjekatId: number) {
    const s = await api<{ kontakti: Kontakt[] }>(`/api/subjekti/${subjekatId}`);
    setKontakti(s.kontakti);
    return s.kontakti;
  }

  function set<K extends keyof DokumentForm>(key: K, value: DokumentForm[K]) {
    const next = { ...d, [key]: value };
    // datum/rok/vazi-do medjusobno vezani (brief 7.1)
    if (key === "datum") next.vaziDo = plusDana(String(value), next.rokVazenja);
    if (key === "rokVazenja") next.vaziDo = plusDana(next.datum, Number(value));
    if (key === "vaziDo" && value) {
      next.rokVazenja = Math.round((new Date(String(value)).getTime() - new Date(next.datum).getTime()) / 86400000);
    }
    setD(next);
  }

  // izbor klijenta po nazivu ili PIB-u - snapshot podataka (brief 7.1)
  async function izaberiKlijenta(subjekatId: number) {
    const s = (klijenti.data ?? []).find((k) => k.id === subjekatId);
    if (!s) return;
    const kont = await ucitajKontakte(s.id);
    const def = kont.find((k) => k.isDefault) ?? kont[0];
    setD({
      ...d,
      klijentId: s.id,
      klijentNaziv: s.naziv,
      klijentPuniNaziv: s.puniNaziv,
      klijentPib: s.pib,
      klijentAdresa: s.adresa,
      klijentPostanskiBroj: s.postanskiBroj,
      klijentGrad: s.grad,
      nacinPlacanja: lookupLabel(s.nacinPlacanjaId),
      paritet: lookupLabel(s.paritetId),
      valuta: s.valuta,
      kontaktOsoba: def?.name ?? "",
      kontaktTelefon: def?.phone ?? "",
      kontaktEmail: def?.email ?? "",
    });
  }

  function izaberiKontakt(name: string) {
    const k = kontakti.find((x) => x.name === name);
    setD({ ...d, kontaktOsoba: name, kontaktTelefon: k?.phone ?? d.kontaktTelefon, kontaktEmail: k?.email ?? d.kontaktEmail });
  }

  // --- stavke ---

  function izmeniStavku(idx: number, izmena: Partial<Stavka>) {
    setStavke((prev) => prev.map((s, i) => (i === idx ? { ...s, ...izmena } : s)));
  }

  async function dodajArtikal(articleId: number, naIndex?: number) {
    const a = await api<Record<string, unknown>>(`/api/artikli/${articleId}`);
    const porez = porezi.find((p) => p.id === a.porezId) ?? porezi.find((p) => p.isDefault);
    const stopa = Number(porez?.rate ?? 0);
    const cena = a.prodajnaCena !== null
      ? r2(uValutuDokumenta(Number(a.prodajnaCena), a.prodajnaValuta as string, d.valuta, d.kurs))
      : 0;
    const nabavna = a.dobavljacevaCena !== null
      ? r2(uValutuDokumenta(Number(a.dobavljacevaCena), a.dobavljacevaValuta as string, d.valuta, d.kurs))
      : null;
    const nova: Stavka = {
      ...PRAZNA_STAVKA,
      articleId,
      ident: a.ident as string,
      naziv: a.naziv as string,
      // nabavni dokumenti: dobavljaceva cena + ocekivani popust iz artikla (brief 8.5)
      cena: jeNabavni ? (nabavna ?? 0) : cena,
      popust: jeNabavni ? Number(a.ocekivaniPopust ?? 0) : 0,
      porezStopa: stopa,
      nabavnaCena: nabavna,
      kalk: tip === "kalkulacija" ? { ...d.troskoviZaglavlje } : null,
      zemljaPorekla: jePriprema || jeUlaz ? ((a.zemljaPorekla as string) ?? "") : "",
      carinskaTarifa: jePriprema || jeUlaz ? ((a.carinskaTarifa as string) ?? "") : "",
      // snapshot procenta carine iz artikla (faza 15, RP7.3)
      carinskaStopa:
        (jePriprema || jeUlaz) && a.carinskaStopa !== null && a.carinskaStopa !== undefined
          ? Number(a.carinskaStopa)
          : null,
    };
    setStavke((prev) => {
      const next = [...prev];
      if (naIndex !== undefined && naIndex < next.length && jePrazna(next[naIndex]!)) next[naIndex] = nova;
      else next.push(nova);
      return next;
    });
  }

  // povezani artikli se ubacuju odmah ispod glavnog (brief 7.4)
  async function dodajPovezane(idx: number, ids: number[]) {
    const nove: Stavka[] = [];
    for (const aid of ids) {
      const a = await api<Record<string, unknown>>(`/api/artikli/${aid}`);
      const porez = porezi.find((p) => p.id === a.porezId) ?? porezi.find((p) => p.isDefault);
      nove.push({
        ...PRAZNA_STAVKA,
        articleId: aid,
        ident: a.ident as string,
        naziv: a.naziv as string,
        cena: a.prodajnaCena !== null ? r2(uValutuDokumenta(Number(a.prodajnaCena), a.prodajnaValuta as string, d.valuta, d.kurs)) : 0,
        porezStopa: Number(porez?.rate ?? 0),
        nabavnaCena: a.dobavljacevaCena !== null ? r2(uValutuDokumenta(Number(a.dobavljacevaCena), a.dobavljacevaValuta as string, d.valuta, d.kurs)) : null,
        kalk: tip === "kalkulacija" ? { ...d.troskoviZaglavlje } : null,
      });
    }
    setStavke((prev) => [...prev.slice(0, idx + 1), ...nove, ...prev.slice(idx + 1)]);
  }

  // preracun stavki pri promeni valute/kursa - dugme pored kursa (brief 7.4)
  function preracunajValutu() {
    const od = primenjeno.current;
    const konv = (cena: number) => {
      const uRsd = od.valuta === "RSD" ? cena : cena * (od.kurs ?? 1);
      return r2(d.valuta === "RSD" ? uRsd : uRsd / (d.kurs ?? 1));
    };
    setStavke((prev) =>
      prev.map((s) => (jePrazna(s) ? s : { ...s, cena: konv(s.cena), nabavnaCena: s.nabavnaCena !== null ? konv(s.nabavnaCena) : null })),
    );
    primenjeno.current = { valuta: d.valuta, kurs: d.kurs };
    setPoruka("Stavke preračunate u " + d.valuta);
  }

  // vraca kurs i cene na vrednosti iz artikla (brief 7.4)
  async function ponovoPreracunaj() {
    const next: Stavka[] = [];
    for (const s of stavke) {
      if (jePrazna(s) || s.articleId === null) {
        next.push(s);
        continue;
      }
      const a = await api<Record<string, unknown>>(`/api/artikli/${s.articleId}`);
      next.push({
        ...s,
        popust: 0,
        cena: a.prodajnaCena !== null ? r2(uValutuDokumenta(Number(a.prodajnaCena), a.prodajnaValuta as string, d.valuta, d.kurs)) : s.cena,
        nabavnaCena: a.dobavljacevaCena !== null ? r2(uValutuDokumenta(Number(a.dobavljacevaCena), a.dobavljacevaValuta as string, d.valuta, d.kurs)) : s.nabavnaCena,
      });
    }
    setStavke(next);
    setPoruka("Cene vraćene na vrednosti iz artikala");
  }

  // raspodela ukupnog transporta proporcionalno ucescu stavke u sumi (brief 8.6)
  function rasporediTransport() {
    const ukupno = d.ukupanTransport ?? 0;
    const suma = stavke.filter((s) => !jePrazna(s)).reduce((a, s) => a + sumaBezPdv(s), 0);
    if (!suma) return;
    setStavke((prev) =>
      prev.map((s) => (jePrazna(s) ? s : { ...s, transportTrosak: r2((sumaBezPdv(s) / suma) * ukupno) })),
    );
    setPoruka("Transport raspoređen po artiklima");
  }

  // prenos izabranih redova obracuna u porudzbinu - kolicine se sabiraju po artiklu (brief 8.5)
  function ubaciIzObracuna(redovi: ObracunRed[]) {
    setStavke((prev) => {
      let next = prev.filter((s) => !jePrazna(s));
      for (const r of redovi) {
        if (r.predlog <= 0) continue;
        const idx = next.findIndex((s) => s.articleId === r.articleId);
        if (idx >= 0) {
          next = next.map((x, i) =>
            i === idx
              ? { ...x, kolicina: x.kolicina + r.predlog, potrebe: [...(x.potrebe ?? []), ...r.potrebeLista] }
              : x,
          );
        } else {
          const porez = porezi.find((p) => p.id === r.porezId) ?? porezi.find((p) => p.isDefault);
          next = [
            ...next,
            {
              ...PRAZNA_STAVKA,
              articleId: r.articleId,
              ident: r.ident,
              naziv: r.naziv,
              kolicina: r.predlog,
              cena: r.dobavljacevaCena !== null ? r2(uValutuDokumenta(r.dobavljacevaCena, r.dobavljacevaValuta, d.valuta, d.kurs)) : 0,
              popust: r.ocekivaniPopust,
              porezStopa: Number(porez?.rate ?? 0),
              potrebe: r.potrebeLista.length ? r.potrebeLista : null,
            },
          ];
        }
      }
      return next;
    });
    setPoruka("Stavke iz obračuna ubačene u porudžbinu");
  }

  // trosak unet u zaglavlju kalkulacije puni sve stavke (brief 8.4)
  function setTrosakZaglavlja(tid: string, v: number | null) {
    set("troskoviZaglavlje", { ...d.troskoviZaglavlje, [tid]: v });
    if (v !== null) setStavke((prev) => prev.map((s) => (jePrazna(s) ? s : { ...s, kalk: { ...s.kalk, [tid]: v } })));
  }

  // --- cenovni pregled (brief 7.1) ---
  const pune = stavke.filter((s) => !jePrazna(s) && !s.opcioni);
  const bruto = pune.reduce((a, s) => a + s.cena * s.kolicina, 0);
  const neto = pune.reduce((a, s) => a + sumaBezPdv(s), 0);
  const saPdv = pune.reduce((a, s) => a + sumaSaPdv(s), 0);
  const rabatIznos = bruto - neto;
  const rabatPct = bruto ? (rabatIznos / bruto) * 100 : 0;
  const zarade = pune.map(zaradaStavke).filter((z): z is number => z !== null);
  const zarada = zarade.length ? zarade.reduce((a, z) => a + z, 0) : null;

  // totalni rabat se upisuje u sve stavke (brief 7.1)
  function setRabatPct(pct: number) {
    setStavke((prev) => prev.map((s) => (jePrazna(s) ? s : { ...s, popust: r2(pct) })));
  }

  async function sacuvaj() {
    setError("");
    setPoruka("");
    const body = {
      ...d,
      vaziDo: d.vaziDo || null,
      items: stavke.filter((s) => !jePrazna(s)),
    };
    try {
      if (savedId === null) {
        const created = await api<{ id: number; broj: string }>("/api/dokumenti", {
          method: "POST",
          body: { ...body, tip },
        });
        setSavedId(created.id);
        setPoruka(`Sačuvano - broj dokumenta ${created.broj}`);
      } else {
        await api(`/api/dokumenti/${savedId}`, { method: "PUT", body });
        lockDrzim.current = false; // uspesno snimanje otpusta lock na serveru
        await ucitaj(savedId);
        setPoruka("Sačuvano");
      }
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri snimanju");
      return false;
    }
  }

  // Export upita po xlsx sablonu dobavljaca (zamenio genericki RFQ iz faze 15):
  // server popunjava template iz konfiguracije i vraca gotov fajl; 400 sa listom
  // problema (pogresan dobavljac, bez SKU, nemapirana kategorija...) ide u popup
  async function exportRfq(sablon: { id: string; imeFajla: string }) {
    setError("");
    setPoruka("");
    try {
      const res = await apiFetch(`/api/dokumenti/${savedId}/rfq/${sablon.id}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          problemi?: { naziv: string; problem: string }[];
        } | null;
        if (data?.problemi?.length) {
          setRfqProblemi(data.problemi);
          return;
        }
        throw new ApiError(res.status, data?.error ?? `Greška ${res.status}`);
      }
      const blob = await res.blob();
      await sacuvajFajl(`${sablon.imeFajla}-${broj.replace(/[^\w-]/g, "_")}.xlsx`, blob);
      setPoruka("Upit exportovan");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška pri exportu upita");
    }
  }

  async function kloniraj() {
    if (savedId === null) return;
    const klon = await api<{ id: number; broj: string }>(`/api/dokumenti/${savedId}/kloniraj`, { method: "POST" });
    setSavedId(klon.id);
    setPoruka(`Kloniran u ${klon.broj}`);
  }

  const cilji: { tip: string; label: string }[] = [];
  if (tip === "kalkulacija") cilji.push({ tip: "ponuda", label: "Generiši ponudu" });
  if (tip === "ponuda") cilji.push({ tip: "predracun", label: "Generiši predračun" });
  if (tip === "porudzbina") cilji.push({ tip: "priprema_uvoza", label: "Kreiraj pripremu" });
  if (jePriprema) cilji.push({ tip: "ulaz_robe", label: "Kreiraj uvoz" });
  // prodajni lanac (brief 8.8-8.10)
  if (tip === "predracun") {
    cilji.push({ tip: "otpremnica", label: "Generiši otpremnicu" });
    cilji.push({ tip: "racun", label: "Generiši račun" });
    cilji.push({ tip: "avansni_racun", label: "Generiši avansni račun" });
  }
  if (jeOtpremnica) cilji.push({ tip: "racun", label: "Kreiraj račun" });
  if (!jeRevers && !jeNabavni && !jeAvans) cilji.push({ tip: "revers", label: "Generiši revers" });

  // skladiste selektor deljen izmedju kompaktnog reda ulaza i reda otpremnice (faza 16 RP5)
  const skladisteSelect = (
    <label className="field" style={{ width: 200 }}>
      {jeUlaz ? "Prijemno skladište" : "Izdajno skladište"}
      <select
        className="input"
        value={d.skladisteId ?? ""}
        onChange={(e) => set("skladisteId", e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Bez skladišta</option>
        {(skladista.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.naziv}
          </option>
        ))}
      </select>
    </label>
  );

  const klijentOpcije: AutocompleteOption[] = (klijenti.data ?? []).map((k) => ({ id: k.id, label: k.naziv }));
  const pibOpcije: AutocompleteOption[] = (klijenti.data ?? []).filter((k) => k.pib).map((k) => ({ id: k.id, label: k.pib }));

  return (
    <>
      <button className="btn" style={{ marginBottom: 8 }} onClick={() => (izmenjen ? setNazadPopup(true) : onBack())}>
        &larr; Nazad
      </button>
      {nazadPopup && (
        <div className="overlay">
          <div className="popup">
            <h2>Nesnimljene izmene</h2>
            <p>Dokument ima nesnimljene izmene.</p>
            <div className="actions">
              <button
                className="btn primary"
                onClick={async () => {
                  const ok = await sacuvaj();
                  setNazadPopup(false);
                  if (ok) onBack();
                }}
              >
                Snimi i izađi
              </button>
              <button className="btn subtle" onClick={() => { setNazadPopup(false); onBack(); }}>
                Izađi bez snimanja
              </button>
              <button className="btn" onClick={() => setNazadPopup(false)}>
                Odustani
              </button>
            </div>
          </div>
        </div>
      )}
      {lockPoruka && (
        <div className="overlay">
          <div className="popup" style={{ width: 420 }}>
            <h2>Dokument je zaključan</h2>
            <p>{lockPoruka}. Vaša izmena je poništena - pokušajte ponovo kada korisnik završi.</p>
            <div className="actions">
              <button className="btn primary" onClick={() => setLockPoruka("")}>
                U redu
              </button>
            </div>
          </div>
        </div>
      )}
      {rfqProblemi && (
        <div className="overlay">
          <div className="popup" style={{ width: 480 }}>
            <h2>Upit nije moguće generisati</h2>
            <p>Ispravite sledeće stavke pa pokušajte ponovo:</p>
            <ul style={{ maxHeight: 300, overflowY: "auto", margin: "8px 0", paddingLeft: 20 }}>
              {rfqProblemi.map((p, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{p.naziv}</strong> - {p.problem}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn primary" onClick={() => setRfqProblemi(null)}>
                U redu
              </button>
            </div>
          </div>
        </div>
      )}
      {brisanjePopup && (
        <div className="overlay">
          <div className="popup">
            <h2>Brisanje dokumenta</h2>
            <p>
              Dokument {broj} će biti trajno obrisan, zajedno sa stavkama i knjiženjima zaliha. Ova akcija je
              nepovratna.
            </p>
            <div className="actions">
              <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={obrisiDokument}>
                Obriši trajno
              </button>
              <button className="btn" onClick={() => setBrisanjePopup(false)}>
                Odustani
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="page-head">
        <h1>
          {TIP_INFO[tip]?.label ?? tip} {broj && <span className="subtle">{broj}</span>}
          {jeRevers && d.smer && <span className="subtle"> ({d.smer})</span>}
        </h1>
        <div style={{ display: "flex", gap: 8, position: "relative" }}>
          {jeRevers && d.smer === "izdavanje" && savedId !== null && (
            <button className="btn" onClick={() => setPopup({ vrsta: "generisi", cilj: "revers" })}>
              Povrat
            </button>
          )}
          {savedId !== null && (
            <div style={{ display: "flex", position: "relative" }}>
              {/* split dugme (brief 7.7): klik = podrazumevani sablon, strelica = izbor */}
              <button className="btn" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} onClick={() => setPopup({ vrsta: "izvestaj" })}>
                Izveštaj
              </button>
              <button
                className="btn"
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 0, padding: "0 7px" }}
                onClick={() => setIzvestajMeni(!izvestajMeni)}
              >
                &#9662;
              </button>
              {izvestajMeni && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    zIndex: 10,
                    background: "var(--bg, #fff)",
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 180,
                  }}
                  onClick={() => setIzvestajMeni(false)}
                >
                  {(sabloni.data ?? []).map((s) => (
                    <button key={s.id} className="btn" onClick={() => setPopup({ vrsta: "izvestaj", sablon: s.id })}>
                      {s.naziv}
                      {s.isDefault ? " (podrazumevani)" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="btn primary" onClick={sacuvaj}>
            Sačuvaj
          </button>
          <button className="btn" onClick={() => setMeni(!meni)}>
            ...
          </button>
          {meni && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                zIndex: 10,
                background: "var(--bg, #fff)",
                border: "1px solid #ccc",
                borderRadius: 4,
                display: "flex",
                flexDirection: "column",
                minWidth: 220,
              }}
              onClick={() => setMeni(false)}
            >
              {savedId !== null && (
                <>
                  <button className="btn" onClick={kloniraj}>
                    Kloniraj
                  </button>
                  {jeKalk &&
                    rfqSabloni.data?.map((s) => (
                      <button key={s.id} className="btn" onClick={() => void exportRfq(s)}>
                        {s.label}
                      </button>
                    ))}
                  {cilji.map((c) => (
                    <button key={c.tip} className="btn" onClick={() => setPopup({ vrsta: "generisi", cilj: c.tip })}>
                      {c.label}
                    </button>
                  ))}
                  <button className="btn" onClick={() => setPopup({ vrsta: "log" })}>
                    Log izmena
                  </button>
                  {/* brisanje: posebna privilegija, UVEK poslednja stavka (faza 16, RP6) */}
                  {smeBrisanje && (
                    <button className="btn" style={{ color: "var(--danger, #c00)" }} onClick={() => setBrisanjePopup(true)}>
                      Obriši dokument
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      {poruka && <p style={{ fontSize: 12, marginBottom: 8 }}>{poruka}</p>}

      {veze.length > 0 && (
        <p style={{ fontSize: 12, marginBottom: 8 }}>
          Vezani dokumenti:{" "}
          {veze.map((v) => (
            <a key={v.id} style={{ marginRight: 10, cursor: "pointer", textDecoration: "underline" }} onClick={() => onOpenDoc(v.id)}>
              {v.broj} ({TIP_INFO[v.tip]?.label ?? v.tip}, {v.status})
            </a>
          ))}
        </p>
      )}

      {/* Zaglavlje: tri sekcije u jednoj traci (brief 7.1) */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 1. Klijent sa karticama */}
        <div style={{ flex: 2, minWidth: 380, border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {(["klijent", "adresa", "posrednik"] as const).map((k) => (
              <button key={k} className={`btn${kartica === k ? " primary" : ""}`} style={{ padding: "2px 10px" }} onClick={() => setKartica(k)}>
                {k === "klijent" ? (jeNabavni ? "Dobavljač" : "Klijent") : k === "adresa" ? "Adresa slanja" : "Posrednik"}
              </button>
            ))}
          </div>
          {kartica === "klijent" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <label
                  className="field"
                  style={{ flex: 1 }}
                  title={d.klijentId !== null ? "Dvoklik otvara subjekat" : undefined}
                  onDoubleClick={otvoriSubjekat}
                >
                  Naziv (interni)
                  <Autocomplete
                    options={klijentOpcije}
                    value={d.klijentId !== null ? { id: d.klijentId, label: d.klijentNaziv } : null}
                    onChange={(o) => o && izaberiKlijenta(Number(o.id))}
                    placeholder="kucaj naziv..."
                  />
                </label>
                <label className="field" style={{ width: 140 }}>
                  PIB
                  <Autocomplete
                    options={pibOpcije}
                    value={d.klijentPib ? { id: d.klijentId ?? d.klijentPib, label: d.klijentPib } : null}
                    onChange={(o) => o && izaberiKlijenta(Number(o.id))}
                    placeholder="kucaj PIB..."
                  />
                </label>
              </div>
              <label className="field">
                Puni naziv
                <input className="input" value={d.klijentPuniNaziv} onChange={(e) => set("klijentPuniNaziv", e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ flex: 2 }}>
                  Adresa
                  <input className="input" value={d.klijentAdresa} onChange={(e) => set("klijentAdresa", e.target.value)} />
                </label>
                <label className="field" style={{ width: 90 }}>
                  Pošt. broj
                  <input className="input" value={d.klijentPostanskiBroj} onChange={(e) => set("klijentPostanskiBroj", e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Grad
                  <input className="input" value={d.klijentGrad} onChange={(e) => set("klijentGrad", e.target.value)} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  Kontakt osoba
                  <input
                    className="input"
                    list="kontakti-list"
                    value={d.kontaktOsoba}
                    onChange={(e) => izaberiKontakt(e.target.value)}
                  />
                  <datalist id="kontakti-list">
                    {kontakti.map((k) => (
                      <option key={k.name} value={k.name} />
                    ))}
                  </datalist>
                </label>
                <label className="field" style={{ width: 130 }}>
                  Telefon
                  <input className="input" value={d.kontaktTelefon} onChange={(e) => set("kontaktTelefon", e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Mail
                  <input className="input" value={d.kontaktEmail} onChange={(e) => set("kontaktEmail", e.target.value)} />
                </label>
              </div>
            </div>
          )}
          {kartica === "adresa" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ADRESA_POLJA.map((p) => (
                <label key={p.id} className="field">
                  {p.label}
                  <input
                    className="input"
                    value={d.adresaSlanja[p.id] ?? ""}
                    onChange={(e) => set("adresaSlanja", { ...d.adresaSlanja, [p.id]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          {kartica === "posrednik" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {POSREDNIK_POLJA.map((p) => (
                <label key={p.id} className="field">
                  {p.label}
                  <input
                    className="input"
                    value={d.posrednik[p.id] ?? ""}
                    onChange={(e) => set("posrednik", { ...d.posrednik, [p.id]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 2. Podaci dokumenta */}
        <div style={{ flex: 2, minWidth: 340, border: "1px solid #ddd", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="field" style={{ width: 80 }}>
              Valuta
              <select className="input" value={d.valuta} onChange={(e) => set("valuta", e.target.value)}>
                {["RSD", "EUR", "USD"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {!jeRevers && (
              <label className="field" style={{ width: 160 }}>
                Kurs {d.valuta !== "RSD" && d.kurs ? `(${d.valuta}=${d.kurs} RSD)` : ""}
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    value={d.kurs ?? ""}
                    onChange={(e) => set("kurs", e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
                  />
                  <button className="btn" title="Preračunaj postojeće stavke po novoj valuti/kursu" onClick={preracunajValutu}>
                    ⟳
                  </button>
                </div>
              </label>
            )}
            <label className="field" style={jeNabavni ? { width: 150 } : { flex: 1 }}>
              Status
              <select className="input" value={d.status} onChange={(e) => set("status", e.target.value)}>
                {!statusi.some((s) => s.internalValue === d.status) && <option value={d.status}>{d.status}</option>}
                {statusi.map((s) => (
                  <option key={s.id} value={s.internalValue}>
                    {s.internalValue}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="field" style={jeNabavni ? { width: 140 } : { flex: 1 }}>
              Paritet
              <ParitetSelect
                value={d.paritet}
                opcije={lookup("paritet").map((l) => ({ id: l.id, internalValue: l.internalValue, externalValue: l.externalValue }))}
                onChange={(v) => set("paritet", v)}
              />
            </label>
            <label className="field" style={jeNabavni ? { width: 150 } : { flex: 1 }}>
              Način plaćanja
              <select className="input" value={d.nacinPlacanja} onChange={(e) => set("nacinPlacanja", e.target.value)}>
                <option value="" />
                {lookup("nacin_placanja").map((l) => (
                  <option key={l.id} value={l.internalValue}>
                    {l.internalValue}
                  </option>
                ))}
              </select>
            </label>
            {jeNabavni && (
              <label className="field" style={{ width: "30ch" }}>
                Referent
                <input className="input" value={referent || "(kreator)"} disabled />
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="field">
              Datum
              <input type="date" className="input" value={d.datum} onChange={(e) => set("datum", e.target.value)} />
            </label>
            {/* rok vazenja (st.19): uklonjen za pripremu uvoza i ulaz robe */}
            {!jePriprema && !jeUlaz && (
              <>
                <label className="field" style={{ width: 70 }}>
                  Rok (dana)
                  <input
                    className="input"
                    value={d.rokVazenja}
                    onChange={(e) => set("rokVazenja", Number(e.target.value) || 0)}
                  />
                </label>
                <label className="field">
                  Važi do
                  <input type="date" className="input" value={d.vaziDo} onChange={(e) => set("vaziDo", e.target.value)} />
                </label>
              </>
            )}
            {jeNabavni && (
              <label className="field" style={{ width: 120 }}>
                Broj dokumenta
                <input className="input" value={broj || "(pri snimanju)"} disabled />
              </label>
            )}
          </div>
          {!jeNabavni && (
            <div style={{ display: "flex", gap: 8 }}>
              <label className="field" style={{ width: 120 }}>
                Broj dokumenta
                <input className="input" value={broj || "(pri snimanju)"} disabled />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Referent
                <input className="input" value={referent || "(kreator)"} disabled />
              </label>
              {/* referenca kupca i na otpremnici/racunu (brief 8.8, 8.9) */}
              {(tip === "ponuda" || tip === "predracun" || jeOtpremnica || jeRacun) && (
                <label className="field" style={{ flex: 1 }}>
                  Referenca kupca
                  <input className="input" value={d.referencaKupca} onChange={(e) => set("referencaKupca", e.target.value)} />
                </label>
              )}
            </div>
          )}
          {jeRevers && (
            <div style={{ display: "flex", gap: 8 }}>
              <label className="field" style={{ width: 140 }}>
                Smer
                <select className="input" value={d.smer ?? "izdavanje"} onChange={(e) => set("smer", e.target.value)}>
                  <option value="izdavanje">Izdavanje</option>
                  <option value="povrat">Povrat</option>
                </select>
              </label>
              {moduli.data?.zalihe && (
                <label className="field" style={{ width: 180 }}>
                  {d.smer === "povrat" ? "Prijemno skladište" : "Izdajno skladište"}
                  <select
                    className="input"
                    value={d.skladisteId ?? ""}
                    onChange={(e) => set("skladisteId", e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">Bez skladišta</option>
                    {(skladista.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.naziv}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {jeKalk && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {KALK_TROSKOVI.map((t) => (
                <label key={t.id} className="field" style={{ width: 90 }}>
                  {t.label} %
                  <input
                    className="input"
                    value={d.troskoviZaglavlje?.[t.id] ?? ""}
                    onChange={(e) => setTrosakZaglavlja(t.id, e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
                  />
                </label>
              ))}
            </div>
          )}
          {(jePriprema || jeUlaz) && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field" style={{ width: "20ch" }}>
                Broj fakture dobavljača
                <input className="input" value={d.brojFakture} onChange={(e) => set("brojFakture", e.target.value)} />
              </label>
              <label className="field">
                Datum fakture
                <input
                  type="date"
                  className="input"
                  value={d.datumFakture ?? ""}
                  onChange={(e) => set("datumFakture", e.target.value || null)}
                />
              </label>
              {jePriprema && (
                <>
                  <label className="field" style={{ width: 150 }}>
                    Ukupan transport
                    <input
                      className="input"
                      value={d.ukupanTransport ?? ""}
                      onChange={(e) => set("ukupanTransport", e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
                    />
                  </label>
                  <button className="btn" onClick={rasporediTransport}>
                    Rasporedi po artiklima
                  </button>
                </>
              )}
              {jeUlaz && skladisteSelect}
            </div>
          )}
          {jeOtpremnica && skladisteSelect}
        </div>

        {/* 3. Cenovni pregled */}
        {!jeRevers && !jeAvans && (
          <div style={{ flex: 1, minWidth: 220, border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Osnovica:</span>
              <b>
                {fmt(neto)} {d.valuta}
              </b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Porez:</span>
              <b>
                {fmt(saPdv - neto)} {d.valuta}
              </b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span>Suma:</span>
              <b>
                {fmt(saPdv)} {d.valuta}
              </b>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
              <span style={{ flex: 1 }}>Rabat:</span>
              <RabatPolje value={r2(rabatPct)} sufiks="%" onCommit={setRabatPct} />
              <RabatPolje value={r2(rabatIznos)} sufiks={d.valuta} onCommit={(izn) => setRabatPct(bruto ? (izn / bruto) * 100 : 0)} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Procenjena zarada:</span>
              <b>{zarada !== null ? `${fmt(zarada)} ${d.valuta}` : "-"}</b>
            </div>
            {/* finansije racuna: avansno uplaceno i preostalo (brief 8.10) */}
            {jeRacun && savedId !== null && (
              <div style={{ borderTop: "1px solid #ddd", marginTop: 6, paddingTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Avansno uplaćeno:</span>
                  <b>
                    {fmt(avansi?.ukupno ?? 0)} {d.valuta}
                  </b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Preostalo za uplatu:</span>
                  <b>
                    {fmt(saPdv - (avansi?.ukupno ?? 0))} {d.valuta}
                  </b>
                </div>
                {(avansi?.veze ?? []).map((v, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, fontSize: 12 }} className="subtle">
                    <span>{v.broj}</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {fmt(v.iznos)}
                      <button
                        className="btn"
                        style={{ padding: "0 6px" }}
                        title="Odveži avans"
                        onClick={async () => {
                          if (!confirm(`Odvezati avans ${v.broj} (${fmt(v.iznos)})?`)) return;
                          try {
                            await api(`/api/avansi/${v.avansId}/odvezi`, { method: "POST", body: { racunId: savedId } });
                            await ucitaj(savedId!);
                          } catch (e) {
                            setError(e instanceof ApiError ? e.message : "Odvezivanje nije uspelo");
                          }
                        }}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                <button className="btn" style={{ marginTop: 4 }} onClick={() => setPopup({ vrsta: "veziAvans" })}>
                  Veži avans
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Avansni racun (brief 8.10): umesto tabele artikala jedan red za unos sume */}
      {jeAvans ? (
        <AvansRed d={d} setD={setD} porezi={porezi} iskorisceno={avansIskorisceno} />
      ) : (
        <>
          {/* Traka sa alatima + stavke (brief 7.4) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <button className="btn" onClick={() => setPopup({ vrsta: "pretraga" })}>
              Pretraga artikala
            </button>
            {tip === "porudzbina" && (
              <button
                className="btn"
                title={d.klijentId === null ? "Prvo izaberite dobavljača" : ""}
                disabled={d.klijentId === null}
                onClick={() => setPopup({ vrsta: "obracun" })}
              >
                🪄 Obračun narudžbina
              </button>
            )}
            {/* dodatne opcije stavki skroz desno (stavka 15) */}
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <button className="btn" title="Dodatne opcije" onClick={() => setStavkeMeni(!stavkeMeni)}>
                ...
              </button>
              {stavkeMeni && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    zIndex: 10,
                    background: "var(--surface)",
                    border: "1px solid var(--line-strong)",
                    borderRadius: "var(--radius)",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 240,
                    boxShadow: "0 4px 12px rgba(0,0,0,.12)",
                  }}
                  onClick={() => setStavkeMeni(false)}
                >
                  <button className="btn" onClick={() => setPopup({ vrsta: "prenumeracija" })}>
                    Prenumeriši pozicije
                  </button>
                  <button className="btn" onClick={ponovoPreracunaj}>
                    Ponovo potraži prodajne cene
                  </button>
                  {/* povlacenje list price cena iz cenovnika dobavljaca (faza 17, RP12) */}
                  {(tip === "kalkulacija" || tip === "ponuda" || tip === "predracun") && (
                    <button className="btn" onClick={() => setPopup({ vrsta: "cenovnikCene" })}>
                      Povuci cene iz cenovnika
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={(e) => setPopup({ vrsta: "kolone", rect: e.currentTarget.getBoundingClientRect() })}
                  >
                    Izbor kolona
                  </button>
                </div>
              )}
            </div>
          </div>
          <StavkeTabela
            tip={tip}
            stavke={stavke}
            porezi={porezi}
            tarife={lookup("carinska_tarifa")}
            artikli={artikli.data ?? []}
            valuta={d.valuta}
            onIzmena={izmeniStavku}
            onIzborArtikla={(idx, aid) => void dodajArtikal(aid, idx)}
            onOtvoriArtikal={otvoriArtikal}
            onNapomena={(idx, rect) => setPopup({ vrsta: "napomena", idx, rect })}
            onPovezani={(idx, rect) => setPopup({ vrsta: "povezani", idx, rect })}
            onObrisi={(idx) => setStavke((prev) => prev.filter((_, i) => i !== idx))}
            onNoviRed={() => setStavke((prev) => [...prev, { ...PRAZNA_STAVKA }])}
            skrivene={skriveneKolone}
            redosled={kolonePrefs?.order}
            sirine={kolonePrefs?.width}
            onRedosled={(order) => void snimiKolonePrefs({ order })}
            onSirina={(id, w) => void snimiKolonePrefs({ width: { ...(kolonePrefs?.width ?? {}), [id]: w } })}
            onPotrebe={tip === "porudzbina" ? (idx) => setPopup({ vrsta: "potrebe", idx }) : undefined}
            onSerijski={
              jeUlaz || jeRacun
                ? (idx) => setPopup({ vrsta: "serijski", idx })
                : jeOtpremnica
                  ? (idx) => setPopup({ vrsta: "izborSerijskih", idx })
                  : undefined
            }
          />
        </>
      )}

      {popup?.vrsta === "kolone" && (
        <AnchorDropdown rect={popup.rect} width={220} onClose={() => setPopup(null)}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Vidljive kolone</div>
          {dostupneKolone(tip).map((k) => (
            <label key={k.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={!skriveneKolone.includes(k.id)}
                onChange={() => void toggleKolona(k.id)}
              />
              {k.label}
            </label>
          ))}
        </AnchorDropdown>
      )}
      {popup?.vrsta === "pretraga" && (
        <PretragaPopup
          onPick={(ids) => {
            for (const aid of ids) void dodajArtikal(aid);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "napomena" && (
        <NapomenaPopup
          rect={popup.rect}
          value={stavke[popup.idx]?.napomena ?? ""}
          onSave={(v) => {
            izmeniStavku(popup.idx, { napomena: v });
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "povezani" && (
        <PovezaniPopup
          rect={popup.rect}
          articleId={stavke[popup.idx]?.articleId ?? null}
          onPick={(ids) => {
            void dodajPovezane(popup.idx, ids);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "prenumeracija" && (
        <PrenumeracijaPopup
          stavke={stavke.filter((s) => !jePrazna(s))}
          onSave={(nove) => {
            setStavke(nove);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "generisi" && savedId !== null && (
        <GenerisiPopup
          docId={savedId}
          srcTip={tip}
          cilj={popup.cilj}
          jePovrat={jeRevers && popup.cilj === "revers"}
          onDone={(noviId) => {
            setPopup(null);
            void ucitaj(savedId); // izvor se mogao arhivirati / preneta kolicina promenjena
            onOpenDoc(noviId);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "obracun" && d.klijentId !== null && (
        <ObracunPopup
          dobavljacId={d.klijentId}
          dobavljacNaziv={d.klijentNaziv}
          onUbaci={(redovi) => {
            ubaciIzObracuna(redovi);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "potrebe" && (
        <PotrebePopup potrebe={stavke[popup.idx]?.potrebe ?? []} onClose={() => setPopup(null)} />
      )}
      {popup?.vrsta === "serijski" && (
        <SerijskiPopup
          kolicina={stavke[popup.idx]?.kolicina ?? 0}
          value={stavke[popup.idx]?.serijskiBrojevi ?? []}
          onSave={(brojevi) => {
            izmeniStavku(popup.idx, { serijskiBrojevi: brojevi.length ? brojevi : null });
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "izborSerijskih" && (
        <IzborSerijskihPopup
          articleId={stavke[popup.idx]?.articleId ?? null}
          skladisteId={d.skladisteId}
          kolicina={stavke[popup.idx]?.kolicina ?? 0}
          value={stavke[popup.idx]?.serijskiBrojevi ?? []}
          onSave={(brojevi) => {
            izmeniStavku(popup.idx, { serijskiBrojevi: brojevi.length ? brojevi : null });
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "veziAvans" && savedId !== null && (
        <VeziAvansPopup
          racunId={savedId}
          maxRacun={saPdv - (avansi?.ukupno ?? 0)}
          onDone={() => {
            setPopup(null);
            void ucitaj(savedId);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "cenovnikCene" && (
        <CenovnikCenePopup
          stavke={stavke}
          docValuta={d.valuta}
          onApply={(nove) => setStavke(nove)}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.vrsta === "log" && savedId !== null && <LogPopup docId={savedId} onClose={() => setPopup(null)} />}
      {popup?.vrsta === "izvestaj" && savedId !== null && (
        <IzvestajPopup
          docId={savedId}
          tip={tip}
          broj={broj}
          kontaktEmail={d.kontaktEmail}
          sablonId={popup.sablon}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}

// Rabat: dva vezana polja, oba kucljiva (brief 7.1)
function RabatPolje({ value, sufiks, onCommit }: { value: number; sufiks: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <input
        className="input"
        style={{ width: 65, textAlign: "right" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft.replace(",", "."));
          if (!isNaN(n)) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = Number(draft.replace(",", "."));
            if (!isNaN(n)) onCommit(n);
          }
        }}
      />
      <span style={{ fontSize: 11 }}>{sufiks}</span>
    </span>
  );
}

// Baloncic sa listom dokumenata/klijenata za koje se porucuje (brief 8.5)
function PotrebePopup({ potrebe, onClose }: { potrebe: Potreba[]; onClose: () => void }) {
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 420 }}>
        <h2>Poručuje se za</h2>
        {potrebe.length === 0 ? (
          <p style={{ fontSize: 12, marginBottom: 10 }}>Ručno dodata stavka - bez predračuna i klijenta.</p>
        ) : (
          <table className="data" style={{ marginBottom: 10 }}>
            <thead>
              <tr>
                <th>Predračun</th>
                <th>Klijent</th>
                <th>Kol.</th>
              </tr>
            </thead>
            <tbody>
              {potrebe.map((p, i) => (
                <tr key={i}>
                  <td>{p.broj}</td>
                  <td>{p.klijentNaziv}</td>
                  <td style={{ textAlign: "right" }}>{p.kolicina}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="btn primary" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </div>
  );
}

// Unos serijskih brojeva za ulaz robe (brief 8.7): veliki textbox sa parsiranjem i potvrdom
function SerijskiPopup({
  kolicina,
  value,
  onSave,
  onClose,
}: {
  kolicina: number;
  value: string[];
  onSave: (brojevi: string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  // parsiranje: novi red, zarez ili tacka-zarez razdvajaju brojeve
  const brojevi = text.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s !== "");
  const duplikati = brojevi.filter((b, i) => brojevi.indexOf(b) !== i);
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 460 }}>
        <h2>Serijski brojevi</h2>
        <p style={{ fontSize: 12, marginBottom: 6 }}>
          Nalepite ili ukucajte brojeve (novi red, zarez ili tačka-zarez). Prepoznato: <b>{brojevi.length}</b> / potrebno {kolicina}
          {duplikati.length > 0 && <span style={{ color: "crimson" }}> - duplikati: {[...new Set(duplikati)].join(", ")}</span>}
        </p>
        <textarea
          className="input"
          rows={10}
          style={{ width: "100%", marginBottom: 10, resize: "vertical", fontFamily: "monospace" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={duplikati.length > 0} onClick={() => onSave(brojevi)}>
            Potvrdi ({brojevi.length})
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Padajuci meni usidren uz mesto klika (stavka 36): renderuje se kroz portal
// tako da ne zavisi od overflow-a tabele; klik van njega ga zatvara
function AnchorDropdown({
  rect,
  width,
  onClose,
  children,
}: {
  rect: DOMRect;
  width: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const zatvori = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", zatvori);
    return () => document.removeEventListener("mousedown", zatvori);
  }, [onClose]);
  // drzi meni u vidljivom delu ekrana po horizontali
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: rect.bottom + 2,
        left: Math.max(8, left),
        width,
        zIndex: 70,
        background: "var(--surface)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--radius)",
        boxShadow: "0 6px 18px rgba(0,0,0,.14)",
        padding: 10,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function NapomenaPopup({ rect, value, onSave, onClose }: { rect: DOMRect; value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  return (
    <AnchorDropdown rect={rect} width={320} onClose={onClose}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Napomena stavke</div>
      <textarea
        className="input"
        rows={4}
        maxLength={300}
        autoFocus
        style={{ width: "100%", marginBottom: 8, resize: "vertical" }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={() => onSave(text)}>
          Sačuvaj
        </button>
        <button className="btn" onClick={onClose}>
          Otkaži
        </button>
      </div>
    </AnchorDropdown>
  );
}

// Povezani artikli stavke - multi izbor (brief 7.4), usidreno uz plusic (stavka 36)
function PovezaniPopup({
  rect,
  articleId,
  onPick,
  onClose,
}: {
  rect: DOMRect;
  articleId: number | null;
  onPick: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [izabrani, setIzabrani] = useState<Set<number>>(new Set());
  const query = useQuery({
    queryKey: ["artikal-povezani", articleId],
    queryFn: () => api<{ povezani: { relatedId: number; ident: string; naziv: string }[] }>(`/api/artikli/${articleId}`),
    enabled: articleId !== null,
  });
  const povezani = query.data?.povezani ?? [];
  return (
    <AnchorDropdown rect={rect} width={360} onClose={onClose}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Povezani artikli</div>
      {articleId === null || povezani.length === 0 ? (
        <p style={{ fontSize: 12, marginBottom: 8 }}>Artikal nema povezanih artikala.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, maxHeight: 260, overflowY: "auto" }}>
          {povezani.map((p) => (
            <label key={p.relatedId} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={izabrani.has(p.relatedId)}
                onChange={() => {
                  const next = new Set(izabrani);
                  if (next.has(p.relatedId)) next.delete(p.relatedId);
                  else next.add(p.relatedId);
                  setIzabrani(next);
                }}
              />
              {p.ident} - {p.naziv}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" disabled={izabrani.size === 0} onClick={() => onPick([...izabrani])}>
          Ubaci ispod ({izabrani.size})
        </button>
        <button className="btn" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </AnchorDropdown>
  );
}

// Prenumeracija pozicija: dve kolone (brief 7.4)
function PrenumeracijaPopup({
  stavke,
  onSave,
  onClose,
}: {
  stavke: Stavka[];
  onSave: (nove: Stavka[]) => void;
  onClose: () => void;
}) {
  const [leva, setLeva] = useState<Stavka[]>(stavke);
  const [desna, setDesna] = useState<Stavka[]>([]);
  const [sort, setSort] = useState<"pozicija" | "ident" | "naziv">("pozicija");

  const levaSortirana = useMemo(() => {
    const kopija = [...leva];
    if (sort === "ident") kopija.sort((a, b) => a.ident.localeCompare(b.ident));
    if (sort === "naziv") kopija.sort((a, b) => a.naziv.localeCompare(b.naziv));
    return kopija;
  }, [leva, sort]);

  function pomeri(idx: number, smer: -1 | 1) {
    const next = [...desna];
    const j = idx + smer;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setDesna(next);
  }

  const kolona = (items: Stavka[], onClick: (s: Stavka, i: number) => void, strelice: boolean) => (
    <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, minHeight: 200, maxHeight: 320, overflowY: "auto" }}>
      {items.map((s, i) => (
        <div
          key={s.id ?? s.naziv + i}
          style={{ display: "flex", gap: 6, padding: "3px 6px", fontSize: 12, cursor: "pointer", alignItems: "center" }}
        >
          <span style={{ flex: 1 }} onClick={() => onClick(s, i)}>
            {i + 1}. {s.ident} {s.naziv}
          </span>
          {strelice && (
            <>
              <button className="btn" style={{ padding: "0 5px" }} onClick={() => pomeri(i, -1)}>
                ↑
              </button>
              <button className="btn" style={{ padding: "0 5px" }} onClick={() => pomeri(i, 1)}>
                ↓
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 640 }}>
        <h2>Prenumeriši pozicije</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center", fontSize: 12 }}>
          Sortiraj levu:
          <select className="input" style={{ width: 110 }} value={sort} onChange={(e) => setSort(e.target.value as never)}>
            <option value="pozicija">Redosled</option>
            <option value="ident">Ident</option>
            <option value="naziv">Naziv</option>
          </select>
          <span className="subtle">Klik prebacuje između kolona.</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {kolona(
            levaSortirana,
            (s) => {
              setLeva(leva.filter((x) => x !== s));
              setDesna([...desna, s]);
            },
            false,
          )}
          <button
            className="btn"
            title="Prebaci sve"
            disabled={leva.length === 0}
            style={{ alignSelf: "center", padding: "2px 8px", fontSize: 16 }}
            onClick={() => {
              setDesna([...desna, ...levaSortirana]);
              setLeva([]);
            }}
          >
            ⇊
          </button>
          {kolona(
            desna,
            (s) => {
              setDesna(desna.filter((x) => x !== s));
              setLeva([...leva, s]);
            },
            true,
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={leva.length > 0} onClick={() => onSave(desna)}>
            Primeni novi redosled
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Generisanje dokumenta iz drugog: izbor artikala (brief 7.6);
// za povrat reversa default svi oznaceni, samo nevraceni (brief 8.3);
// u lancu predracun > otpremnica > racun prenos do preostale kolicine,
// na novi ili postojeci dokument, uz opciju prenosa avansa (brief 8.9, 8.10)
const LANAC = new Set(["predracun>otpremnica", "predracun>racun", "otpremnica>racun"]);

function GenerisiPopup({
  docId,
  srcTip,
  cilj,
  jePovrat,
  onDone,
  onClose,
}: {
  docId: number;
  srcTip: string;
  cilj: string;
  jePovrat: boolean;
  onDone: (noviId: number) => void;
  onClose: () => void;
}) {
  const jeLanac = LANAC.has(`${srcTip}>${cilj}`);
  const jeAvansCilj = cilj === "avansni_racun";
  const [izabrani, setIzabrani] = useState<Set<number> | null>(null);
  const [kolicine, setKolicine] = useState<Record<number, number>>({});
  const [uDokumentId, setUDokumentId] = useState<number | null>(null);
  const [prenesiAvans, setPrenesiAvans] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["dokument-gen", docId],
    queryFn: () =>
      api<{ items: { id: number; ident: string; naziv: string; kolicina: string; vracenaKolicina: string; prenetaKolicina: string }[] }>(
        `/api/dokumenti/${docId}`,
      ),
  });
  const postojeci = useQuery({
    queryKey: ["dokumenti-u-izradi", cilj],
    queryFn: () => api<{ id: number; broj: string; klijentNaziv: string }[]>(`/api/dokumenti-u-izradi?tip=${cilj}`),
    enabled: jeLanac,
  });
  const avansi = useQuery({
    queryKey: ["avansi-otvoreni", docId],
    queryFn: () => api<{ id: number; broj: string; preostalo: number }[]>(`/api/avansi/otvoreni?predracunId=${docId}`),
    enabled: srcTip === "predracun" && cilj === "racun",
  });
  const preostalo = (i: { kolicina: string; prenetaKolicina: string }) =>
    Number(i.kolicina) - Number(i.prenetaKolicina);
  const items = (query.data?.items ?? []).filter((i) => {
    if (jePovrat) return Number(i.vracenaKolicina) === 0;
    if (jeLanac) return preostalo(i) > 0; // potpuno preneti artikli se vise ne nude (brief 8.9)
    return true;
  });
  const sel = izabrani ?? new Set(jePovrat ? items.map((i) => i.id) : []);

  async function generisi() {
    setError("");
    try {
      const doc = await api<{ id: number }>(`/api/dokumenti/${docId}/generisi`, {
        method: "POST",
        body: {
          tip: cilj,
          items: jeAvansCilj ? [] : [...sel].map((iid) => ({ id: iid, kolicina: kolicine[iid] ?? null })),
          uDokumentId,
          veziAvans: prenesiAvans,
        },
      });
      onDone(doc.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 640 }}>
        <h2>{jePovrat ? "Povrat reversa" : `Generiši: ${TIP_INFO[cilj]?.label ?? cilj}`}</h2>
        {jeAvansCilj ? (
          <p style={{ fontSize: 12, marginBottom: 10 }}>
            Kreira se avansni račun vezan za ovaj predračun; uplaćenu sumu unosite na dokumentu.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12 }}>
              {jePovrat ? "Koji artikli su vraćeni?" : "Klik na stavku je prebacuje u drugu kolonu; desna kolona prelazi u novi dokument."}
            </p>
            {/* dvokolonska prenosnica (faza 17, RP10): leva = ostaje, desna = prenosi se */}
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, minHeight: 160, maxHeight: 300, overflowY: "auto" }}>
                {items.filter((i) => !sel.has(i.id)).map((i) => (
                  <div
                    key={i.id}
                    style={{ padding: "3px 6px", fontSize: 12, cursor: "pointer" }}
                    onClick={() => setIzabrani(new Set([...sel, i.id]))}
                  >
                    {i.ident} - {i.naziv} (kol. {Number(i.kolicina)}
                    {jeLanac && Number(i.prenetaKolicina) > 0 ? `, preostalo ${preostalo(i)}` : ""})
                  </div>
                ))}
                {items.length === 0 && <span style={{ fontSize: 12, padding: 6, display: "block" }}>Nema stavki za izbor.</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "center" }}>
                <button
                  className="btn"
                  title="Prebaci sve u desnu kolonu"
                  disabled={sel.size === items.length}
                  style={{ padding: "2px 8px", fontSize: 14 }}
                  onClick={() => setIzabrani(new Set(items.map((i) => i.id)))}
                >
                  »
                </button>
                <button
                  className="btn"
                  title="Vrati sve u levu kolonu"
                  disabled={sel.size === 0}
                  style={{ padding: "2px 8px", fontSize: 14 }}
                  onClick={() => setIzabrani(new Set())}
                >
                  «
                </button>
              </div>
              <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, minHeight: 160, maxHeight: 300, overflowY: "auto" }}>
                {items.filter((i) => sel.has(i.id)).map((i) => (
                  <div key={i.id} style={{ display: "flex", gap: 6, padding: "3px 6px", fontSize: 12, alignItems: "center" }}>
                    <span
                      style={{ flex: 1, cursor: "pointer" }}
                      onClick={() => setIzabrani(new Set([...sel].filter((x) => x !== i.id)))}
                    >
                      {i.ident} - {i.naziv} (kol. {Number(i.kolicina)}
                      {jeLanac && Number(i.prenetaKolicina) > 0 ? `, preostalo ${preostalo(i)}` : ""})
                    </span>
                    {jeLanac && (
                      <input
                        className="input"
                        style={{ width: 60, textAlign: "right" }}
                        value={kolicine[i.id] ?? preostalo(i)}
                        onChange={(e) =>
                          setKolicine({ ...kolicine, [i.id]: Number(e.target.value.replace(",", ".")) || 0 })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            {jeLanac && (postojeci.data?.length ?? 0) > 0 && (
              <label className="field" style={{ marginBottom: 10 }}>
                Prenesi u
                <select
                  className="input"
                  value={uDokumentId ?? ""}
                  onChange={(e) => setUDokumentId(e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">Novi dokument</option>
                  {(postojeci.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.broj} - {p.klijentNaziv}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(avansi.data?.length ?? 0) > 0 && (
              <label style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center", marginBottom: 10 }}>
                <Toggle checked={prenesiAvans} onChange={setPrenesiAvans} />
                Prenesi avans ({(avansi.data ?? []).map((a) => `${a.broj}: ${fmt(a.preostalo)}`).join(", ")})
              </label>
            )}
          </>
        )}
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={!jeAvansCilj && sel.size === 0} onClick={generisi}>
            {jePovrat ? "Generiši povrat" : "Generiši"}
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Avansni racun (brief 8.10): jedan red - broj predracuna, iznos bez i sa PDV
// (dva vezana polja, unos jednog obracunava drugi preko izabrane stope)
function AvansRed({
  d,
  setD,
  porezi,
  iskorisceno,
}: {
  d: DokumentForm;
  setD: (d: DokumentForm) => void;
  porezi: { id: number; internalValue: string; rate: string | null; isDefault: boolean }[];
  iskorisceno: number | null;
}) {
  const izvedena = d.avansOsnovica && d.avansIznos ? r2((d.avansIznos / d.avansOsnovica - 1) * 100) : null;
  const [stopa, setStopa] = useState<number>(
    izvedena ?? Number(porezi.find((p) => p.isDefault)?.rate ?? porezi[0]?.rate ?? 0),
  );
  const preostalo = (d.avansIznos ?? 0) - (iskorisceno ?? 0);
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, maxWidth: 560 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <label className="field" style={{ width: 140 }}>
          Broj predračuna
          <input
            className="input"
            value={d.avansPredracunBroj}
            onChange={(e) => setD({ ...d, avansPredracunBroj: e.target.value })}
          />
        </label>
        <label className="field" style={{ width: 120 }}>
          Iznos bez PDV
          <input
            className="input"
            style={{ textAlign: "right" }}
            value={d.avansOsnovica ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value.replace(",", "."));
              setD({ ...d, avansOsnovica: v, avansIznos: v === null ? null : r2(v * (1 + stopa / 100)) });
            }}
          />
        </label>
        <label className="field" style={{ width: 90 }}>
          PDV
          <select
            className="input"
            value={String(stopa)}
            onChange={(e) => {
              const s = Number(e.target.value);
              setStopa(s);
              if (d.avansOsnovica !== null) setD({ ...d, avansIznos: r2(d.avansOsnovica * (1 + s / 100)) });
            }}
          >
            {!porezi.some((p) => Number(p.rate ?? 0) === stopa) && <option value={String(stopa)}>{stopa}%</option>}
            {porezi.map((p) => (
              <option key={p.id} value={String(Number(p.rate ?? 0))}>
                {p.internalValue}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 120 }}>
          Iznos sa PDV
          <input
            className="input"
            style={{ textAlign: "right" }}
            value={d.avansIznos ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value.replace(",", "."));
              setD({ ...d, avansIznos: v, avansOsnovica: v === null ? null : r2(v / (1 + stopa / 100)) });
            }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 13 }}>
        <span>
          Iskorišćeno: <b>{fmt(iskorisceno ?? 0)} {d.valuta}</b>
        </span>
        <span>
          Preostalo: <b>{fmt(preostalo)} {d.valuta}</b>
        </span>
      </div>
    </div>
  );
}

// Izbor serijskih brojeva za otpremnicu (brief 8.8): popup nudi brojeve
// sa stanja izdajnog skladista, izbor do kolicine artikla
function IzborSerijskihPopup({
  articleId,
  skladisteId,
  kolicina,
  value,
  onSave,
  onClose,
}: {
  articleId: number | null;
  skladisteId: number | null;
  kolicina: number;
  value: string[];
  onSave: (brojevi: string[]) => void;
  onClose: () => void;
}) {
  const [izabrani, setIzabrani] = useState<Set<string>>(new Set(value));
  const query = useQuery({
    queryKey: ["serijski-na-stanju", articleId, skladisteId],
    queryFn: () => api<{ broj: string }[]>(`/api/artikli/${articleId}/serijski-brojevi?skladisteId=${skladisteId}`),
    enabled: articleId !== null && skladisteId !== null,
  });
  // uneti brojevi koji vise nisu u listi sa stanja (vec izdati ovim dokumentom) ostaju vidljivi
  const naStanju = (query.data ?? []).map((s) => s.broj);
  const svi = [...new Set([...value, ...naStanju])];
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 460 }}>
        <h2>Izbor serijskih brojeva</h2>
        <p style={{ fontSize: 12, marginBottom: 6 }}>
          Izabrano: <b>{izabrani.size}</b> / potrebno {kolicina}
          {skladisteId === null && <span style={{ color: "crimson" }}> - izaberite izdajno skladište u zaglavlju</span>}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, maxHeight: 300, overflowY: "auto" }}>
          {svi.map((broj) => (
            <label key={broj} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={izabrani.has(broj)}
                disabled={!izabrani.has(broj) && izabrani.size >= kolicina}
                onChange={() => {
                  const next = new Set(izabrani);
                  if (next.has(broj)) next.delete(broj);
                  else next.add(broj);
                  setIzabrani(next);
                }}
              />
              {broj}
            </label>
          ))}
          {svi.length === 0 && <span style={{ fontSize: 12 }}>Nema serijskih brojeva na stanju.</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={() => onSave([...izabrani])}>
            Potvrdi ({izabrani.size})
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Vezivanje avansa za racun (brief 8.10): lista otvorenih avansa, delimicno trosenje
function VeziAvansPopup({
  racunId,
  maxRacun,
  onDone,
  onClose,
}: {
  racunId: number;
  maxRacun: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [avansId, setAvansId] = useState<number | null>(null);
  const [iznos, setIznos] = useState<number | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["avansi-otvoreni"],
    queryFn: () => api<OtvorenAvans[]>("/api/avansi/otvoreni"),
  });
  const avansi = query.data ?? [];
  const izabran = avansi.find((a) => a.id === avansId);
  const max = izabran ? r2(Math.min(izabran.preostalo, maxRacun)) : 0;

  async function vezi() {
    if (avansId === null || iznos === null) return;
    setError("");
    try {
      await api(`/api/avansi/${avansId}/vezi`, { method: "POST", body: { racunId, iznos } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Greška");
    }
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 520 }}>
        <h2>Veži avans</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, maxHeight: 260, overflowY: "auto" }}>
          {avansi.map((a) => (
            <label key={a.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
              <input
                type="radio"
                name="avans"
                checked={avansId === a.id}
                onChange={() => {
                  setAvansId(a.id);
                  setIznos(r2(Math.min(a.preostalo, maxRacun)));
                }}
              />
              {a.broj} - {a.klijentNaziv}
              {a.predracunBroj ? ` (predračun ${a.predracunBroj})` : ""} - preostalo {fmt(a.preostalo)}
            </label>
          ))}
          {avansi.length === 0 && <span style={{ fontSize: 12 }}>Nema otvorenih avansa.</span>}
        </div>
        {izabran && (
          <label className="field" style={{ width: 160, marginBottom: 10 }}>
            Iznos (max {fmt(max)})
            <input
              className="input"
              style={{ textAlign: "right" }}
              value={iznos ?? ""}
              onChange={(e) => setIznos(e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
            />
          </label>
        )}
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={avansId === null || !iznos} onClick={vezi}>
            Veži
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}

// Povlacenje cena iz cenovnika dobavljaca (faza 17, RP12 / st.39):
// cena iz cenovnika = list price (MSRP), upisuje se u polje cena stavke konvertovana
// po kursu; kurs se trazi JEDNOM po valutnom paru i uvek formulisan za jacu valutu.
// Hijerarhija valuta: EUR > USD > ostale > RSD.
const JACINA: Record<string, number> = { EUR: 3, USD: 2, RSD: 0 };
const jacina = (v: string) => JACINA[v] ?? 1;
// kljuc para: jaca/slabija; kod iste jacine odlucuje abeceda (deterministicki)
function parKljuc(a: string, b: string) {
  const [jaca, slabija] = jacina(a) > jacina(b) || (jacina(a) === jacina(b) && a < b) ? [a, b] : [b, a];
  return { kljuc: `${jaca}/${slabija}`, jaca, slabija };
}

function CenovnikCenePopup({
  stavke,
  docValuta,
  onApply,
  onClose,
}: {
  stavke: Stavka[];
  docValuta: string;
  onApply: (nove: Stavka[]) => void;
  onClose: () => void;
}) {
  const ids = [...new Set(stavke.filter((s) => !jePrazna(s) && s.articleId !== null).map((s) => s.articleId!))];
  const cene = useQuery({
    queryKey: ["cenovnik-cene", ids.join(",")],
    queryFn: () => api<Record<number, { cena: number; valuta: string }>>(`/api/artikli/cenovnik-cene?ids=${ids.join(",")}`),
    enabled: ids.length > 0,
  });
  const [kursevi, setKursevi] = useState<Record<string, string>>({});
  const [rezime, setRezime] = useState<{ n: number; bezCene: Stavka[] } | null>(null);

  // valutni parovi razliciti od valute dokumenta za koje treba kurs
  const parovi = useMemo(() => {
    const mapa = new Map<string, { kljuc: string; jaca: string; slabija: string }>();
    for (const v of Object.values(cene.data ?? {})) {
      if (v.valuta !== docValuta) {
        const p = parKljuc(v.valuta, docValuta);
        mapa.set(p.kljuc, p);
      }
    }
    return [...mapa.values()];
  }, [cene.data, docValuta]);
  const sviKurseviUneti = parovi.every((p) => Number((kursevi[p.kljuc] ?? "").replace(",", ".")) > 0);

  function primeni() {
    const podaci = cene.data ?? {};
    // konverzija: mnozi kursom iz jace u slabiju, deli iz slabije u jacu
    const konv = (cena: number, izValute: string) => {
      if (izValute === docValuta) return cena;
      const p = parKljuc(izValute, docValuta);
      const k = Number((kursevi[p.kljuc] ?? "").replace(",", "."));
      return izValute === p.jaca ? cena * k : cena / k;
    };
    let n = 0;
    const bezCene: Stavka[] = [];
    const nove = stavke.map((s) => {
      if (jePrazna(s)) return s;
      const c = s.articleId !== null ? podaci[s.articleId] : undefined;
      if (!c) {
        bezCene.push(s);
        return s;
      }
      n++;
      return { ...s, cena: r2(konv(c.cena, c.valuta)) };
    });
    onApply(nove);
    setRezime({ n, bezCene });
  }

  return (
    <div className="overlay">
      <div className="popup" style={{ width: 520 }}>
        <h2>Povuci cene iz cenovnika</h2>
        {rezime ? (
          <>
            <p style={{ fontSize: 12, marginBottom: 8 }}>
              Cena povučena za <b>{rezime.n}</b> stavki, <b>{rezime.bezCene.length}</b> bez cenovnika.
            </p>
            {rezime.bezCene.length > 0 && (
              <>
                <p style={{ fontSize: 12, marginBottom: 4 }}>Stavke koje NISU promenjene:</p>
                <div style={{ border: "1px solid #ddd", borderRadius: 4, maxHeight: 220, overflowY: "auto", marginBottom: 10 }}>
                  {rezime.bezCene.map((s, i) => (
                    <div key={i} style={{ padding: "3px 6px", fontSize: 12 }}>
                      {s.ident} - {s.naziv}
                    </div>
                  ))}
                </div>
              </>
            )}
            <button className="btn primary" onClick={onClose}>
              Zatvori
            </button>
          </>
        ) : (
          <>
            {cene.isLoading ? (
              <p style={{ fontSize: 12, marginBottom: 10 }}>Učitavanje cena...</p>
            ) : (
              <>
                <p style={{ fontSize: 12, marginBottom: 8 }}>
                  Pronađene cene za {Object.keys(cene.data ?? {}).length} artikala. Cena iz cenovnika se upisuje u
                  polje cena stavke (list price); popuste i marže dalje radite sami.
                </p>
                {parovi.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {parovi.map((p) => (
                      <label key={p.kljuc} className="field" style={{ width: 240 }}>
                        Unesite kurs za {p.jaca} (1 {p.jaca} = ? {p.slabija})
                        <input
                          className="input"
                          value={kursevi[p.kljuc] ?? ""}
                          onChange={(e) => setKursevi({ ...kursevi, [p.kljuc]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn primary"
                disabled={cene.isLoading || !sviKurseviUneti || Object.keys(cene.data ?? {}).length === 0}
                onClick={primeni}
              >
                Povuci cene
              </button>
              <button className="btn" onClick={onClose}>
                Otkaži
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LogPopup({ docId, onClose }: { docId: number; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["dokument-log", docId],
    queryFn: () =>
      api<{ field: string; oldValue: string | null; newValue: string | null; user: string | null; createdAt: string }[]>(
        `/api/dokumenti/${docId}/log`,
      ),
  });
  return (
    <div className="overlay">
      <div className="popup" style={{ width: 560 }}>
        <h2>Log izmena</h2>
        <div className="tablewrap" style={{ maxHeight: 350, overflowY: "auto", marginBottom: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Korisnik</th>
                <th>Polje</th>
                <th>Staro</th>
                <th>Novo</th>
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((l, i) => (
                <tr key={i}>
                  <td>{new Date(l.createdAt).toLocaleString("sr-RS")}</td>
                  <td>{l.user}</td>
                  <td>{l.field}</td>
                  <td>{l.oldValue}</td>
                  <td>{l.newValue}</td>
                </tr>
              ))}
              {(query.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5}>Nema izmena.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button className="btn primary" onClick={onClose}>
          Zatvori
        </button>
      </div>
    </div>
  );
}
