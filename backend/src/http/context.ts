/**
 * Request context + auth middleware.
 *
 * `optionalAuth` attaches the signed-in user when a valid Bearer token is
 * present (guests are allowed through — the app browses as a guest).
 * `requireAuth` rejects anonymous callers. Controllers read `req.auth`.
 */
import type { NextFunction, Request, Response } from 'express';
import { bearerFrom, verifyToken, type AuthedUser } from '@/auth/verify';
import { HttpError, unauthorized } from './errors';

export interface AuthedRequest extends Request {
  auth: AuthedUser | null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerFrom(req.header('authorization'));
  (req as AuthedRequest).auth = null;
  if (token) {
    try {
      (req as AuthedRequest).auth = verifyToken(token);
    } catch {
      // An invalid/expired token on an optional-auth route is treated as a guest.
      (req as AuthedRequest).auth = null;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerFrom(req.header('authorization'));
  if (!token) return next(unauthorized());
  try {
    (req as AuthedRequest).auth = verifyToken(token);
    next();
  } catch (err) {
    next(err instanceof HttpError ? err : unauthorized());
  }
}

/** The signed-in user's id, or throw 401. */
export function userId(req: Request): string {
  const auth = (req as AuthedRequest).auth;
  if (!auth) throw unauthorized();
  return auth.id;
}

/** The signed-in user's id, or null for a guest. */
export function optionalUserId(req: Request): string | null {
  return (req as AuthedRequest).auth?.id ?? null;
}
