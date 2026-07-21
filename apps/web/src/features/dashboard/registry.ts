import type { ComponentType } from "react";
import { DokumentiListaWidget, DokumentiListaConfig } from "./widgets/DokumentiListaWidget";
import { MojiDokumentiWidget } from "./widgets/MojiDokumentiWidget";
import { PreciceWidget, PreciceConfig } from "./widgets/PreciceWidget";
import { ZadaciWidget } from "./widgets/ZadaciWidget";
import { ObavestenjaWidget, ObavestenjaConfig } from "./widgets/ObavestenjaWidget";

export interface WidgetProps {
  config: Record<string, unknown>;
}
export interface WidgetConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}
export interface WidgetDef {
  tip: string;
  label: string;
  Component: ComponentType<WidgetProps>;
  Config?: ComponentType<WidgetConfigProps>;
  defaultConfig: Record<string, unknown>;
  // Pocetne dimenzije u jedinicama mreze (12 kolona). Obavestenja su siri/visi.
  defaultSize?: { w: number; h: number };
}

// Registar widgeta - raste inkrementalno kroz faze (plan 20).
export const WIDGETS: WidgetDef[] = [
  {
    tip: "dokumenti-lista",
    label: "Dokumenti",
    Component: DokumentiListaWidget,
    Config: DokumentiListaConfig,
    defaultConfig: { tip: "predracun", limit: 5 },
    defaultSize: { w: 4, h: 6 },
  },
  {
    tip: "moji-dokumenti",
    label: "Moji dokumenti u izradi",
    Component: MojiDokumentiWidget,
    defaultConfig: {},
    defaultSize: { w: 4, h: 6 },
  },
  {
    tip: "precice",
    label: "Brze prečice",
    Component: PreciceWidget,
    Config: PreciceConfig,
    defaultConfig: { items: [] },
    defaultSize: { w: 4, h: 5 },
  },
  {
    tip: "zadaci",
    label: "Moji zadaci",
    Component: ZadaciWidget,
    defaultConfig: {},
    defaultSize: { w: 6, h: 7 },
  },
  {
    tip: "obavestenja",
    label: "Obaveštenja",
    Component: ObavestenjaWidget,
    Config: ObavestenjaConfig,
    defaultConfig: { prikaziPretplate: true },
    defaultSize: { w: 6, h: 9 },
  },
];

export function widgetDef(tip: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.tip === tip);
}
