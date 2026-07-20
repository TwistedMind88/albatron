import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  KALK_TROSKOVI,
  type Stavka,
  fmt,
  jePrazna,
  nabavnaKalk,
  osnovica,
  prodajnaKalk,
  r2,
  sumaBezPdv,
  sumaSaPdv,
  zaradaPoKomadu,
  zaradaStavke,
} from "./common";
import { ArtikalAutocomplete, type ArtikalOpcija } from "../../components/ArtikalAutocomplete";
import { TarifaAutocomplete, type TarifaOpcija } from "../../components/TarifaAutocomplete";
import { ZemljaAutocomplete } from "../../components/ZemljaAutocomplete";

export type { ArtikalOpcija };

interface Porez {
  id: number;
  internalValue: string;
  rate: string | null;
}

// Celija poreza (stavka 17): prikazuje vrednost stope, padajuca lista je tabela
// sa dve kolone (naziv, vrednost), a stopa moze i rucno da se ukuca (npr. 18%)
function PorezCell({
  value,
  porezi,
  onCommit,
  dataAttrs,
}: {
  value: number;
  porezi: Porez[];
  onCommit: (v: number) => void;
  dataAttrs: Record<string, number>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => {
    if (!open) return;
    const zatvori = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", zatvori);
    return () => document.removeEventListener("mousedown", zatvori);
  }, [open]);
  function commit() {
    const n = Number(draft.replace(",", "."));
    if (!isNaN(n) && n !== value) onCommit(n);
    else setDraft(String(value));
  }
  function toggle() {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 2, left: r.left });
    setOpen((o) => !o);
  }
  return (
    <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <input
        className="input"
        style={{ width: 48, textAlign: "right" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        {...dataAttrs}
      />
      <span style={{ fontSize: 11 }}>%</span>
      <button type="button" className="btn" style={{ padding: "0 4px" }} onClick={toggle} title="Izbor poreza">
        &#9662;
      </button>
      {open && rect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              minWidth: 200,
            }}
          >
            <table className="data" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>Naziv</th>
                  <th style={{ textAlign: "right" }}>Vrednost</th>
                </tr>
              </thead>
              <tbody>
                {porezi.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onMouseDown={() => {
                      onCommit(Number(p.rate ?? 0));
                      setOpen(false);
                    }}
                  >
                    <td>{p.internalValue}</td>
                    <td style={{ textAlign: "right" }}>{Number(p.rate ?? 0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          document.body,
        )}
    </div>
  );
}

// Celija sa lokalnim draftom - potvrda na blur/Enter (Excel ponasanje, brief 7.4)
function CellNum({
  value,
  onCommit,
  width = 70,
  disabled,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  width?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  function commit() {
    const n = Number(draft.replace(",", "."));
    if (!isNaN(n) && n !== value) onCommit(n);
    else setDraft(value === null ? "" : String(value));
  }
  return (
    <input
      className="input"
      style={{ width, textAlign: "right" }}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function CellText({
  value,
  onCommit,
  width = 90,
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="input"
      style={{ width }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && draft !== value && onCommit(draft)}
    />
  );
}

// Kolone koje korisnik moze da sakrije, po tipu dokumenta (stavka 15).
// # / Ident / Naziv / Kol. / akcije su uvek vidljive.
export function dostupneKolone(tip: string): { id: string; label: string }[] {
  const k: { id: string; label: string }[] = [];
  if (tip !== "revers") {
    k.push(
      { id: "cena", label: "Cena" },
      { id: "popust", label: "Popust %" },
      { id: "cenaSaPopustom", label: "Cena s popustom" },
      { id: "osnovica", label: "Osnovica" },
      { id: "sumaBezPdv", label: "Suma bez PDV" },
      { id: "porez", label: "Porez" },
      { id: "sumaSaPdv", label: "Suma sa PDV" },
    );
  }
  if (tip === "kalkulacija") {
    for (const t of KALK_TROSKOVI) k.push({ id: `kalk_${t.id}`, label: `${t.label} %` });
    k.push(
      { id: "nabavna", label: "Nabavna" },
      { id: "marza", label: "Marža %" },
      { id: "zaradaKom", label: "Zarada/kom" },
      { id: "zarada", label: "Zarada" },
      { id: "prodajnaCena", label: "Prodajna cena" },
      { id: "prodajnaSuma", label: "Prodajna suma" },
    );
  }
  if (tip === "ponuda" || tip === "predracun") k.push({ id: "rok", label: "Rok isporuke" });
  // izracunate kolone prenosa (faza 3), read-only
  if (tip === "predracun") k.push({ id: "otpremljeno", label: "Otpremljeno" });
  if (tip === "otpremnica") k.push({ id: "fakturisano", label: "Fakturisano" });
  if (tip === "ponuda") k.push({ id: "opcioni", label: "Opc." });
  if (tip === "revers") k.push({ id: "serijskiBroj", label: "Serijski broj" });
  if (tip === "priprema_uvoza" || tip === "ulaz_robe") {
    k.push(
      { id: "zemljaPorekla", label: "Zemlja porekla" },
      { id: "carinskaTarifa", label: "Car. tarifa" },
      { id: "carinskaStopa", label: "Carina %" },
      { id: "transport", label: "Transport" },
    );
  }
  if (tip === "porudzbina") k.push({ id: "zaKoga", label: "Za koga" });
  // koleta - samo nabavni tipovi (faza 17, RP5)
  if (tip === "porudzbina" || tip === "priprema_uvoza" || tip === "ulaz_robe") k.push({ id: "koleta", label: "Koleta" });
  if (tip === "ulaz_robe" || tip === "otpremnica" || tip === "racun") k.push({ id: "serBrojevi", label: "Ser. brojevi" });
  return k;
}

export function StavkeTabela({
  tip,
  stavke,
  porezi,
  tarife,
  artikli,
  valuta,
  onIzmena,
  onIzborArtikla,
  onOtvoriArtikal,
  onNapomena,
  onPovezani,
  onObrisi,
  onNoviRed,
  onPotrebe,
  onSerijski,
  skrivene,
  redosled,
  sirine,
  onRedosled,
  onSirina,
}: {
  tip: string;
  stavke: Stavka[];
  porezi: Porez[];
  tarife: TarifaOpcija[];
  artikli: ArtikalOpcija[];
  valuta: string;
  onIzmena: (idx: number, izmena: Partial<Stavka>, resetujPopust?: boolean) => void;
  onIzborArtikla: (idx: number, articleId: number) => void;
  onOtvoriArtikal: (articleId: number, naziv: string) => void;
  onNapomena: (idx: number, rect: DOMRect) => void;
  onPovezani: (idx: number, rect: DOMRect) => void;
  onObrisi: (idx: number) => void;
  onNoviRed: () => void;
  onPotrebe?: (idx: number) => void;
  onSerijski?: (idx: number) => void;
  skrivene?: string[];
  redosled?: string[];
  sirine?: Record<string, number>;
  onRedosled?: (order: string[]) => void;
  onSirina?: (id: string, w: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // model kolona (RP14): vidljive kolone u redosledu iz preferenci, nove na kraju
  const dostupne = dostupneKolone(tip);
  const vidljive = dostupne.filter((k) => !skrivene?.includes(k.id)).map((k) => k.id);
  const kolone = [
    ...(redosled ?? []).filter((id) => vidljive.includes(id)),
    ...vidljive.filter((id) => !(redosled ?? []).includes(id)),
  ];
  const labelOd = new Map(dostupne.map((k) => [k.id, k.label]));
  const PODRAZUMEVANE_SIRINE: Record<string, number> = {
    ident: 80, naziv: 240, kolicina: 60,
    nabavna: 90, zaradaKom: 90, zarada: 90, prodajnaCena: 90, prodajnaSuma: 100,
  };
  const sirina = (id: string) => sirine?.[id] ?? PODRAZUMEVANE_SIRINE[id] ?? 80;

  // resize: drag na desnoj ivici th, direktno na DOM tokom vucenja, snimi na mouseup
  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startX = e.clientX;
    const startW = th.offsetWidth;
    const move = (ev: MouseEvent) => {
      th.style.width = `${Math.max(40, startW + ev.clientX - startX)}px`;
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      onSirina?.(id, Math.max(40, startW + ev.clientX - startX));
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  // redosled: native HTML5 drag na labeli u th
  const dragId = useRef<string | null>(null);
  function onDrop(ciljId: string) {
    const izvor = dragId.current;
    dragId.current = null;
    if (!izvor || izvor === ciljId) return;
    const nov = kolone.filter((id) => id !== izvor);
    nov.splice(nov.indexOf(ciljId), 0, izvor);
    onRedosled?.(nov);
  }

  // Excel navigacija (brief 7.4): Enter/strelice kroz inpute po data-r/data-c
  function onKeyDown(e: React.KeyboardEvent) {
    const el = e.target as HTMLElement;
    const r = Number(el.dataset.r ?? -1);
    const c = Number(el.dataset.c ?? -1);
    if (r < 0 || c < 0) return;
    let nr = r;
    let nc = c;
    if (e.key === "Enter" || (e.key === "ArrowRight" && el instanceof HTMLSelectElement === false)) nc = c + 1;
    else if (e.key === "ArrowLeft") nc = c - 1;
    else if (e.key === "ArrowUp") nr = r - 1;
    else if (e.key === "ArrowDown") {
      if (r === stavke.length - 1 && !stavke.some(jePrazna)) {
        onNoviRed();
        return;
      }
      nr = r + 1;
    } else return;
    const next = rootRef.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    }
  }

  // cena/osnovica/sume: unos bilo kog vraca popust na 0 i preracunava cenu (brief 7.4)
  function izCene(idx: number, cena: number) {
    onIzmena(idx, { cena: r2(cena), popust: 0 });
  }

  // koleta (faza 17, RP5): odnos = zbirna dobavljaceva / zbirna nasa kolicina sa artikla
  const jeNabavniTip = tip === "porudzbina" || tip === "priprema_uvoza" || tip === "ulaz_robe";
  function koletaOdnos(articleId: number | null) {
    const a = artikli.find((x) => x.id === articleId);
    const nasa = Number(a?.zbirnaNasaKolicina ?? 0);
    const dob = Number(a?.zbirnaDobKolicina ?? 0);
    return nasa > 0 && dob > 0 ? dob / nasa : null;
  }

  // izmena kolicine preracunava koletu (snapshot na stavci), i obratno
  function izKolicine(idx: number, s: Stavka, v: number) {
    const odnos = jeNabavniTip ? koletaOdnos(s.articleId) : null;
    onIzmena(idx, odnos ? { kolicina: v, koleta: r2(v * odnos) } : { kolicina: v });
  }

  // render celije po id-u kolone (RP14: dinamican redosled)
  function tdZa(id: string, s: Stavka, idx: number, dataAttrs: () => Record<string, number>) {
    if (id.startsWith("kalk_")) {
      const t = id.slice(5);
      return (
        <td key={id}>
          <CellNum
            value={s.kalk?.[t] ?? null}
            width={60}
            onCommit={(v) => onIzmena(idx, { kalk: { ...s.kalk, [t]: v } })}
            {...dataAttrs()}
          />
        </td>
      );
    }
    switch (id) {
      case "cena":
        return (
          <td key={id}>
            <CellNum value={s.cena} onCommit={(v) => izCene(idx, v)} {...dataAttrs()} />
          </td>
        );
      case "popust":
        return (
          <td key={id}>
            <CellNum value={s.popust} width={55} onCommit={(v) => onIzmena(idx, { popust: v })} {...dataAttrs()} />
          </td>
        );
      // cena sa popustom (stavka 19): unos menja popust, cena ostaje ista
      case "cenaSaPopustom":
        return (
          <td key={id}>
            <CellNum
              value={r2(osnovica(s))}
              width={85}
              onCommit={(v) => onIzmena(idx, { popust: s.cena ? r2((1 - v / s.cena) * 100) : 0 })}
              {...dataAttrs()}
            />
          </td>
        );
      case "osnovica":
        return (
          <td key={id}>
            <CellNum value={r2(osnovica(s))} onCommit={(v) => izCene(idx, v)} {...dataAttrs()} />
          </td>
        );
      case "sumaBezPdv":
        return (
          <td key={id}>
            <CellNum value={r2(sumaBezPdv(s))} width={85} onCommit={(v) => izCene(idx, s.kolicina ? v / s.kolicina : v)} {...dataAttrs()} />
          </td>
        );
      case "porez":
        return (
          <td key={id}>
            {/* vrednost u polju + 2-kolonska lista + rucni unos (stavka 17) */}
            <PorezCell
              value={s.porezStopa}
              porezi={porezi}
              onCommit={(v) => onIzmena(idx, { porezStopa: v })}
              dataAttrs={dataAttrs()}
            />
          </td>
        );
      case "sumaSaPdv":
        return (
          <td key={id}>
            <CellNum
              value={r2(sumaSaPdv(s))}
              width={85}
              onCommit={(v) => izCene(idx, s.kolicina ? v / (1 + s.porezStopa / 100) / s.kolicina : v)}
              {...dataAttrs()}
            />
          </td>
        );
      // nabavna se iskljucivo preracunava: osnovica + zbir procenata troskova
      case "nabavna":
        return (
          <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(nabavnaKalk(s)))}</td>
        );
      case "marza":
        return (
          <td key={id}>
            <CellNum
              value={s.kalk?.marza ?? null}
              width={55}
              onCommit={(v) => onIzmena(idx, { kalk: { ...s.kalk, marza: v } })}
              {...dataAttrs()}
            />
          </td>
        );
      case "zaradaKom":
        return <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(zaradaPoKomadu(s)))}</td>;
      case "zarada":
        return (
          <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            {fmt(r2(zaradaStavke(s)))} {valuta}
          </td>
        );
      case "prodajnaCena":
        return <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(prodajnaKalk(s)))}</td>;
      case "prodajnaSuma":
        return <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(prodajnaKalk(s) * s.kolicina))}</td>;
      case "rok":
        return (
          <td key={id}>
            <CellText value={s.rokIsporuke} onCommit={(v) => onIzmena(idx, { rokIsporuke: v })} {...dataAttrs()} />
          </td>
        );
      // izracunato pri citanju (faza 3), read-only
      case "otpremljeno":
        return <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(s.otpremljeno ?? 0))}</td>;
      case "fakturisano":
        return <td key={id} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r2(s.fakturisano ?? 0))}</td>;
      case "opcioni":
        return (
          <td key={id}>
            <input
              type="checkbox"
              checked={s.opcioni}
              onChange={(e) => onIzmena(idx, { opcioni: e.target.checked })}
            />
          </td>
        );
      case "serijskiBroj":
        return (
          <td key={id}>
            <CellText value={s.serijskiBroj} width={120} onCommit={(v) => onIzmena(idx, { serijskiBroj: v })} {...dataAttrs()} />
          </td>
        );
      case "zemljaPorekla":
        return (
          <td key={id}>
            {/* fiksna lista zemalja predlaze, slobodan unos ostaje (RP7.2) */}
            <ZemljaAutocomplete value={s.zemljaPorekla} width={100} onChange={(v) => onIzmena(idx, { zemljaPorekla: v })} />
          </td>
        );
      case "carinskaTarifa":
        return (
          <td key={id}>
            {/* izbor iz sifarnika popunjava sifru i procenat, oba rucno editabilna (RP7.3) */}
            <TarifaAutocomplete
              value={s.carinskaTarifa}
              tarife={tarife}
              width={90}
              onCommit={(sifra, stopa) =>
                onIzmena(idx, stopa === undefined ? { carinskaTarifa: sifra } : { carinskaTarifa: sifra, carinskaStopa: stopa })
              }
              dataAttrs={dataAttrs()}
            />
          </td>
        );
      case "carinskaStopa":
        return (
          <td key={id}>
            <CellNum value={s.carinskaStopa} width={55} onCommit={(v) => onIzmena(idx, { carinskaStopa: v })} {...dataAttrs()} />
          </td>
        );
      case "transport":
        return (
          <td key={id}>
            <CellNum value={s.transportTrosak} width={70} onCommit={(v) => onIzmena(idx, { transportTrosak: v })} {...dataAttrs()} />
          </td>
        );
      case "koleta": {
        // artikal bez zbirne JM: polje prazno i zakljucano (faza 17, RP5)
        const odnos = koletaOdnos(s.articleId);
        return (
          <td key={id}>
            <CellNum
              value={odnos ? s.koleta : null}
              width={60}
              disabled={!odnos}
              onCommit={(v) => odnos && onIzmena(idx, { koleta: r2(v), kolicina: r2(v / odnos) })}
              {...dataAttrs()}
            />
          </td>
        );
      }
      case "zaKoga":
        return (
          <td key={id} style={{ textAlign: "center" }}>
            {/* baloncic sa listom dokumenata/klijenata (brief 8.5) */}
            <button
              className="btn"
              style={{ padding: "1px 6px", fontWeight: s.potrebe?.length ? 700 : 400 }}
              title="Za koje predračune/klijente se poručuje"
              onClick={() => onPotrebe?.(idx)}
            >
              {s.potrebe?.length ?? 0}
            </button>
          </td>
        );
      case "serBrojevi":
        return (
          <td key={id} style={{ textAlign: "center" }}>
            <button
              className="btn"
              style={{ padding: "1px 6px", fontWeight: s.serijskiBrojevi?.length ? 700 : 400 }}
              title="Serijski brojevi"
              onClick={() => onSerijski?.(idx)}
            >
              {s.serijskiBrojevi?.length ?? 0}
            </button>
          </td>
        );
      default:
        return <td key={id} />;
    }
  }

  return (
    <div className="tablewrap" ref={rootRef} onKeyDown={onKeyDown}>
      <table className="data stavke" style={{ tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            {/* fiksne kolone: resize + persistencija kao dinamicke, bez drag redosleda (RP2) */}
            {(
              [["ident", "Ident"], ["naziv", "Naziv"], ["kolicina", "Kol."]] as const
            ).map(([id, label]) => (
              <th key={id} style={{ width: sirina(id), position: "relative" }}>
                {label}
                <span
                  onMouseDown={(e) => startResize(e, id)}
                  style={{ position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 1 }}
                />
              </th>
            ))}
            {kolone.map((id) => (
              <th
                key={id}
                style={{ width: sirina(id), position: "relative" }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(id)}
              >
                <span
                  draggable
                  style={{ cursor: "grab" }}
                  title="Prevuci za promenu redosleda"
                  onDragStart={() => (dragId.current = id)}
                >
                  {labelOd.get(id)}
                </span>
                {/* rucica za resize na desnoj ivici (RP14) */}
                <span
                  onMouseDown={(e) => startResize(e, id)}
                  style={{ position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 1 }}
                />
              </th>
            ))}
            {/* spacer upija visak prostora, akciona kolona ostaje uz desnu ivicu (RP2) */}
            <th />
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {stavke.map((s, idx) => {
            let col = 0;
            const dataAttrs = () => ({ "data-r": idx, "data-c": col++ }) as Record<string, number>;
            if (jePrazna(s)) {
              // prazan red: kucanje po nazivu ili identu (brief 7.4)
              return (
                <tr key={`p${idx}`}>
                  <td>{idx + 1}</td>
                  <td>
                    <ArtikalAutocomplete
                      artikli={artikli}
                      polje="ident"
                      placeholder="ident"
                      onIzbor={(aid) => onIzborArtikla(idx, aid)}
                    />
                  </td>
                  <td colSpan={2}>
                    <ArtikalAutocomplete
                      artikli={artikli}
                      polje="naziv"
                      placeholder="kucaj naziv artikla..."
                      onIzbor={(aid) => onIzborArtikla(idx, aid)}
                    />
                  </td>
                  <td colSpan={20}>
                    <button className="btn" style={{ padding: "1px 8px" }} onClick={() => onObrisi(idx)}>
                      x
                    </button>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={s.id ?? `n${idx}`}>
                <td>{idx + 1}</td>
                {/* dvoklik na ident ili naziv otvara artikal u svom tabu (stavka 11) */}
                <td
                  className="subtle"
                  style={s.articleId !== null ? { cursor: "pointer" } : undefined}
                  title={s.articleId !== null ? "Dvoklik otvara artikal" : undefined}
                  onDoubleClick={() => s.articleId !== null && onOtvoriArtikal(s.articleId, s.naziv)}
                >
                  {s.ident}
                </td>
                <td
                  style={s.articleId !== null ? { cursor: "pointer" } : undefined}
                  title={s.articleId !== null ? "Dvoklik otvara artikal" : undefined}
                  onDoubleClick={() => s.articleId !== null && onOtvoriArtikal(s.articleId, s.naziv)}
                >
                  {s.naziv}
                </td>
                <td>
                  <CellNum value={s.kolicina} width={55} onCommit={(v) => izKolicine(idx, s, v)} {...dataAttrs()} />
                </td>
                {kolone.map((id) => tdZa(id, s, idx, dataAttrs))}
                <td />
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="btn"
                    style={{ padding: "1px 6px", fontWeight: s.napomena ? 700 : 400 }}
                    title="Napomena stavke"
                    onClick={(e) => onNapomena(idx, e.currentTarget.getBoundingClientRect())}
                  >
                    A
                  </button>{" "}
                  <button
                    className="btn"
                    style={{ padding: "1px 6px" }}
                    title="Povezani artikli"
                    onClick={(e) => onPovezani(idx, e.currentTarget.getBoundingClientRect())}
                  >
                    +
                  </button>{" "}
                  <button className="btn" style={{ padding: "1px 6px" }} title="Obriši stavku" onClick={() => onObrisi(idx)}>
                    x
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 6 }} disabled={stavke.some(jePrazna)} onClick={onNoviRed}>
        + Dodaj artikal
      </button>
    </div>
  );
}
