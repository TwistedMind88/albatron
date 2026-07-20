import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Autocomplete } from "../../components/Autocomplete";
import { MultiPick } from "../../components/MultiPick";
import type { ZadatakIzvrsilac } from "./ZadaciPage";

interface ZadatakDetalj {
  id: number;
  naziv: string;
  opis: string;
  prioritet: string;
  status: string;
  rok: string | null;
  subjektId: number | null;
  subjektNaziv: string | null;
  dokumentId: number | null;
  dokumentBroj: string | null;
  dokumentTip: string | null;
  kreiraoId: number;
  kreiraoIme: string;
  izvrsioci: (ZadatakIzvrsilac & { pozvaoId: number | null })[];
  hronologija: { id: number; tekst: string; autorId: number; autorIme: string; createdAt: string }[];
}

function datumVreme(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("sr-RS");
}

export function ZadatakView({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [greska, setGreska] = useState("");

  const me = useQuery({ queryKey: ["auth-me"], queryFn: () => api<{ id: number }>("/api/auth/me") });
  const korisnici = useQuery({
    queryKey: ["zadaci-korisnici"],
    queryFn: () => api<{ id: number; fullName: string }[]>("/api/zadaci-korisnici"),
  });
  const subjekti = useQuery({
    queryKey: ["zadaci-subjekti"],
    queryFn: () => api<{ id: number; naziv: string }[]>("/api/zadaci-subjekti"),
  });
  const dokumenti = useQuery({
    queryKey: ["zadaci-dokumenti"],
    queryFn: () => api<{ id: number; broj: string; tip: string }[]>("/api/zadaci-dokumenti"),
  });
  const detalj = useQuery({
    queryKey: ["zadatak", id],
    queryFn: () => api<ZadatakDetalj>(`/api/zadaci/${id}`),
    enabled: id !== null,
  });

  // nov zadatak - lokalna forma
  const [naziv, setNaziv] = useState("");
  const [prioritet, setPrioritet] = useState("srednji");
  const [rok, setRok] = useState("");
  const [subjekt, setSubjekt] = useState<{ id: number; naziv: string } | null>(null);
  const [dokument, setDokument] = useState<{ id: number; broj: string } | null>(null);
  const [opisNovi, setOpisNovi] = useState("");
  const [izvrsioci, setIzvrsioci] = useState<(number | string)[]>([]);

  // izmena postojeceg opisa + dodavanje hronologije
  const [opisDraft, setOpisDraft] = useState<string | null>(null);
  const [novaStavka, setNovaStavka] = useState("");
  const [pozivPick, setPozivPick] = useState<(number | string)[]>([]);

  const mojId = me.data?.id;
  const z = detalj.data;
  const jeKreator = !!z && z.kreiraoId === mojId;
  const jeAktivan = jeKreator || !!z?.izvrsioci.some((i) => i.userId === mojId && i.status === "prihvatio");
  const jeUcesnik = !!z?.izvrsioci.some((i) => i.userId === mojId);

  const korisnikOpcije = useMemo(() => (korisnici.data ?? []).map((u) => ({ id: u.id, label: u.fullName })), [korisnici.data]);
  const subjektOpcije = useMemo(() => (subjekti.data ?? []).map((s) => ({ id: s.id, label: s.naziv })), [subjekti.data]);
  const dokumentOpcije = useMemo(
    () => (dokumenti.data ?? []).map((d) => ({ id: d.id, label: `${d.broj} (${d.tip})` })),
    [dokumenti.data],
  );

  async function kreiraj() {
    setGreska("");
    if (!naziv.trim()) return setGreska("Unesite naziv");
    try {
      await api("/api/zadaci", {
        method: "POST",
        body: {
          naziv: naziv.trim(),
          opis: opisNovi,
          subjektId: subjekt?.id ?? null,
          dokumentId: dokument?.id ?? null,
          rok: rok ? new Date(rok).toISOString() : null,
          prioritet,
          izvrsioci: izvrsioci.map(Number),
        },
      });
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska pri snimanju");
    }
  }

  async function pozovi(path: string, body?: unknown) {
    setGreska("");
    try {
      await api(`/api/zadaci/${id}/${path}`, { method: "POST", body });
      void detalj.refetch();
    } catch (e) {
      setGreska(e instanceof ApiError ? e.message : "Greska");
    }
  }

  const naslov = id === null ? "Nov zadatak" : z?.naziv ?? "Zadatak";

  return (
    <>
      <div className="page-head" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn" onClick={onClose}>← Nazad</button>
        <h1>{naslov}</h1>
      </div>
      {greska && <div className="login-error" style={{ marginBottom: 8 }}>{greska}</div>}

      {id === null ? (
        <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">
            <span>Naziv</span>
            <input className="input" value={naziv} onChange={(e) => setNaziv(e.target.value)} maxLength={300} autoFocus />
          </label>
          <label className="field">
            <span>Prioritet</span>
            <select className="input" value={prioritet} onChange={(e) => setPrioritet(e.target.value)}>
              <option value="nizak">Nizak</option>
              <option value="srednji">Srednji</option>
              <option value="visok">Visok</option>
            </select>
          </label>
          <label className="field">
            <span>Rok (opciono)</span>
            <input type="datetime-local" className="input" value={rok} onChange={(e) => setRok(e.target.value)} />
          </label>
          <label className="field">
            <span>Subjekat (opciono)</span>
            <Autocomplete
              options={subjektOpcije}
              value={subjekt ? { id: subjekt.id, label: subjekt.naziv } : null}
              onChange={(o) => setSubjekt(o ? { id: Number(o.id), naziv: o.label } : null)}
              placeholder="Klijent ili dobavljač"
            />
          </label>
          <label className="field">
            <span>Dokument (opciono)</span>
            <Autocomplete
              options={dokumentOpcije}
              value={dokument ? { id: dokument.id, label: dokument.broj } : null}
              onChange={(o) => setDokument(o ? { id: Number(o.id), broj: o.label } : null)}
              placeholder="Broj dokumenta"
            />
          </label>
          <label className="field">
            <span>Opis (opciono)</span>
            <textarea className="input" rows={4} value={opisNovi} onChange={(e) => setOpisNovi(e.target.value)} />
          </label>
          <label className="field">
            <span>Pozovi izvršioce (opciono)</span>
            <MultiPick options={korisnikOpcije} value={izvrsioci} onChange={setIzvrsioci} placeholder="Niko (svako može da se pridruži)" />
          </label>
          <div>
            <button className="btn primary" onClick={() => void kreiraj()}>Kreiraj zadatak</button>
          </div>
        </div>
      ) : detalj.isLoading || !z ? (
        <div className="placeholder">Učitavanje...</div>
      ) : (
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            <div><b>Status:</b> {z.status === "zavrsen" ? "Završen" : "Aktivan"}</div>
            <div><b>Prioritet:</b> {z.prioritet}</div>
            {z.rok && <div><b>Rok:</b> {datumVreme(z.rok)}</div>}
            {z.subjektNaziv && <div><b>Subjekat:</b> {z.subjektNaziv}</div>}
            {z.dokumentBroj && <div><b>Dokument:</b> {z.dokumentBroj}</div>}
            <div><b>Kreirao:</b> {z.kreiraoIme}</div>
          </div>

          {/* glavni opis - aktivni ucesnici mogu da menjaju */}
          <div className="field">
            <span><b>Opis</b></span>
            {opisDraft !== null ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea className="input" rows={4} value={opisDraft} onChange={(e) => setOpisDraft(e.target.value)} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn primary"
                    onClick={async () => {
                      setGreska("");
                      try {
                        await api(`/api/zadaci/${id}/opis`, { method: "PUT", body: { opis: opisDraft } });
                        setOpisDraft(null);
                        void detalj.refetch();
                      } catch (e) {
                        setGreska(e instanceof ApiError ? e.message : "Greska");
                      }
                    }}
                  >
                    Sačuvaj
                  </button>
                  <button className="btn" onClick={() => setOpisDraft(null)}>Odustani</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ whiteSpace: "pre-wrap", flex: 1 }}>{z.opis || <i style={{ opacity: 0.6 }}>(prazno)</i>}</div>
                {jeAktivan && z.status === "aktivan" && (
                  <button className="btn" onClick={() => setOpisDraft(z.opis)}>Izmeni</button>
                )}
              </div>
            )}
          </div>

          {/* hronologija (append-only) */}
          <div className="field">
            <span><b>Hronologija</b></span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {z.hronologija.length === 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>Nema stavki.</div>}
              {z.hronologija.map((h) => (
                <div key={h.id} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 8 }}>
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{h.autorIme} - {datumVreme(h.createdAt)}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{h.tekst}</div>
                </div>
              ))}
              {jeAktivan && z.status === "aktivan" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Dodaj opis..." value={novaStavka} onChange={(e) => setNovaStavka(e.target.value)} />
                  <button
                    className="btn primary"
                    disabled={!novaStavka.trim()}
                    onClick={async () => {
                      await pozovi("opis", { tekst: novaStavka.trim() });
                      setNovaStavka("");
                    }}
                  >
                    Dodaj
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* izvrsioci */}
          <div className="field">
            <span><b>Izvršioci</b></span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {z.izvrsioci.filter((i) => i.status !== "odbio").map((i) => (
                <div key={i.userId} style={{ fontSize: 13 }}>
                  {i.ime} {i.status === "pozvan" ? <i style={{ opacity: 0.6 }}>(pozvan)</i> : ""}
                </div>
              ))}
              {z.izvrsioci.filter((i) => i.status !== "odbio").length === 0 && (
                <div style={{ opacity: 0.6, fontSize: 12 }}>Bez izvršilaca - svako može da se pridruži.</div>
              )}
            </div>
          </div>

          {/* akcije */}
          {z.status === "aktivan" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {!jeUcesnik && !jeKreator && (
                <button className="btn" onClick={() => void pozovi("pridruzi", {})}>Pridruži se</button>
              )}
              {jeUcesnik && !jeKreator && (
                <button className="btn" onClick={() => void pozovi("napusti", {})}>Napusti</button>
              )}
              {jeAktivan && (
                <>
                  <div style={{ minWidth: 220 }}>
                    <MultiPick
                      options={korisnikOpcije.filter((o) => !z.izvrsioci.some((i) => i.userId === o.id))}
                      value={pozivPick}
                      onChange={setPozivPick}
                      placeholder="Pozovi još..."
                    />
                  </div>
                  <button
                    className="btn"
                    disabled={pozivPick.length === 0}
                    onClick={async () => {
                      await pozovi("pozovi", { userIds: pozivPick.map(Number) });
                      setPozivPick([]);
                    }}
                  >
                    Pozovi
                  </button>
                  <div className="grow" />
                  <button className="btn primary" onClick={() => void pozovi("zavrsi", {})}>Završi zadatak</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
