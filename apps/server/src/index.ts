import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { authRoutes } from "./modules/auth/routes.js";
import { attachUser } from "./modules/auth/guard.js";
import { usersRoutes } from "./modules/korisnici/routes.js";
import { podesavanjaRoutes } from "./modules/podesavanja/routes.js";
import { listeRoutes } from "./modules/podesavanja/liste.js";
import { kategorijeRoutes } from "./modules/podesavanja/kategorije.js";
import { rfqSablonRoutes } from "./modules/podesavanja/rfqSablon.js";
import { subjektiRoutes } from "./modules/subjekti/routes.js";
import { artikliRoutes } from "./modules/artikli/routes.js";
import { cenovniciRoutes } from "./modules/cenovnici/routes.js";
import { dokumentiRoutes } from "./modules/dokumenti/routes.js";
import { nabavkaRoutes } from "./modules/dokumenti/nabavka.js";
import { prodajaRoutes } from "./modules/dokumenti/prodaja.js";
import { izvestajiRoutes } from "./modules/izvestaji/routes.js";
import { zaliheRoutes } from "./modules/zalihe/routes.js";
import { popisiRoutes } from "./modules/zalihe/popisi.js";
import { presifriranjaRoutes } from "./modules/zalihe/presifriranja.js";
import { obracuniRoutes } from "./modules/obracuni/routes.js";
import { uplateRoutes } from "./modules/uplate/routes.js";
import { projektiRoutes } from "./modules/projekti/routes.js";
import { zadaciRoutes } from "./modules/zadaci/routes.js";
import { obavestenjaRoutes } from "./modules/obavestenja/routes.js";
import { downloadRoutes } from "./modules/download/routes.js";
import { cleanExpiredSessions, cleanOldAuditLog } from "./modules/auth/service.js";

// trustProxy: ispravan req.ip/protocol iza proxyja (Cloudflare i sl., stavke 21-23)
const app = Fastify({
  trustProxy: true,
  logger: {
    serializers: {
      // ?t= sesijski token (fajl rute) ne sme u logove
      req: (req) => ({ method: req.method, url: req.url.replace(/([?&]t=)[^&]+/, "$1***") }),
    },
  },
});

// Cross-origin pristup iz Tauri/remote klijenta (stavke 21-23) ide iskljucivo preko Bearer
// tokena - credentials:false da cookie sesija ne bude upotrebljiva sa tudjih origina
await app.register(import("@fastify/cors"), { origin: true, credentials: false });
await app.register(cookie, { secret: process.env.SESSION_COOKIE_SECRET });
await app.register(import("@fastify/multipart"), { limits: { fileSize: 50 * 1024 * 1024 } });

app.addHook("preHandler", attachUser);

await app.register(authRoutes);
await app.register(usersRoutes);
await app.register(podesavanjaRoutes);
await app.register(listeRoutes);
await app.register(kategorijeRoutes);
await app.register(rfqSablonRoutes);
await app.register(subjektiRoutes);
await app.register(artikliRoutes);
await app.register(cenovniciRoutes);
await app.register(dokumentiRoutes);
await app.register(nabavkaRoutes);
await app.register(prodajaRoutes);
await app.register(izvestajiRoutes);
await app.register(zaliheRoutes);
await app.register(popisiRoutes);
await app.register(presifriranjaRoutes);
await app.register(obracuniRoutes);
await app.register(uplateRoutes);
await app.register(projektiRoutes);
await app.register(zadaciRoutes);
await app.register(obavestenjaRoutes);
await app.register(downloadRoutes);

app.get("/api/health", async () => ({ ok: true }));

// Produkcija: isti proces servira i frontend build (plan, sekcija 6)
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: sve van /api vraca index.html
    if (req.url.startsWith("/api")) return reply.code(404).send({ error: "Ne postoji" });
    return reply.sendFile("index.html");
  });
}

// RP7: ciscenje audit loga (60 dana) i isteklih sesija - pri startu i na svaka 24h
async function ocistiAuditLog() {
  try {
    const n = await cleanOldAuditLog();
    if (n > 0) app.log.info(`Audit log: obrisano ${n} redova starijih od 60 dana`);
    await cleanExpiredSessions();
  } catch (err) {
    app.log.error(err, "ciscenje audit loga neuspesno");
  }
}
await ocistiAuditLog();
setInterval(() => void ocistiAuditLog(), 24 * 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
