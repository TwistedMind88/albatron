import { useState } from "react";
import { ObavestenjaLista } from "../../obavestenja/ObavestenjaLista";
import { PretplateForm } from "../../obavestenja/PretplateForm";
import type { WidgetConfigProps, WidgetProps } from "../registry";

function cfg(c: Record<string, unknown>) {
  return { prikaziPretplate: c.prikaziPretplate !== false };
}

// Tanak omotac oko postojecih obavestenja komponenti. Cist reuse - bez nove logike.
export function ObavestenjaWidget({ config }: WidgetProps) {
  const { prikaziPretplate } = cfg(config);
  const [pretplate, setPretplate] = useState(false);

  if (pretplate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setPretplate(false)}>&larr; Nazad</button>
        <PretplateForm onSaved={() => setPretplate(false)} />
      </div>
    );
  }

  return (
    <div>
      {prikaziPretplate && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button className="btn" onClick={() => setPretplate(true)}>Pretplate</button>
        </div>
      )}
      <ObavestenjaLista limit={10} />
    </div>
  );
}

export function ObavestenjaConfig({ config, onChange }: WidgetConfigProps) {
  const { prikaziPretplate } = cfg(config);
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, cursor: "pointer" }}>
      <input type="checkbox" checked={prikaziPretplate} onChange={(e) => onChange({ ...config, prikaziPretplate: e.target.checked })} />
      Dugme za pretplate
    </label>
  );
}
