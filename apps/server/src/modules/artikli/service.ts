import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";

// Sledeci sestocifreni ident (brief 5.1)
export async function nextIdent(): Promise<string> {
  const [row] = await db
    .select({ max: sql<string | null>`max(${schema.articles.ident})` })
    .from(schema.articles);
  const next = (row?.max ? parseInt(row.max, 10) : 0) + 1;
  return String(next).padStart(6, "0");
}

// Upis izmena u audit log (plan 4.9) - poredi staro i novo stanje po poljima
export async function logChanges(
  entity: string,
  entityId: number,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>,
  userId: number | null,
) {
  const entries = [];
  for (const key of Object.keys(newRow)) {
    if (key === "id" || key === "createdAt") continue;
    const oldV = oldRow[key];
    const newV = newRow[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
    if (norm(oldV) !== norm(newV)) {
      entries.push({
        entity,
        entityId,
        field: key,
        oldValue: norm(oldV),
        newValue: norm(newV),
        userId,
      });
    }
  }
  if (entries.length) await db.insert(schema.auditLog).values(entries);
  return entries.length;
}

export async function getIstorija(entity: string, entityId: number) {
  return db
    .select({
      field: schema.auditLog.field,
      oldValue: schema.auditLog.oldValue,
      newValue: schema.auditLog.newValue,
      createdAt: schema.auditLog.createdAt,
      user: schema.users.fullName,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
    .where(sql`${schema.auditLog.entity} = ${entity} and ${schema.auditLog.entityId} = ${entityId}`)
    .orderBy(desc(schema.auditLog.createdAt));
}
