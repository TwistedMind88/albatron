import type { FastifyReply, FastifyRequest } from "fastify";
import type { Resource, SessionUser } from "@albatron/shared";
import { SESSION_COOKIE } from "./routes.js";
import { getSessionUser } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

// Cookie za web (isti origin); Bearer token za Tauri/remote (stavke 21-23) jer
// cross-origin cookie preko plain HTTP ne prolazi (SameSite=None trazi Secure).
// ponytail: ?t= token za <img>/<a> ka API fajlovima u remote rezimu (ne mogu header);
// ako zatreba strozije - kratkotrajni potpisani URL samo na fajl rutama
// ?t= vazi SAMO na GET fajl rutama (img/href ne mogu header); u logovima se rediguje
const FAJL_RUTA = /^\/api\/(fajlovi|projekti\/fajlovi|uputstva)\/\d+/;

export function requestToken(req: FastifyRequest) {
  const auth = req.headers.authorization;
  const queryToken =
    req.method === "GET" && FAJL_RUTA.test(req.url) ? (req.query as { t?: string } | null)?.t : undefined;
  return req.cookies[SESSION_COOKIE] ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : queryToken);
}

export async function attachUser(req: FastifyRequest) {
  const token = requestToken(req);
  req.user = token ? await getSessionUser(token) : null;
}

// preHandler fabrika: provera privilegije na resursu.
// Admin ima sve; write podrazumeva read.
export function requirePrivilege(resource: Resource, level: "read" | "write") {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    if (req.user.isAdmin) return;
    const has = req.user.privileges[resource];
    const ok = has === "write" || (level === "read" && has === "read");
    if (!ok) return reply.code(403).send({ error: "Nemate privilegiju za ovu akciju" });
  };
}

// bar jedan od navedenih resursa na trazenom nivou (npr. bilo koji tip dokumenta).
// ponytail: gruba provera za zajednicke dokument-rute; provera po konkretnom tipu
// dokumenta unutar handlera dolazi uz stavku 2-4 (moduli) ako se pokaze potrebnom.
export function requireAnyPrivilege(resources: Resource[], level: "read" | "write") {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
    if (req.user.isAdmin) return;
    const ok = resources.some((r) => {
      const has = req.user!.privileges[r];
      return has === "write" || (level === "read" && has === "read");
    });
    if (!ok) return reply.code(403).send({ error: "Nemate privilegiju za ovu akciju" });
  };
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: "Niste prijavljeni" });
  if (!req.user.isAdmin) return reply.code(403).send({ error: "Samo administrator" });
}
