/** Runtime configuration, loaded from the environment (.env in dev). */
import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  /**
   * Live voice audio (LiveKit). Optional: when unset the token endpoint answers
   * 501 and the app falls back to its simulated call UI — everything else runs.
   */
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
};

/** True when all three LIVEKIT_* vars are present. */
export const isLivekitConfigured = (): boolean =>
  !!config.livekitUrl && !!config.livekitApiKey && !!config.livekitApiSecret;

/** Fail fast in production if the essentials are missing. */
export function assertConfig(): void {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.jwtSecret) missing.push('SUPABASE_JWT_SECRET');
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[localo-backend] Missing env: ${missing.join(', ')}. ` +
        `Set them in backend/.env (see .env.example). Auth/DB calls will fail until then.`,
    );
  }
}
