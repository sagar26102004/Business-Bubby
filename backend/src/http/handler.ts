/** Async route wrapper + the central error handler. */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors';

type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;

/** Wrap an async controller so thrown/rejected errors reach the error handler. */
export const route =
  (fn: AsyncRoute) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res)
      .then((body) => {
        if (!res.headersSent) res.json(body ?? {});
      })
      .catch(next);
  };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  // Business-rule violations from the services are plain Errors → 400.
  res.status(400).json({ error: message });
}
