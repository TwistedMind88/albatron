// Upisuje istu verziju u sve package.json i tauri.conf.json (lockstep sa git tagom).
// Upotreba: node scripts/bump-verzija.mjs 1.1.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const verzija = process.argv[2];
if (!verzija || !/^\d+\.\d+\.\d+$/.test(verzija)) {
  console.error("Upotreba: node scripts/bump-verzija.mjs X.Y.Z");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fajlovi = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/shared/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
];

for (const rel of fajlovi) {
  const putanja = join(root, rel);
  const json = JSON.parse(readFileSync(putanja, "utf8"));
  json.version = verzija;
  writeFileSync(putanja, JSON.stringify(json, null, 2) + "\n");
  console.log(`${rel}: ${verzija}`);
}
