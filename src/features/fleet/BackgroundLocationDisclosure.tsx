/**
 * The prominent in-app disclosure that MUST be shown before Localo asks the OS
 * for background location.
 *
 * ⚠️ THIS IS A STORE REQUIREMENT, NOT A UX NICETY. Google Play's Location
 * Permissions policy requires an in-app disclosure, shown BEFORE the system
 * permission dialog, that names the data, names the feature it powers, and says
 * in plain words that collection continues while the app is closed. Shipping
 * the OS prompt on its own is the single most common cause of a multi-week
 * review loop, and reviewers check it against the demo video frame by frame.
 *
 * Three rules the wording below is built around, all of them things Play has
 * rejected apps for getting wrong:
 *   1. It must appear BEFORE the OS dialog, not alongside or after it.
 *   2. It must contain language to the effect of "even when the app is closed
 *      or not in use" — reviewers look for that specific idea.
 *   3. Declining must be a real choice that does something different. Ours
 *      leaves foreground-only sharing running and never asks the OS anything.
 *
 * The exact copy is mirrored in docs/play-store/background-location-disclosure.md
 * because the identical text has to be pasted into the Play Console permission
 * declaration form. CHANGE ONE AND YOU MUST CHANGE THE OTHER — a disclosure
 * that doesn't match what was declared is treated as no disclosure at all.
 *
 * Only ever shown for the BACKGROUND step. Foreground GPS — the distance
 * sorting every screen in the app uses — needs no disclosure and gets none;
 * `startBackgroundShare` calls in here only once foreground is already granted
 * and it is genuinely about to ask for the always-on permission.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface BackgroundLocationDisclosureProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function BackgroundLocationDisclosure({
  visible,
  onAccept,
  onDecline,
}: BackgroundLocationDisclosureProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back must resolve the choice rather than leave the
      // caller waiting on a promise nobody will ever settle. Backing out is a
      // decline — the safe direction, since it asks the OS for nothing.
      onRequestClose={onDecline}
    >
      {/*
        Deliberately NOT dismissible by tapping the backdrop. Every other sheet
        in the app is, but this one records a decision about personal data, and
        a stray tap outside is not a decision.
      */}
      <View style={[styles.backdrop, { backgroundColor: colors.text + 'AA' }]}>
        <Card style={styles.sheet}>
          <Text variant="subheading" weight="bold">
            📡 Share your location in the background?
          </Text>

          <Text style={styles.para}>
            One Place collects location data to show your vehicle moving on the
            live map — to the owner of the business you drive for, and to the
            customers whose children or goods are aboard.
          </Text>

          {/*
            The sentence Play looks for. Kept in its own emphasised block so a
            reviewer watching the demo video can read it at a glance.
          */}
          <View style={[styles.highlight, { backgroundColor: colors.brandSoft }]}>
            <Text weight="semibold">
              This collects location data even when the app is closed or not in
              use, so your vehicle keeps moving on their map while you drive
              with your phone locked or in your pocket.
            </Text>
          </View>

          <Text style={styles.para}>
            It only happens while you have “Share my live location” switched on
            for this business, and it stops the moment you switch it off or
            finish your shift.
          </Text>

          <Text style={styles.para} tone="muted" variant="caption">
            If you say no, nothing else changes: you can still share your live
            location while One Place is open on screen, and you can turn this on
            later from the same switch.
          </Text>

          <Button
            title="Allow background location"
            onPress={onAccept}
            style={styles.button}
          />
          <Button
            title="No — only while the app is open"
            variant="secondary"
            onPress={onDecline}
            style={styles.button}
          />
        </Card>
      </View>
    </Modal>
  );
}

/**
 * Drives the dialog as a PROMISE, so the permission sequence reads top to
 * bottom instead of being scattered across callbacks.
 *
 * `confirm` is handed straight to `startBackgroundShare`, which awaits it at
 * exactly the right moment — after foreground is granted, before the OS
 * background prompt. The screen's only job is to render `<BackgroundLocation
 * Disclosure {...disclosureProps} />` somewhere in its tree.
 */
export function useBackgroundLocationDisclosure() {
  const [visible, setVisible] = useState(false);
  // The half-finished promise. A ref rather than state because resolving it is
  // an effect on the outside world, not something the UI renders.
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  const settle = useCallback((accepted: boolean) => {
    resolveRef.current?.(accepted);
    resolveRef.current = null;
    setVisible(false);
  }, []);

  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setVisible(true);
      }),
    [],
  );

  // Navigating away mid-question must not strand the awaiting caller: an
  // unresolved promise here would leave the driver's toggle spinning forever.
  useEffect(
    () => () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    },
    [],
  );

  return {
    confirm,
    disclosureProps: {
      visible,
      onAccept: () => settle(true),
      onDecline: () => settle(false),
    } satisfies BackgroundLocationDisclosureProps,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  // Card brings its own padding. The cap keeps the dialog a dialog on a desktop
  // browser rather than a full-width wall of text.
  sheet: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  para: { marginTop: spacing.md },
  highlight: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  button: { marginTop: spacing.md },
});
