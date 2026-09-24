import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Thrown by services; app.onError turns it into the standard { error: { code, message } } body.
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const validationError = (message: string) => new HttpError(422, 'VALIDATION_ERROR', message);
