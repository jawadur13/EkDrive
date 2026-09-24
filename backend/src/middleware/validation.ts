import { z } from 'zod';
import { validationError } from '../utils/errors';

export async function parseBody<T extends z.ZodTypeAny>(c: any, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}
