import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { api } from "../../api";
import { DataTable } from "../../components/DataTable";
import { Autocomplete } from "../../components/Autocomplete";
import { MultiPick } from "../../components/MultiPick";
import { sacuvajFajl } from "../../download";
import { TIP_INFO, fmt } from "../dokumenti/common";
import { DokumentView } from "../dokumenti/DokumentView";

// Obracuni (brief 9, redizajn faza 14.4 stavke 59-66): svi filteri default
// ukljuceni, korisnik suzava; rezultat se prikazuje inline ispod filtera i
// azurira se odmah pri izmeni filtera (stavka 65).

const SVI_TIPOVI = Object.keys(TIP_INFO);

interface Kategorija {
  id: number;
  parentId: number | null;
  name: string;
  code: string | null;
}

interface Lookup {
  kind: string;
  docType: string | null;
  internalValue: string;
}

function Polje({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      {label}
      {children}
    </label>
  );
}

function KategorijaSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ["kategorije"],
    queryFn: () => api<Kategorija[]>("/api/kategorije"),
  });
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sve kategorije</option>
      {(data ?? []).map((k) => (
        <option key={k.id} value={k.id}>
          {k.code ? `${k.code} - ${k.name}` : k.name}
        </option>
      ))}
    </select>
  );
}

function izvozExcel(naziv: string, redovi: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(redovi);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Obračun");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  void sacuvajFajl(naziv, new Blob([buf]));
}

export function ObracuniPage() {
  const [tab, setTab] = useState<"dokumenti" | "artikli">("dokumenti");
  const [openDoc, setOpenDoc] = useState<{ id: number; tip: string } | null>(null);

  // tab Dokumenti (brief 9.1)
  const [tipovi, setTipovi] = useState<(number | string)[]>([]); // prazno = svi
  const [klijenti, setKlijenti] = useState<(number | string)[]>([]);
  const [statusi, setStatusi] = useState<(number | string)[]>([]);
  const [kategorije, setKategorije] = useState<(number | string)[]>([]);
  const [df, setDf] = useState({
    referent: "", datumOd: "", datumDo: "", sumaOd: "", sumaDo: "", artikal: "", ident: "",
  });

  // tab Artikli (brief 9.2)
  const [af, setAf] = useState({
    tip: "", kategorijaId: "", dobavljacId: "", cenaOd: "", cenaDo: "",
    klijent: "", datumOd: "", datumDo: "",
  });

  const subjekti = useQuery({
    queryKey: ["subjekti"],
    queryFn: () => api<{ id: number; naziv: string; role: string }[]>("/api/subjekti"),
  });
  const sifarnici = useQuery({
    queryKey: ["dokumenti-sifarnici"],
    queryFn: () => api<Lookup[]>("/api/dokumenti-sifarnici"),
  });
  const kategorijeQ = useQuery({
    queryKey: ["kategorije"],
    queryFn: () => api<Kategorija[]>("/api/kategorije"),
  });
  const referenti = useQuery({
    queryKey: ["obracun-referenti"],
    queryFn: () => api<{ referent: string }[]>("/api/obracun/referenti"),
  });
  const artikliOpcije = useQuery({
    queryKey: ["artikli-opcije"],
    queryFn: () => api<{ id: number; ident: string; naziv: string }[]>("/api/artikli-pretraga"),
  });

  // stavka 61: statusi = unija statusa izabranih tipova, bez duplikata
  const aktivniTipovi = tipovi.length ? tipovi : SVI_TIPOVI;
  const statusOpcije = useMemo(() => {
    const nazivi = (sifarnici.data ?? [])
      .filter((l) => l.kind === "status_dokumenta" && l.docType && aktivniTipovi.includes(l.docType))
      .map((l) => l.internalValue);
    return [...new Set(nazivi)];
  }, [sifarnici.data, aktivniTipovi]);

  const dokQs = useMemo(() => {
    const p = new URLSearchParams();
    if (tipovi.length && tipovi.length < SVI_TIPOVI.length) p.set("tipovi", tipovi.join(","));
    // izabrani statusi koji vise nisu u uniji izabranih tipova se ignorisu
    const st = statusi.filter((s) => statusOpcije.includes(String(s)));
    if (st.length) p.set("statusi", st.join(","));
    if (klijenti.length) p.set("klijenti", klijenti.join(","));
    if (kategorije.length) p.set("kategorije", kategorije.join(","));
    for (const [k, v] of Object.entries(df)) if (v) p.set(k, v);
    return p.toString();
  }, [tipovi, statusi, statusOpcije, klijenti, kategorije, df]);

  const artQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(af)) if (v) p.set(k, v);
    return p.toString();
  }, [af]);

  // stavka 65: rezultat ispod filtera, izmena filtera odmah azurira listu
  const dokQsDef = useDeferredValue(dokQs);
  const artQsDef = useDeferredValue(artQs);
  const dokQuery = useQuery({
    queryKey: ["obracun", "dokumenti", dokQsDef],
    queryFn: () => api<DokRed[]>(`/api/obracun/dokumenti?${dokQsDef}`),
    enabled: tab === "dokumenti",
    placeholderData: (prev) => prev,
  });
  const artQuery = useQuery({
    queryKey: ["obracun", "artikli", artQsDef],
    queryFn: () => api<ArtRed[]>(`/api/obracun/artikli?${artQsDef}`),
    enabled: tab === "artikli",
    placeholderData: (prev) => prev,
  });

  if (openDoc) {
    return (
      <DokumentView
        tip={openDoc.tip}
        id={openDoc.id}
        onBack={() => setOpenDoc(null)}
        onOpenDoc={(id) => setOpenDoc({ ...openDoc, id })}
      />
    );
  }

  const grid = { display: "grid", gridTemplateColumns: "repeat(4, 220px)", gap: 12 } as const;

  function izvoz() {
    if (tab === "dokumenti") {
      izvozExcel(
        "obracun-dokumenti.xlsx",
        (dokQuery.data ?? []).map((d) => ({
          Tip: TIP_INFO[d.tip]?.label ?? d.tip,
          Broj: d.broj,
          Datum: new Date(d.datum).toLocaleDateString("sr-RS"),
          Klijent: d.klijentNaziv,
          "Suma (bez PDV)": Number(d.suma),
          Valuta: d.valuta,
          Status: d.status,
          Referent: d.referent ?? "",
        })),
      );
    } else {
      izvozExcel(
        "obracun-artikli.xlsx",
        (artQuery.data ?? []).map((a) => ({
          Ident: a.ident,
          Naziv: a.naziv,
          SKU: a.sku,
          Dobavljač: a.dobavljac ?? "",
          "Prodajna cena": a.prodajnaCena ? Number(a.prodajnaCena) : "",
          Valuta: a.prodajnaValuta,
        })),
      );
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Obračuni</h1>
      </div>
      <div className="toolbar" style={{ gap: 8 }}>
        <button className={`btn ${tab === "dokumenti" ? "primary" : ""}`} onClick={() => setTab("dokumenti")}>
          Dokumenti
        </button>
        <button className={`btn ${tab === "artikli" ? "primary" : ""}`} onClick={() => setTab("artikli")}>
          Artikli
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={izvoz}>
          Izvoz u Excel
        </button>
      </div>

      {tab === "dokumenti" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <div style={grid}>
            <Polje label="Izbor dokumenata">
              <MultiPick
                options={SVI_TIPOVI.map((t) => ({ id: t, label: TIP_INFO[t]?.mnozina ?? t }))}
                value={tipovi}
                onChange={setTipovi}
                placeholder="Svi dokumenti"
              />
            </Polje>
            <Polje label="Klijent / dobavljač">
              <MultiPick
                options={(subjekti.data ?? []).map((s) => ({ id: s.id, label: s.naziv }))}
                value={klijenti}
                onChange={setKlijenti}
                placeholder="Svi"
              />
            </Polje>
            <Polje label="Status">
              <MultiPick
                options={statusOpcije.map((s) => ({ id: s, label: s }))}
                value={statusi}
                onChange={setStatusi}
                placeholder="Svi statusi"
              />
            </Polje>
            <Polje label="Referent">
              <Autocomplete
                options={(referenti.data ?? []).map((r) => ({ id: r.referent, label: r.referent }))}
                value={df.referent ? { id: df.referent, label: df.referent } : null}
                onChange={(o) => setDf({ ...df, referent: o ? o.label : "" })}
                placeholder="Svi referenti"
              />
            </Polje>
            <Polje label="Artikal (naziv)">
              <Autocomplete
                options={(artikliOpcije.data ?? []).map((a) => ({ id: a.id, label: a.naziv }))}
                value={df.artikal ? { id: df.artikal, label: df.artikal } : null}
                onChange={(o) => setDf({ ...df, artikal: o ? o.label : "" })}
                placeholder="Svi artikli"
              />
            </Polje>
            <Polje label="Artikal (ident)">
              <input className="input" value={df.ident} onChange={(e) => setDf({ ...df, ident: e.target.value })} />
            </Polje>
            <Polje label="Kategorije artikla (primarna ili sekundarna)">
              <MultiPick
                options={(kategorijeQ.data ?? []).map((k) => ({
                  id: k.id,
                  label: k.code ? `${k.code} - ${k.name}` : k.name,
                }))}
                value={kategorije}
                onChange={setKategorije}
                placeholder="Sve kategorije"
              />
            </Polje>
            <Polje label="Datum od">
              <input type="date" className="input" value={df.datumOd} onChange={(e) => setDf({ ...df, datumOd: e.target.value })} />
            </Polje>
            <Polje label="Datum do">
              <input type="date" className="input" value={df.datumDo} onChange={(e) => setDf({ ...df, datumDo: e.target.value })} />
            </Polje>
            <Polje label="Suma od (bez PDV)">
              <input inputMode="decimal" className="input" value={df.sumaOd} onChange={(e) => setDf({ ...df, sumaOd: e.target.value.replace(",", ".") })} />
            </Polje>
            <Polje label="Suma do (bez PDV)">
              <input inputMode="decimal" className="input" value={df.sumaDo} onChange={(e) => setDf({ ...df, sumaDo: e.target.value.replace(",", ".") })} />
            </Polje>
          </div>
          <DataTable
            data={dokQuery.data ?? []}
            columns={dokKolone}
            onRowDoubleClick={(d) => setOpenDoc({ id: d.id, tip: d.tip })}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <div style={grid}>
            <Polje label="Tip artikla">
              <select className="input" value={af.tip} onChange={(e) => setAf({ ...af, tip: e.target.value })}>
                <option value="">Svi tipovi</option>
                <option value="obican">Običan</option>
                <option value="parent">Parent</option>
                <option value="varijacija">Varijacija</option>
              </select>
            </Polje>
            <Polje label="Kategorija">
              <KategorijaSelect value={af.kategorijaId} onChange={(v) => setAf({ ...af, kategorijaId: v })} />
            </Polje>
            <Polje label="Dobavljač">
              <DobavljacSelect value={af.dobavljacId} onChange={(v) => setAf({ ...af, dobavljacId: v })} />
            </Polje>
            <Polje label="Klijent (na dokumentima)">
              <input className="input" value={af.klijent} onChange={(e) => setAf({ ...af, klijent: e.target.value })} />
            </Polje>
            <Polje label="Prodajna cena od">
              <input inputMode="decimal" className="input" value={af.cenaOd} onChange={(e) => setAf({ ...af, cenaOd: e.target.value.replace(",", ".") })} />
            </Polje>
            <Polje label="Prodajna cena do">
              <input inputMode="decimal" className="input" value={af.cenaDo} onChange={(e) => setAf({ ...af, cenaDo: e.target.value.replace(",", ".") })} />
            </Polje>
            <Polje label="Period od">
              <input type="date" className="input" value={af.datumOd} onChange={(e) => setAf({ ...af, datumOd: e.target.value })} />
            </Polje>
            <Polje label="Period do">
              <input type="date" className="input" value={af.datumDo} onChange={(e) => setAf({ ...af, datumDo: e.target.value })} />
            </Polje>
          </div>
          <DataTable data={artQuery.data ?? []} columns={artKolone} />
        </div>
      )}
    </>
  );
}

function DobavljacSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ["subjekti"],
    queryFn: () => api<{ id: number; naziv: string; role: string }[]>("/api/subjekti"),
  });
  const dobavljaci = (data ?? []).filter((s) => s.role === "dobavljac" || s.role === "oba");
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Svi dobavljači</option>
      {dobavljaci.map((d) => (
        <option key={d.id} value={d.id}>
          {d.naziv}
        </option>
      ))}
    </select>
  );
}

// --- Rezultat obracuna ---

interface DokRed {
  id: number;
  tip: string;
  broj: string;
  datum: string;
  status: string;
  klijentNaziv: string;
  referencaKupca: string;
  valuta: string;
  referent: string | null;
  suma: string;
  avansOtvoreno: string | null;
}

interface ArtRed {
  id: number;
  ident: string;
  naziv: string;
  tip: string;
  sku: string;
  prodajnaCena: string | null;
  prodajnaValuta: string;
  dobavljac: string | null;
}

const dokKolone: ColumnDef<DokRed, any>[] = [
  { accessorKey: "tip", header: "Tip", cell: (c) => TIP_INFO[c.getValue() as string]?.label ?? c.getValue() },
  { accessorKey: "broj", header: "Broj" },
  {
    accessorKey: "datum",
    header: "Datum",
    cell: (c) => new Date(c.getValue() as string).toLocaleDateString("sr-RS"),
  },
  { accessorKey: "klijentNaziv", header: "Klijent" },
  {
    accessorKey: "suma",
    header: "Suma (bez PDV)",
    cell: (c) => `${fmt(Number(c.getValue()))} ${c.row.original.valuta}`,
  },
  {
    accessorKey: "avansOtvoreno",
    header: "Otvoreni avans",
    cell: (c) =>
      c.getValue() !== null && Number(c.getValue()) > 0
        ? `${fmt(Number(c.getValue()))} ${c.row.original.valuta}`
        : "",
  },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "referent", header: "Referent" },
];

const artKolone: ColumnDef<ArtRed, any>[] = [
  { accessorKey: "ident", header: "Ident" },
  { accessorKey: "naziv", header: "Naziv" },
  { accessorKey: "sku", header: "SKU" },
  { accessorKey: "dobavljac", header: "Dobavljač" },
  {
    accessorKey: "prodajnaCena",
    header: "Prodajna cena",
    cell: (c) =>
      c.getValue() ? `${fmt(Number(c.getValue()))} ${c.row.original.prodajnaValuta}` : "",
  },
];

// Stari tab "obracun-rezultat" (registrovan u Shell PAGES) - ostaje zbog
// vec sacuvanih rasporeda tabova; novi tok prikazuje rezultat inline.
export function ObracunRezultat({ payload }: { payload?: unknown }) {
  const { vrsta, qs } = (payload ?? {}) as { vrsta?: string; qs?: string };
  const [openDoc, setOpenDoc] = useState<{ id: number; tip: string } | null>(null);

  const query = useQuery({
    queryKey: ["obracun", vrsta, qs],
    queryFn: () => api<unknown[]>(`/api/obracun/${vrsta}?${qs ?? ""}`),
    enabled: !!vrsta,
  });

  if (openDoc) {
    return (
      <DokumentView
        tip={openDoc.tip}
        id={openDoc.id}
        onBack={() => setOpenDoc(null)}
        onOpenDoc={(id) => setOpenDoc({ ...openDoc, id })}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>{vrsta === "artikli" ? "Obračun: artikli" : "Obračun: dokumenti"}</h1>
      </div>
      {vrsta === "artikli" ? (
        <DataTable data={(query.data ?? []) as ArtRed[]} columns={artKolone} />
      ) : (
        <DataTable
          data={(query.data ?? []) as DokRed[]}
          columns={dokKolone}
          onRowDoubleClick={(d) => setOpenDoc({ id: d.id, tip: d.tip })}
        />
      )}
    </>
  );
}
