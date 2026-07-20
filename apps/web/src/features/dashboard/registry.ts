import type { ComponentType } from "react";
import { DokumentiListaWidget, DokumentiListaConfig } from "./widgets/DokumentiListaWidget";
import { MojiDokumentiWidget } from "./widgets/MojiDokumentiWidget";
import { PreciceWidget, PreciceConfig } from "./widgets/PreciceWidget";

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
}

// Registar widgeta - raste inkrementalno kroz faze (plan 20).
export const WIDGETS: WidgetDef[] = [
  {
    tip: "dokumenti-lista",
    label: "Dokumenti",
    Component: DokumentiListaWidget,
    Config: DokumentiListaConfig,
    defaultConfig: { tip: "predracun", limit: 5 },
  },
  {
    tip: "moji-dokumenti",
    label: "Moji dokumenti u izradi",
    Component: MojiDokumentiWidget,
    defaultConfig: {},
  },
  {
    tip: "precice",
    label: "Brze prečice",
    Component: PreciceWidget,
    Config: PreciceConfig,
    defaultConfig: { items: [] },
  },
];

export function widgetDef(tip: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.tip === tip);
}
