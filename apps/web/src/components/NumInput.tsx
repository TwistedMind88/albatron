import { useEffect, useRef, useState } from "react";

export function NumInput({
  value,
  onChange,
  width = 110,
  disabled,
  inputMode = "decimal",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  width?: number;
  disabled?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  // type="text" bez spinner strelica (faza 16, st. 56); draft cuva unos u toku
  // kucanja ("1." / "1,5"), zarez se prihvata kao decimalni separator
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      className="input"
      inputMode={inputMode}
      style={{ width }}
      disabled={disabled}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(value === null ? "" : String(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (t.trim() === "") return onChange(null);
        const num = Number(t.replace(",", "."));
        if (!Number.isNaN(num)) onChange(num);
      }}
    />
  );
}
