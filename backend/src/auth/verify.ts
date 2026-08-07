/**
 * Supabase JWT verification.
 *
 * The app signs in via Supabase (email+password over the synthetic phone email)
 * and sends the resulting access token as `Authorization: Bearer <jwt>`. Supabase
 * access tokens are HS256-signed with the project's JWT secret; we verify with
 * that secret and read the user id from the `sub` claim.
 *
 * ANONYMOUS sessions (guests placing a voice call or chatting) are ordinary
 * tokens with a real uuid `sub` plus an `is_anonymous` claim — they verify the
 * same way and are deliberately accepted here. Every guard downstream keys on
 * the uid alone, so a guest is just a user with no profile name.
 */
import jwt from 'jsonwebtoken';
import { config } from '@/config';
import { unauthorized } from '@/http/errors';

export interface AuthedUser {
  id: string;
  email?: string;
  phone?: string;
}

/** Verify a Bearer token and return the user, or throw 401. */
export function verifyToken(token: string): AuthedUser {
  if (!config.jwtSecret) {
    throw unauthorized('Server auth is not configured (SUPABASE_JWT_SECRET missing).');
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    const id = payload.sub;
    if (!id || typeof id !== 'string') throw new Error('no sub');
    return {
      id,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
    };
  } catch {
    throw unauthorized('Your session has expired — sign in again.');
  }
}

/** Pull the Bearer token out of an Authorization header, if present. */
export function bearerFrom(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
