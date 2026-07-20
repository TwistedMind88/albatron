import type { SessionUser } from "@albatron/shared";
import { TabIdContext, useTabs } from "../store/tabs";
import { Sidebar } from "./Sidebar";
import { TabBar, UnsavedPopup } from "./TabBar";
import { KorisniciPage } from "../features/korisnici/KorisniciPage";
import { PodesavanjaPage } from "../features/podesavanja/PodesavanjaPage";
import { SubjektiPage } from "../features/subjekti/SubjektiPage";
import { ArtikliPage } from "../features/artikli/ArtikliPage";
import { CenovniciPage } from "../features/cenovnici/CenovniciPage";
import { DokumentiPage } from "../features/dokumenti/DokumentiPage";
import { PrenosiPage } from "../features/zalihe/PrenosiPage";
import { PopisiPage } from "../features/zalihe/PopisiPage";
import { PresifriranjaPage } from "../features/zalihe/PresifriranjaPage";
import { ObracuniPage, ObracunRezultat } from "../features/obracuni/ObracuniPage";
import { ProjektiPage } from "../features/projekti/ProjektiPage";
import { ArtikliImportPage, SubjektiImportPage, UplateImportPage } from "../components/ImportSifarnika";
import { UplatePage } from "../features/uplate/UplatePage";
import { ZadaciPage } from "../features/zadaci/ZadaciPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { useEffect } from "react";

// Registar stranica po sekciji - puni se kroz faze
const PAGES: Record<string, React.ComponentType<{ payload?: unknown }>> = {
  korisnici: KorisniciPage,
  podesavanja: PodesavanjaPage,
  klijenti: ({ payload }) => <SubjektiPage uloga="klijent" payload={payload} />,
  dobavljaci: ({ payload }) => <SubjektiPage uloga="dobavljac" payload={payload} />,
  artikli: ArtikliPage,
  cenovnici: CenovniciPage,
  ponude: ({ payload }) => <DokumentiPage tip="ponuda" payload={payload} />,
  predracuni: ({ payload }) => <DokumentiPage tip="predracun" payload={payload} />,
  reversi: ({ payload }) => <DokumentiPage tip="revers" payload={payload} />,
  kalkulacije: ({ payload }) => <DokumentiPage tip="kalkulacija" payload={payload} />,
  porudzbine: ({ payload }) => <DokumentiPage tip="porudzbina" payload={payload} />,
  "priprema-za-uvoz": ({ payload }) => <DokumentiPage tip="priprema_uvoza" payload={payload} />,
  "ulaz-robe": ({ payload }) => <DokumentiPage tip="ulaz_robe" payload={payload} />,
  otpremnice: ({ payload }) => <DokumentiPage tip="otpremnica" payload={payload} />,
  racuni: ({ payload }) => <DokumentiPage tip="racun" payload={payload} />,
  "avansni-racuni": ({ payload }) => <DokumentiPage tip="avansni_racun" payload={payload} />,
  prenosi: PrenosiPage,
  popisi: PopisiPage,
  presifriranja: PresifriranjaPage,
  // import tabovi (faza 15, RP4): skriveni iz sidebara, otvaraju se dugmetom Import
  "artikli-import": ArtikliImportPage,
  "klijenti-import": () => <SubjektiImportPage uloga="klijent" />,
  "dobavljaci-import": () => <SubjektiImportPage uloga="dobavljac" />,
  obracuni: ObracuniPage,
  uplate: UplatePage,
  "uplate-import": UplateImportPage,
  "obracun-rezultat": ObracunRezultat,
  projekti: ProjektiPage,
  zadaci: ZadaciPage,
  pocetna: DashboardPage,
};

function TabContent({ sectionId, title, payload }: { sectionId: string; title: string; payload?: unknown }) {
  const Page = PAGES[sectionId];
  if (Page) return <Page payload={payload} />;
  return (
    <div className="placeholder">
      Sekcija "{title}" se dodaje u narednim fazama razvoja.
    </div>
  );
}

export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  // Dashboard je landing: prva prijava otvara "Početna" umesto praznog placeholdera (plan 20, faza 4)
  useEffect(() => {
    if (useTabs.getState().tabs.length === 0) useTabs.getState().open("pocetna", "Početna");
  }, []);

  return (
    <div className="app">
      <Sidebar user={user} onLogout={onLogout} />
      <div className="main">
        <TabBar />
        {/* Svi tabovi ostaju mountovani (skriveni sa display:none) da se
            nesacuvane izmene ne izgube pri promeni taba (faza 14.1) */}
        {tabs.map((t) => (
          <div key={t.id} className="content" style={t.id === activeId ? undefined : { display: "none" }}>
            <TabIdContext.Provider value={t.id}>
              <TabContent sectionId={t.sectionId} title={t.title} payload={t.payload} />
            </TabIdContext.Provider>
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="content">
            <div className="placeholder">Izaberite sekciju iz menija sa leve strane.</div>
          </div>
        )}
      </div>
      <UnsavedPopup />
    </div>
  );
}
