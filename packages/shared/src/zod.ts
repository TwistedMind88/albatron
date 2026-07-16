import { z } from "zod";

// Partial šema za PUT rute. Zod v4 .partial() i dalje primenjuje .default()
// na polja koja nisu poslata, pa bi delimičan update pregazio postojeće
// vrednosti default-ima. Ovde se default skida pre .optional().
type BezDefaulta<T> = T extends z.ZodDefault<infer U> ? U : T;

export function partialUpdate<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<BezDefaulta<T[K]>> }> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const inner = value instanceof z.ZodDefault ? (value.unwrap() as z.ZodTypeAny) : (value as z.ZodTypeAny);
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<BezDefaulta<T[K]>> }>;
}
