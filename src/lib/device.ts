/**
 * This install's identity — a name for "the device the app is running on".
 *
 * Used by the single-device rule (one account, one signed-in device): the
 * account's claim in `active_devices` records the id below, and a device that
 * reads back an id that is not its own knows it has been signed out elsewhere.
 *
 * IT IS NOT A HARDWARE ID, ON PURPOSE. We never ask for one, and neither
 * Android nor iOS hands an app a stable per-handset identifier any more — they
 * are exactly the kind of value that turns into cross-app tracking. A random
 * uuid, minted once and kept in this app's own storage, answers the only
 * question we actually have ("is this the same install that signed in?").
 *
 * The consequence is worth stating: clearing the app's storage, reinstalling,
 * or opening the web app in a private window all read as a NEW device. That is
 * the honest answer — such an install can no longer prove it was the one
 * holding the account — and it costs the person nothing but signing in again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'localo.deviceId';

/** Minted at most once per process; the read is a storage hit, not free. */
let cached: string | null = null;
/** So two callers racing at startup can't mint two different ids. */
let pending: Promise<string> | null = null;

/**
 * The uuid for this install, minted on first use.
 *
 * Never throws. If storage is unavailable (a browser with site data blocked is
 * the realistic case) the id lives for the lifetime of the process instead —
 * the app keeps working, and the only cost is that this session looks like a
 * new device the next time it starts.
 */
export function getDeviceId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    try {
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (stored) return stored;
    } catch {
      // Fall through and mint a process-lifetime id.
    }
    const minted = randomId();
    try {
      await AsyncStorage.setItem(DEVICE_ID_KEY, minted);
    } catch {
      // Unwritable storage — see the note above.
    }
    return minted;
  })()
    .then((id) => {
      cached = id;
      return id;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * How this device is described to its owner — "Android phone", "Web browser".
 *
 * Kept deliberately vague. It appears in "you were signed out because your
 * account was used on ‹label›", where the point is to tell an owner apart from
 * an intruder, not to profile the handset.
 */
export function describeThisDevice(): string {
  switch (Platform.OS) {
    case 'android':
      return 'an Android phone';
    case 'ios':
      return 'an iPhone';
    case 'web':
      return 'a web browser';
    default:
      return 'another device';
  }
}

/** RFC-4122 v4 shape. Uniqueness is all this needs — it is not a secret. */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
