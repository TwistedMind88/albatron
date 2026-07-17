import { createReadStream, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { appVersion } from "../../version.js";

// Repo-root downloads/ - instalaciona skripta tu spusta desktop instalater sa GitHub Release-a
const downloadsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../downloads");
export const desktopSetupPath = join(downloadsDir, "albatron-setup.exe");
const desktopSigPath = desktopSetupPath + ".sig";

export function desktopDostupan() {
  return existsSync(desktopSetupPath);
}

// Bez autentifikacije - potrebno pre logina (download link i Tauri updater)
export async function downloadRoutes(app: FastifyInstance) {
  app.get("/download/albatron-setup.exe", async (req, reply) => {
    if (!desktopDostupan()) {
      return reply.code(404).send({ error: "Instalacija nije dostupna" });
    }
    return reply
      .type("application/octet-stream")
      .header("Content-Disposition", 'attachment; filename="albatron-setup.exe"')
      .send(createReadStream(desktopSetupPath));
  });

  // Tauri updater manifest - generise se dinamicki da URL prati adresu servera
  app.get("/updates/latest.json", async (req, reply) => {
    if (!desktopDostupan() || !existsSync(desktopSigPath)) {
      return reply.code(404).send({ error: "Azuriranje nije dostupno" });
    }
    return {
      version: appVersion,
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(desktopSigPath, "utf8").trim(),
          url: `${req.protocol}://${req.headers.host}/download/albatron-setup.exe`,
        },
      },
    };
  });
}
