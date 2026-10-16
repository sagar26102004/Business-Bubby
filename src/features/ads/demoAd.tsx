/**
 * DEMO ADS — the sample offers on the bot… listings (`Business.demo`, made by
 * scripts/demo-listings.ts) are there to show owners what the Deals feed looks
 * like, not to be claimed. So wherever one is shown as an ad it is drained of
 * colour (`DEMO_AD_FILTER`) and carries this notice across its middle, and a
 * customer can tell at a glance it isn't a real offer.
 *
 * The filter is a View `filter` style: honoured on Android and web, ignored on
 * iOS — where the notice alone still says it.
 */
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui';
import { radius, spacing } from '@/theme/theme';

export const DEMO_AD_TEXT = 'It’s a demo ad — scroll to find an active offer';

/** Black and white. Put it on the View that holds the creative. */
export const DEMO_AD_FILTER: ViewStyle = { filter: 'grayscale(1)' };

export function isDemoAd(business: { demo?: boolean }): boolean {
  return business.demo === true;
}

/** The centered "this isn't real" banner, laid over the whole ad. */
export function DemoAdNotice({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.box, compact && styles.boxCompact]}>
        <Text
          variant={compact ? 'label' : 'subheading'}
          weight="bold"
          style={styles.text}
        >
          {DEMO_AD_TEXT}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  box: {
    maxWidth: 320,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  boxCompact: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // On a photo or video, never on the app's paper — so not a theme token.
  text: { color: '#FFFFFF', textAlign: 'center' },
});
