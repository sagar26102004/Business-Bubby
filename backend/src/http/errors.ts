/**
 * Typed HTTP errors. Services throw these (or plain Error) and the error
 * middleware maps them to a JSON `{ error: message }` response with the right
 * status. A plain Error becomes 400 — the mock throws Errors for business-rule
 * violations (e.g. "This order was already responded to."), which are client
 * faults, so 400 is the faithful default.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Not signed in.') => new HttpError(401, m);
export const forbidden = (m = 'You do not have access to this.') => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
