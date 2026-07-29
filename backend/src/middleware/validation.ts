import { z } from 'zod';

export const validateRequest = (schema: z.ZodSchema) => {
  return async (c: any, next: any) => {
    try {
      const body = await c.req.json();
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 422);
      }
      c.set('validatedBody', parsed.data);
      await next();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
    }
  };
};