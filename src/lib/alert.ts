/**
 * A dialog that actually appears on every platform.
 *
 * React Native Web ships `Alert` as an EMPTY FUNCTION — `class Alert { static
 * alert() {} }`. So every `Alert.alert('Could not order', …)` in the app was
 * silent in the web preview: a failed write looked exactly like a dead button,
 * with nothing in the console either. That cost a real debugging session (a
 * guest order was being refused by RLS and the app said nothing at all).
 *
 * `showAlert` is a drop-in replacement with the same signature:
 *  - native: straight through to React Native's `Alert`
 *  - web: `window.alert` for a message, `window.confirm` for a two-button
 *    choice (the non-cancel button's `onPress` runs on OK).
 *
 * Where a screen wants nicer feedback it should still render inline UI
 * (sign-in, register and saved-places already do); this is the floor, not the
 * ceiling.
 */
import { Alert as RNAlert, Platform } from 'react-native';

export interface AlertButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons);
    return;
  }

  const body = message ? `${title}\n\n${message}` : title;
  // A single button (or none) is just an acknowledgement — no choice to make.
  const choices = buttons?.filter((b) => b.style !== 'cancel') ?? [];
  if (!buttons || buttons.length < 2 || choices.length === 0) {
    if (typeof window !== 'undefined') window.alert(body);
    buttons?.[0]?.onPress?.();
    return;
  }

  // Two-way choice: OK runs the action, Cancel runs the cancel button's
  // handler (usually nothing). Anything beyond two buttons collapses to the
  // first real action — no screen needs more than that today.
  const confirmed = typeof window !== 'undefined' ? window.confirm(body) : false;
  const cancel = buttons.find((b) => b.style === 'cancel');
  if (confirmed) choices[0].onPress?.();
  else cancel?.onPress?.();
}
