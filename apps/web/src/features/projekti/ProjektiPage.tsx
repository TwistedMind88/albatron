import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, apiFetch, fajlUrl } from "../../api";
import { DataTable } from "../../components/DataTable";
import { Autocomplete } from "../../components/Autocomplete";
import { TIP_INFO } from "../dokumenti/common";
import { DokumentView } from "../dokumenti/DokumentView";

// Projekti (brief 13): grupa dokumenata po klijentu za jedan posao,
// hronologija svih desavanja, komunikacija (copy-paste), attachmenti.

const d = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("sr-RS") : "");

interface ProjekatRed {
  id: number;
  naziv: string;
  status: string;
  klijentNaziv: string;
  planPocetak: string | null;
  planKraj: string | null;
  createdAt: string;
}

interface Stavka {
  id: number;
  vrsta: string;
  osoba: string;
  datum: string;
  tekst: string;
  filename: string;
  strana: string;
  autor: string | null;
}

interface VezanDok {
  vezaId: number;
  id: number;
  tip: string;
  broj: string;
  datum: string;
  status: string;
  klijentNaziv: string;
}

interface Projekat {
  id: number;
  naziv: string;
  klijentId: number;
  klijentNaziv: string;
  status: string;
  ocekivanja: string;
  planPocetak: string | null;
  planKraj: string | null;
  dokumenti: VezanDok[];
  stavke: Stavka[];
}

const VRSTA_LABEL: Record<string, string> = {
  napomena: "Napomena",
  referenca: "Referenca",
  kontakt: "Kontakt osoba",
  datum: "Datum dešavanja",
  ucesnik: "Učesnik",
  komunikacija: "Komunikacija",
  attachment: "Attachment",
};

export function ProjektiPage() {
  const [openId, setOpenId] = useState<number | "nov" | null>(null);

  const query = useQuery({
    queryKey: ["projekti"],
    queryFn: () => api<ProjekatRed[]>("/api/projekti"),
  });

  const kolone: ColumnDef<ProjekatRed, any>[] = useMemo(
    () => [
      { accessorKey: "naziv", header: "Naziv" },
      { accessorKey: "klijentNaziv", header: "Klijent" },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "planPocetak", header: "Planirani početak", cell: (c) => d(c.getValue() as string) },
      { accessorKey: "planKraj", header: "Planirani kraj", cell: (c) => d(c.getValue() as string) },
      { accessorKey: "createdAt", header: "Otvoren", cell: (c) => d(c.getValue() as string) },
    ],
    [],
  );

  if (openId !== null) {
    return (
      <ProjekatView
        id={openId === "nov" ? null : openId}
        onBack={() => {
          setOpenId(null);
          query.refetch();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Projekti</h1>
      </div>
      <DataTable
        tableId="projekti"
        data={query.data ?? []}
        columns={kolone}
        onRowDoubleClick={(p) => setOpenId(p.id)}
        toolbar={
          <button className="btn primary" onClick={() => setOpenId("nov")}>
            + Novi projekat
          </button>
        }
      />
    </>
  );
}

function ProjekatView({ id, onBack }: { id: number | null; onBack: () => void }) {
  const [projId, setProjId] = useState<number | null>(id);
  const [form, setForm] = useState({
    naziv: "",
    klijentId: null as number | null,
    status: "otvoren",
    ocekivanja: "",
    planPocetak: "",
    planKraj: "",
  });
  const [greska, setGreska] = useState("");
  const [popup, setPopup] = useState<string | null>(null); // vrsta stavke koja se dodaje
  const [prikazKomunikacije, setPrikazKomunikacije] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ id: number; tip: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stranaRef = useRef<"klijent" | "ponudjac">("ponudjac");

  const projekat = useQuery({
    queryKey: ["projekat", projId],
    queryFn: async () => {
      const p = await api<Projekat>(`/api/projekti/${projId}`);
      setForm({
        naziv: p.naziv,
        klijentId: p.klijentId,
        status: p.status,
        ocekivanja: p.ocekivanja,
        planPocetak: p.planPocetak?.slice(0, 10) ?? "",
        planKraj: p.planKraj?.slice(0, 10) ?? "",
      });
      return p;
    },
    enabled: projId !== null,
  });

  const subjekti = useQuery({
    queryKey: ["subjekti-svi"],
    queryFn: () => api<{ id: number; naziv: string; role: string }[]>("/api/subjekti"),
  });
  const klijenti = (subjekti.data ?? []).filter((s) => s.role === "klijent" || s.role === "oba");

  // svi dokumenti za pridruzivanje (pretraga po broju/klijentu)
  const sviDokumenti = useQuery({
    queryKey: ["obracun", "dokumenti", ""],
    queryFn: () => api<{ id: number; broj: string; klijentNaziv: string; tip: string }[]>("/api/obracun/dokumenti"),
  });

  async function snimi() {
    if (!form.naziv.trim() || !form.klijentId) {
      setGreska("Naziv i klijent su obavezni");
      return;
    }
    setGreska("");
    const body = {
      ...form,
      planPocetak: form.planPocetak || null,
      planKraj: form.planKraj || null,
    };
    try {
      if (projId === null) {
        const p = await api<{ id: number }>("/api/projekti", { method: "POST", body });
        setProjId(p.id);
      } else {
        await api(`/api/projekti/${projId}`, { method: "PUT", body });
        projekat.refetch();
      }
    } catch (e) {
      setGreska(e instanceof Error ? e.message : "Greška pri snimanju");
    }
  }

  async function pridruziDokument(docId: number) {
    try {
      await api(`/api/projekti/${projId}/dokumenti`, { method: "POST", body: { documentId: docId } });
      projekat.refetch();
    } catch (e) {
      setGreska(e instanceof Error ? e.message : "Greška");
    }
  }

  async function ukloniDokument(vezaId: number) {
    await api(`/api/projekti/${projId}/dokumenti/${vezaId}`, { method: "DELETE" });
    projekat.refetch();
  }

  async function obrisiStavku(stavkaId: number) {
    await api(`/api/projekti/stavke/${stavkaId}`, { method: "DELETE" });
    projekat.refetch();
  }

  async function uploadFajl(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch(`/api/projekti/${projId}/fajlovi?strana=${stranaRef.current}`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) setGreska("Greška pri slanju fajla");
    projekat.refetch();
  }

  const stavke = projekat.data?.stavke ?? [];
  const dokumenti = projekat.data?.dokumenti ?? [];
  const komunikacija = stavke.filter((s) => s.vrsta === "komunikacija");
  const attachmenti = stavke.filter((s) => s.vrsta === "attachment");

  // hronologija (brief 13): dokumenti + stavke, sortirano po datumu
  const hronologija = [
    ...dokumenti.map((doc) => ({
      kljuc: `d${doc.vezaId}`,
      datum: doc.datum,
      naslov: `${TIP_INFO[doc.tip]?.label ?? doc.tip} ${doc.broj}`,
      tekst: `Status: ${doc.status}`,
      vrsta: "dokument",
    })),
    ...stavke.map((s) => ({
      kljuc: `s${s.id}`,
      datum: s.datum,
      naslov: `${VRSTA_LABEL[s.vrsta] ?? s.vrsta}${s.osoba ? ` - ${s.osoba}` : ""}`,
      tekst: s.vrsta === "attachment" ? `${s.filename} (${s.strana})` : s.tekst,
      vrsta: s.vrsta,
    })),
  ].sort((a, b) => a.datum.localeCompare(b.datum));

  if (openDoc) {
    return (
      <DokumentView
        tip={openDoc.tip}
        id={openDoc.id}
        onBack={() => setOpenDoc(null)}
        onOpenDoc={(docId) => setOpenDoc({ ...openDoc, id: docId })}
      />
    );
  }

  const sekcija = { border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", padding: 12 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <button className="btn" style={{ marginBottom: 8 }} onClick={onBack}>
          &larr; Nazad
        </button>
        <div className="page-head">
          <h1>{projId === null ? "Novi projekat" : projekat.data?.naziv ?? "Projekat"}</h1>
          <button className="btn primary" onClick={snimi}>
            Sačuvaj
          </button>
        </div>
      </div>
      {greska && <div style={{ color: "var(--danger, #c00)", fontSize: 13 }}>{greska}</div>}

      <div style={{ ...sekcija, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 220px)", gap: 12, alignContent: "start" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Naziv projekta
            <input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Klijent
            <Autocomplete
              options={klijenti.map((k) => ({ id: k.id, label: k.naziv }))}
              value={
                form.klijentId
                  ? { id: form.klijentId, label: klijenti.find((k) => k.id === form.klijentId)?.naziv ?? projekat.data?.klijentNaziv ?? "" }
                  : null
              }
              onChange={(o) => setForm({ ...form, klijentId: o ? Number(o.id) : null })}
              placeholder="Izaberi klijenta"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Status
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="otvoren">otvoren</option>
              <option value="u toku">u toku</option>
              <option value="na čekanju">na čekanju</option>
              <option value="završen">završen</option>
              <option value="otkazan">otkazan</option>
            </select>
          </label>
          <span />
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Planirani početak
            <input type="date" className="input" value={form.planPocetak} onChange={(e) => setForm({ ...form, planPocetak: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Planirani kraj
            <input type="date" className="input" value={form.planKraj} onChange={(e) => setForm({ ...form, planKraj: e.target.value })} />
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Očekivanja
          <textarea
            className="input"
            rows={9}
            style={{ flex: 1, resize: "vertical" }}
            value={form.ocekivanja}
            onChange={(e) => setForm({ ...form, ocekivanja: e.target.value })}
          />
        </label>
      </div>

      {projId !== null && (
        <>
          <div style={sekcija}>
            <h3 style={{ margin: "0 0 8px" }}>Dokumenti</h3>
            <div style={{ maxWidth: 400, marginBottom: 8 }}>
              <Autocomplete
                options={(sviDokumenti.data ?? [])
                  .filter((doc) => !dokumenti.some((v) => v.id === doc.id))
                  .map((doc) => ({ id: doc.id, label: `${doc.broj} - ${doc.klijentNaziv}` }))}
                value={null}
                onChange={(o) => o && pridruziDokument(Number(o.id))}
                placeholder="Pridruži dokument (broj ili klijent)..."
              />
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Tip</th>
                  <th>Broj</th>
                  <th>Datum</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dokumenti.map((doc) => (
                  <tr key={doc.vezaId} onDoubleClick={() => setOpenDoc({ id: doc.id, tip: doc.tip })}>
                    <td>{TIP_INFO[doc.tip]?.label ?? doc.tip}</td>
                    <td>{doc.broj}</td>
                    <td>{d(doc.datum)}</td>
                    <td>{doc.status}</td>
                    <td>
                      <button className="btn" onClick={() => ukloniDokument(doc.vezaId)}>
                        Ukloni
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={sekcija}>
            <h3 style={{ margin: "0 0 8px" }}>Hronologija</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {["napomena", "referenca", "kontakt", "datum", "ucesnik"].map((v) => (
                <button key={v} className="btn" onClick={() => setPopup(v)}>
                  + {VRSTA_LABEL[v]}
                </button>
              ))}
              <button className="btn" onClick={() => setPopup("komunikacija")}>
                + Dodaj komunikaciju
              </button>
              <button className="btn" onClick={() => setPrikazKomunikacije(true)} disabled={komunikacija.length === 0}>
                Komunikacija ({komunikacija.length})
              </button>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Vrsta</th>
                  <th>Sadržaj</th>
                </tr>
              </thead>
              <tbody>
                {hronologija.map((h) => (
                  <tr key={h.kljuc}>
                    <td style={{ whiteSpace: "nowrap" }}>{d(h.datum)}</td>
                    <td>{h.vrsta === "dokument" ? "Dokument" : VRSTA_LABEL[h.vrsta] ?? h.vrsta}</td>
                    <td>
                      <b>{h.naslov}</b>
                      {h.tekst && <span style={{ whiteSpace: "pre-wrap" }}> - {h.tekst}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={sekcija}>
            <h3 style={{ margin: "0 0 8px" }}>Attachmenti</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  stranaRef.current = "klijent";
                  fileRef.current?.click();
                }}
              >
                + Fajl klijenta
              </button>
              <button
                className="btn"
                onClick={() => {
                  stranaRef.current = "ponudjac";
                  fileRef.current?.click();
                }}
              >
                + Fajl ponuđača
              </button>
              <input
                ref={fileRef}
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFajl(f);
                  e.target.value = "";
                }}
              />
            </div>
            {attachmenti.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "2px 0" }}>
                <a href={fajlUrl(`/api/projekti/fajlovi/${a.id}`)}>{a.filename}</a>
                <span style={{ color: "var(--muted, #888)" }}>({a.strana})</span>
                <button className="btn" onClick={() => obrisiStavku(a.id)}>
                  Obriši
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {popup && (
        <StavkaPopup
          vrsta={popup}
          onClose={() => setPopup(null)}
          onSave={async (s) => {
            await api(`/api/projekti/${projId}/stavke`, { method: "POST", body: s });
            setPopup(null);
            projekat.refetch();
          }}
        />
      )}

      {prikazKomunikacije && (
        <div className="overlay" onClick={() => setPrikazKomunikacije(false)}>
          <div className="popup" style={{ maxWidth: 560, maxHeight: "70vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3>Komunikacija</h3>
            {komunikacija.map((k) => (
              <div key={k.id} style={{ borderBottom: "1px solid var(--line-strong)", padding: "8px 0", fontSize: 13 }}>
                <b>{k.osoba}</b> <span style={{ color: "var(--muted, #888)" }}>{d(k.datum)}</span>
                <div style={{ whiteSpace: "pre-wrap" }}>{k.tekst}</div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setPrikazKomunikacije(false)}>
                Zatvori
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Popup za unos stavke: osoba (kontakt/ucesnik/komunikacija), datum, tekst (brief 13)
function StavkaPopup({
  vrsta,
  onClose,
  onSave,
}: {
  vrsta: string;
  onClose: () => void;
  onSave: (s: { vrsta: string; osoba: string; datum: string; tekst: string }) => void;
}) {
  const [osoba, setOsoba] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [tekst, setTekst] = useState("");
  const trebaOsoba = ["kontakt", "ucesnik", "komunikacija"].includes(vrsta);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3>{VRSTA_LABEL[vrsta]}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          {trebaOsoba && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {vrsta === "komunikacija" ? "Poruku poslao/la" : "Ime i prezime"}
              <input className="input" value={osoba} onChange={(e) => setOsoba(e.target.value)} />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Datum
            <input type="date" className="input" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {vrsta === "komunikacija" ? "Tekst poruke" : "Tekst"}
            <textarea className="input" rows={5} value={tekst} onChange={(e) => setTekst(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn primary" onClick={() => onSave({ vrsta, osoba, datum, tekst })}>
            Sačuvaj
          </button>
          <button className="btn" onClick={onClose}>
            Otkaži
          </button>
        </div>
      </div>
    </div>
  );
}
