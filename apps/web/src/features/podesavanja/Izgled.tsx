import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { Ikona } from "../../components/Ikona";
import { TEME, primeniTemu, type Tema } from "../../teme";

// Izbor teme interfejsa po korisniku (uiPrefs.tema).
// Kartice sa umanjenim prikazom dokumenta, pregled preko celog ekrana i primena.

function Polje({ label, value, width, flex }: { label: string; value: string; width?: number; flex?: number }) {
  return (
    <label className="field" style={{ width, flex }}>
      {label}
      <input className="input" value={value} readOnly tabIndex={-1} />
    </label>
  );
}

const red: React.CSSProperties = { display: "flex", gap: 8 };

// Staticki prikaz ekrana dokumenta (nista nije aktivno) - koristi klase aplikacije
// pa verno prati boje/fontove teme u cijem se kontejneru nalazi
function MockDokument() {
  return (
    <div
      style={{
        display: "flex",
        width: 1200,
        height: 760,
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--font-ui)",
        fontSize: 13,
        pointerEvents: "none",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* mini sidebar */}
      <div className="sidebar" style={{ width: 184, flexShrink: 0 }}>
        <div className="brand">
          Albatron<small>poslovni program</small>
        </div>
        <div className="nav">
          <div className="nav-group">
            <span><Ikona id="cart" size={13} />Prodaja</span>
            <a><span className="nav-l"><Ikona id="doc" />Ponude</span></a>
            <a className="active"><span className="nav-l"><Ikona id="doc-check" />Predračuni</span></a>
            <a><span className="nav-l"><Ikona id="calc" />Kalkulacije</span></a>
          </div>
          <div className="nav-group">
            <span><Ikona id="truck" size={13} />Isporuka</span>
            <a><span className="nav-l"><Ikona id="send" />Otpremnice</span></a>
            <a><span className="nav-l"><Ikona id="receipt" />Računi</span></a>
          </div>
          <div className="nav-group">
            <span><Ikona id="book" size={13} />Šifarnici</span>
            <a><span className="nav-l"><Ikona id="users" />Klijenti</span></a>
            <a><span className="nav-l"><Ikona id="tag" />Artikli</span></a>
          </div>
        </div>
        <div className="user">
          <b>Danko K.</b>
          <span>Administrator</span>
        </div>
      </div>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <div className="tabbar">
          <div className="tab">Početna</div>
          <div className="tab active">
            <span className="dot" /> Predračun 26-PR-00042 <span className="x">×</span>
          </div>
        </div>
        <div className="content" style={{ overflow: "hidden" }}>
          <div className="page-head">
            <h1>Predračun 26-PR-00042</h1>
            <div className="grow" />
            <button className="btn">Izveštaj</button>
            <button className="btn">Generiši</button>
            <button className="btn primary">Sačuvaj</button>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "stretch" }}>
            {/* klijent */}
            <div className="card" style={{ flex: 3, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
                <button className="btn primary" style={{ padding: "2px 10px" }}>Klijent</button>
                <button className="btn" style={{ padding: "2px 10px" }}>Adresa slanja</button>
                <button className="btn" style={{ padding: "2px 10px" }}>Posrednik</button>
              </div>
              <div style={red}>
                <Polje label="Naziv (interni)" value="Tehnoguard" flex={1} />
                <Polje label="PIB" value="108234567" width={110} />
              </div>
              <Polje label="Puni naziv" value="Tehnoguard d.o.o. Novi Sad" />
              <div style={red}>
                <Polje label="Adresa" value="Bulevar oslobođenja 128" flex={2} />
                <Polje label="Pošt. broj" value="21000" width={70} />
                <Polje label="Grad" value="Novi Sad" flex={1} />
              </div>
              <div style={red}>
                <Polje label="Kontakt osoba" value="Milan Perić" flex={1} />
                <Polje label="Telefon" value="063/555-123" width={110} />
                <Polje label="Mail" value="milan@tehnoguard.rs" flex={1} />
              </div>
            </div>
            {/* podaci dokumenta - optimizovan raspored: datumi u jednom redu,
                paritet + nacin placanja zajedno, sirine po potrebi polja */}
            <div className="card" style={{ flex: 2, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={red}>
                <Polje label="Broj" value="26-PR-00042" width={110} />
                <Polje label="Datum" value="18.07.2026." width={112} />
                <Polje label="Rok (dana)" value="15" width={68} />
                <Polje label="Važi do" value="02.08.2026." width={112} />
              </div>
              <div style={red}>
                <Polje label="Valuta" value="RSD" width={64} />
                <Polje label="Kurs" value="117,25" width={90} />
                <Polje label="Status" value="U izradi" width={120} />
              </div>
              <div style={red}>
                <Polje label="Paritet" value="DAP" width={120} />
                <Polje label="Način plaćanja" value="Virman" width={140} />
              </div>
              <div style={red}>
                <Polje label="Referent" value="Danko K." width={140} />
                <Polje label="Referenca kupca" value="PO-2026-118" flex={1} />
              </div>
            </div>
            {/* rekapitulacija */}
            <div className="card" style={{ flex: 1.4, minWidth: 180, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ color: "var(--ink-2)" }}>Osnovica</span>
                <b>209.840,00</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ color: "var(--ink-2)" }}>PDV (20%)</span>
                <b>41.968,00</b>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0 3px",
                  marginTop: 4,
                  borderTop: "1px solid var(--line)",
                  fontSize: 14,
                }}
              >
                <span>Ukupno</span>
                <b style={{ color: "var(--accent)" }}>251.808,00</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--ok)" }}>
                <span>Zarada</span>
                <b>38.450,00</b>
              </div>
            </div>
          </div>
          <div className="tablewrap">
            <table className="data stavke">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ident</th>
                  <th>Naziv</th>
                  <th style={{ textAlign: "right" }}>Kol.</th>
                  <th>JM</th>
                  <th style={{ textAlign: "right" }}>Cena</th>
                  <th style={{ textAlign: "right" }}>Rabat %</th>
                  <th style={{ textAlign: "right" }}>Ukupno</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["1", "000123", "Detektor dima ADX-210", "12", "kom", "4.850,00", "10", "52.380,00"],
                  ["2", "000087", "Centrala CP-08 sa napajanjem", "2", "kom", "38.200,00", "5", "72.580,00"],
                  ["3", "000145", "Sirena spoljna SR-90", "4", "kom", "6.120,00", "0", "24.480,00"],
                  ["4", "000098", "Kabl JB-Y(St)Y 2x2x0,8", "500", "m", "96,00", "15", "40.800,00"],
                  ["5", "000156", "Akumulator 12V/7Ah", "8", "kom", "2.450,00", "0", "19.600,00"],
                ].map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, i) => (
                      <td key={i} style={i >= 3 && i !== 4 ? { textAlign: "right" } : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const SKALA = 0.25;

export function Izgled() {
  const queryClient = useQueryClient();
  const profil = useQuery({
    queryKey: ["moj-profil-tema"],
    queryFn: () => api<{ uiPrefs?: Record<string, unknown> | null }>("/api/moj-profil"),
  });
  const aktivna = ((profil.data?.uiPrefs as { tema?: string } | null)?.tema ?? "standard") as string;
  const [pregled, setPregled] = useState<Tema | null>(null);

  async function primeni(tema: Tema) {
    const prefs = (profil.data?.uiPrefs ?? {}) as Record<string, unknown>;
    await api("/api/moj-profil", { method: "PUT", body: { uiPrefs: { ...prefs, tema: tema.id } } });
    primeniTemu(tema.id);
    await queryClient.invalidateQueries({ queryKey: ["moj-profil-tema"] });
    setPregled(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 17, margin: 0 }}>Izgled</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
        Tema se pamti po korisniku i važi na svakom uređaju sa koga se prijavite.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {TEME.map((t) => (
          <div key={t.id} className="card" style={{ width: 324, padding: 10 }}>
            <div
              className={t.klasa}
              style={{
                width: 300,
                height: 190,
                overflow: "hidden",
                borderRadius: 4,
                border: "1px solid var(--line)",
                cursor: "pointer",
              }}
              title="Klik za pregled preko celog ekrana"
              onClick={() => setPregled(t)}
            >
              <div style={{ transform: `scale(${SKALA})`, transformOrigin: "top left" }}>
                <MockDokument />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{t.naziv}</b>
                {t.id === aktivna && <span style={{ color: "var(--ok)", fontSize: 11.5, marginLeft: 6 }}>aktivna</span>}
                <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{t.opis}</div>
              </div>
              <button className="btn" onClick={() => setPregled(t)}>
                Pregled
              </button>
              <button className="btn primary" disabled={t.id === aktivna} onClick={() => primeni(t)}>
                Primeni
              </button>
            </div>
          </div>
        ))}
      </div>

      {pregled && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              background: "var(--surface)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <b>Pregled teme: {pregled.naziv}</b>
            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Prikaz nije aktivan - služi samo za izgled</span>
            <div className="grow" />
            <button className="btn primary" disabled={pregled.id === aktivna} onClick={() => primeni(pregled)}>
              Primeni temu
            </button>
            <button className="btn" onClick={() => setPregled(null)}>
              Zatvori
            </button>
          </div>
          <div className={pregled.klasa} style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
            <MockDokument />
          </div>
        </div>
      )}
    </div>
  );
}
