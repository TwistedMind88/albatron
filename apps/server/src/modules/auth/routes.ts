import type { FastifyInstance } from "fastify";
import { loginSchema } from "@albatron/shared";
import { appVersion } from "../../version.js";
import { desktopDostupan } from "../download/routes.js";
import { requestToken } from "./guard.js";
import { verifyPassword } from "./password.js";
import {
  createSession,
  destroySession,
  findUserByUsername,
  getSessionUser,
} from "./service.js";

export const SESSION_COOKIE = "albatron_session";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Neispravan zahtev" });
    }
    const user = await findUserByUsername(parsed.data.username);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Pogresno korisnicko ime ili lozinka" });
    }
    const token = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    // token i u telu odgovora - Tauri/remote klijent ga salje kao Bearer (stavke 21-23)
    const sessionUser = await getSessionUser(token);
    return { ...sessionUser, token };
  });

  // Bez auth - "Test" veze na login ekranu (stavke 21-23): provera dostupnosti + lista baza.
  // ponytail: server hostuje jednu bazu (DATABASE_URL); vise baza = vise sacuvanih sesija
  app.get("/api/server-info", async () => {
    let baza = "albatron";
    try {
      baza = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1) || baza;
    } catch {
      // DATABASE_URL nije URL format - ostaje podrazumevano ime
    }
    return {
      ok: true,
      app: "albatron",
      baze: [baza],
      version: appVersion,
      desktopDostupan: desktopDostupan(),
    };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = requestToken(req);
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const token = requestToken(req);
    const user = token ? await getSessionUser(token) : null;
    if (!user) return reply.code(401).send({ error: "Niste prijavljeni" });
    return user;
  });
}
