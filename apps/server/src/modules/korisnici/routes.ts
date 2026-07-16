import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ADMIN_ROLE, RESOURCES, partialUpdate } from "@albatron/shared";
import { db, schema } from "../../db/index.js";
import { hashPassword } from "../auth/password.js";
import { requireAdmin, requirePrivilege } from "../auth/guard.js";

const privilegeEntry = z.object({
  resource: z.enum(RESOURCES),
  level: z.enum(["read", "write"]),
});

const createUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6, "Lozinka mora imati bar 6 karaktera"),
  fullName: z.string().min(1),
  // vise grupa po korisniku (faza 16, RP6); clanstvo u grupi "admin" = administrator
  roleIds: z.array(z.number()).default([]),
  privileges: z.array(privilegeEntry).default([]),
});

const updateUserSchema = partialUpdate(createUserSchema).extend({
  password: z.string().min(6).optional(),
  active: z.boolean().optional(),
});

const roleSchema = z.object({
  name: z.string().min(1),
  privileges: z.array(privilegeEntry).default([]),
});

function sanitizeUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function usersRoutes(app: FastifyInstance) {
  // --- Korisnici (samo admin) ---

  app.get("/api/korisnici", { preHandler: requireAdmin }, async () => {
    const users = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        isAdmin: schema.users.isAdmin,
        active: schema.users.active,
      })
      .from(schema.users);
    const clanstva = await db.select().from(schema.userRoles);
    return users.map((u) => ({
      ...u,
      roleIds: clanstva.filter((c) => c.userId === u.id).map((c) => c.roleId),
    }));
  });

  app.post("/api/korisnici", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { password, privileges, roleIds, ...data } = parsed.data;

    const [user] = await db
      .insert(schema.users)
      .values({ ...data, passwordHash: hashPassword(password) })
      .returning();
    if (roleIds.length && user) {
      await db.insert(schema.userRoles).values(roleIds.map((roleId) => ({ userId: user.id, roleId })));
    }
    if (privileges.length && user) {
      await db
        .insert(schema.privileges)
        .values(privileges.map((p) => ({ ...p, userId: user.id })));
    }
    return reply.code(201).send(user && sanitizeUser(user));
  });

  app.put("/api/korisnici/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { password, privileges, roleIds, ...data } = parsed.data;

    const values: Record<string, unknown> = { ...data };
    if (password) values.passwordHash = hashPassword(password);
    const [user] = await db
      .update(schema.users)
      .set(values)
      .where(eq(schema.users.id, id))
      .returning();
    if (!user) return reply.code(404).send({ error: "Korisnik ne postoji" });

    if (roleIds) {
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      if (roleIds.length) {
        await db.insert(schema.userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId })));
      }
    }
    if (privileges) {
      await db.delete(schema.privileges).where(eq(schema.privileges.userId, id));
      if (privileges.length) {
        await db
          .insert(schema.privileges)
          .values(privileges.map((p) => ({ ...p, userId: id })));
      }
    }
    return sanitizeUser(user);
  });

  // --- Role (samo admin) ---

  app.get("/api/role", { preHandler: requireAdmin }, async () => {
    const roles = await db.select().from(schema.roles);
    const privs = await db.select().from(schema.privileges);
    return roles.map((r) => ({
      ...r,
      privileges: privs
        .filter((p) => p.roleId === r.id)
        .map((p) => ({ resource: p.resource, level: p.level })),
    }));
  });

  app.post("/api/role", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [role] = await db
      .insert(schema.roles)
      .values({ name: parsed.data.name })
      .returning();
    if (parsed.data.privileges.length && role) {
      await db
        .insert(schema.privileges)
        .values(parsed.data.privileges.map((p) => ({ ...p, roleId: role.id })));
    }
    return reply.code(201).send(role);
  });

  app.put("/api/role/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = roleSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    // sistemska grupa "admin" je fiksna (faza 16, RP6)
    const [postojeca] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    if (postojeca?.name === ADMIN_ROLE) {
      return reply.code(400).send({ error: "Grupa 'admin' je sistemska i ne menja se" });
    }
    if (parsed.data.name) {
      const [role] = await db.update(schema.roles).set({ name: parsed.data.name }).where(eq(schema.roles.id, id)).returning();
      if (!role) return reply.code(404).send({ error: "Rola ne postoji" });
    }
    if (parsed.data.privileges) {
      await db.delete(schema.privileges).where(eq(schema.privileges.roleId, id));
      if (parsed.data.privileges.length) {
        await db.insert(schema.privileges).values(parsed.data.privileges.map((p) => ({ ...p, roleId: id })));
      }
    }
    return { ok: true };
  });

  app.delete("/api/role/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [postojeca] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    if (postojeca?.name === ADMIN_ROLE) {
      return reply.code(400).send({ error: "Grupa 'admin' je sistemska i ne brise se" });
    }
    const clanovi = await db.select({ id: schema.userRoles.id }).from(schema.userRoles).where(eq(schema.userRoles.roleId, id));
    if (clanovi.length > 0) {
      return reply.code(400).send({ error: "Grupa je dodeljena korisnicima - prvo im promenite grupu" });
    }
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
    return { ok: true };
  });

  // --- Test ruta za proveru privilegija (kriterijum zavrsetka faze 1) ---

  app.get(
    "/api/test-privilegija",
    { preHandler: requirePrivilege("podesavanja", "read") },
    async () => ({ ok: true, poruka: "Imate read privilegiju na podesavanja" }),
  );
}
