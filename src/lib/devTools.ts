/**
 * Dev Tools visibility flag.
 *
 * Dev Tools (`app/dev.tsx`) is a TESTING HARNESS, not product: it lists every
 * user, switches identity with the shared seed password, and creates real
 * accounts/businesses on whichever backend is configured. It must never be
 * reachable by a real user.
 *
 * The rule, in order of authority:
 *
 *   1. Production build (`__DEV__ === false`, i.e. `expo export` / EAS build)
 *      -> ALWAYS off. `EXPO_PUBLIC_DEV_TOOLS=true` cannot override this, so a
 *         stale `.env` can't leak the harness into a release. Metro inlines
 *         `__DEV__` as a literal, so the whole flag folds to `false` at build
 *         time — it isn't a runtime check someone can flip.
 *   2. Dev server, `EXPO_PUBLIC_DEV_TOOLS=false` -> off (lets you rehearse
 *      exactly what customers will see without making a production build).
 *   3. Dev server, anything else/unset -> on.
 *
 * EXPO_PUBLIC_* vars are read at BUILD time, so restart the dev server after
 * editing `.env`.
 */
const flag = (process.env.EXPO_PUBLIC_DEV_TOOLS ?? '').trim().toLowerCase();

export const DEV_TOOLS_ENABLED = __DEV__ && flag !== 'false';
