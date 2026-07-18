/**
 * Share a piece of text through whatever the platform offers:
 *  - native: the system share sheet (WhatsApp, email, anything installed)
 *  - web: the Web Share API when available, else copy to the clipboard
 * Returns what actually happened so callers can show the right feedback.
 */
import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export async function shareText(message: string, title?: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & {
      share?: (data: { title?: string; text: string }) => Promise<void>;
      clipboard?: { writeText(text: string): Promise<void> };
    }) : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text: message });
        return 'shared';
      } catch {
        // User dismissed or share failed — fall back to the clipboard.
      }
    }
    if (nav?.clipboard?.writeText) {
      try {
        await nav.clipboard.writeText(message);
        return 'copied';
      } catch {
        return 'failed';
      }
    }
    return 'failed';
  }

  try {
    const result = await Share.share({ title, message });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}
