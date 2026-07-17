import { randomBytes } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { ADMIN_ROLE, type SessionUser } from "@albatron/shared";
import { db, schema } from "../../db/index.js";

// Sesija vazi do kraja tekuceg dana (prijava jednom dnevno), ali najmanje 8h od
// prijave da vecernja prijava ne istekne usred rada
function sessionExpiresAt(): Date {
  const krajDana = new Date();
  krajDana.setHours(23, 59, 59, 999);
  const min8h = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return krajDana > min8h ? krajDana : min8h;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(schema.sessions).values({
    token,
    userId,
    expiresAt: sessionExpiresAt(),
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      isAdmin: schema.users.isAdmin,
      active: schema.users.active,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.token, token));

  const row = rows[0];
  if (!row || !row.active || row.expiresAt < new Date()) return null;

  // grupe korisnika (faza 16, RP6): clanstvo u sistemskoj grupi "admin" = administrator
  const grupe = await db
    .select({ roleId: schema.userRoles.roleId, name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, row.userId));

  return {
    id: row.userId,
    username: row.username,
    fullName: row.fullName,
    isAdmin: row.isAdmin || grupe.some((g) => g.name === ADMIN_ROLE),
    privileges: await resolvePrivileges(
      row.userId,
      grupe.map((g) => g.roleId),
    ),
  };
}

// Grupe daju UNIJU privilegija (write jaci od read), individualni override po
// korisniku ima prioritet (faza 16, RP6)
async function resolvePrivileges(
  userId: number,
  roleIds: number[],
): Promise<Record<string, "read" | "write">> {
  const result: Record<string, "read" | "write"> = {};

  if (roleIds.length) {
    const roleRows = await db
      .select()
      .from(schema.privileges)
      .where(inArray(schema.privileges.roleId, roleIds));
    for (const p of roleRows) {
      if (result[p.resource] !== "write") result[p.resource] = p.level as "read" | "write";
    }
  }

  const userRows = await db
    .select()
    .from(schema.privileges)
    .where(eq(schema.privileges.userId, userId));
  for (const p of userRows) result[p.resource] = p.level as "read" | "write";

  return result;
}

export async function cleanExpiredSessions(): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

// RP7 (st.23): retencija audit loga 60 dana (ceo log, svi entiteti)
export async function cleanOldAuditLog(): Promise<number> {
  const prag = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const obrisani = await db.delete(schema.auditLog).where(lt(schema.auditLog.createdAt, prag)).returning({ id: schema.auditLog.id });
  return obrisani.length;
}

export async function findUserByUsername(username: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.username, username), eq(schema.users.active, true)));
  return rows[0] ?? null;
}
