import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Verzija servera iz package.json (lockstep sa git tagom, scripts/bump-verzija.mjs)
export const appVersion: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
).version;
