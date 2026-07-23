/**
 * The HTTP client for the Node/Express backend (Path B).
 *
 * Every request carries the Supabase access token as `Authorization: Bearer …`
 * (the backend verifies it and resolves the user). The base URL comes from
 * `EXPO_PUBLIC_API_URL`; the API is mounted under `/api` on the server.
 */
import { getSupabase } from '@/lib/supabase';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
/** True once an API url is configured — DataProvider needs both this and Supabase. */
export const isApiConfigured = Boolean(RAW_URL);

const API_ROOT = `${RAW_URL.replace(/\/$/, '')}/api`;

/** The current Supabase access token, or null when signed out. */
async function accessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  if (!isApiConfigured) {
    throw new Error('EXPO_PUBLIC_API_URL is not set — the API backend is not configured.');
  }
  const token = await accessToken();
  const res = await fetch(`${API_ROOT}${withQuery(path, query)}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = payload?.error ?? `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Path-segment encoder (ids can contain ':' for guests / sentinels). */
export const seg = (s: string) => encodeURIComponent(s);
