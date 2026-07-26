/**
 * Autosave for the "list your business" wizard.
 *
 * The register flow is long, and an accidental back-tap or navigation-away used
 * to wipe every answer. We snapshot the in-progress form to AsyncStorage (which
 * is localStorage on web) so the next visit can pick up exactly where it left
 * off. One draft at a time — the newest snapshot wins; publishing clears it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'localo:register-draft/v1';

/** Read the saved draft, or null when there isn't one (or it's unreadable). */
export async function loadRegisterDraft<T>(): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Persist the current form snapshot. Best-effort — never throws. */
export async function saveRegisterDraft<T>(snapshot: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* a full/again-unavailable store just means no autosave this time */
  }
}

/** Forget the draft — call on publish or when the user chooses to start over. */
export async function clearRegisterDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
