/**
 * QR code for a business — its "storefront sign". Scanning the code opens the
 * business page directly, so an owner can print it and stick it on the counter,
 * and anyone can share the link from here. The encoded URL comes from
 * expo-linking, so it's always right for where the app is running (web URL on
 * web, localo:// deep link in the installed app).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import QRCode from 'react-native-qrcode-svg';
import { getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { shareText, type ShareOutcome } from '@/lib/share';
import {
  Button,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function BusinessQrScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) {
    return <EmptyView title="Not found" subtitle="This listing may have been removed." />;
  }

  const type = getType(business.type);
  const url = Linking.createURL(`/business/${business.id}`);

  const onShare = async () => {
    const result = await shareText(
      `${type?.icon ?? '🏬'} ${business.name} on One Place\n${url}`,
      business.name,
    );
    setOutcome(result);
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'QR code' }} />

      <View style={styles.center}>
        <Text style={styles.icon}>{type?.icon ?? '🏬'}</Text>
        <Text variant="title" weight="bold" style={styles.name}>
          {business.name}
        </Text>
        {business.tagline ? (
          <Text tone="muted" style={styles.tagline}>
            {business.tagline}
          </Text>
        ) : null}

        {/* Always black-on-white — scanners need the contrast in any theme. */}
        <View style={styles.qrCard}>
          <QRCode value={url} size={240} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        <Text variant="caption" tone="muted" style={styles.url} selectable>
          {url}
        </Text>

        <Text variant="caption" tone="muted" style={styles.hint}>
          Scan with any phone camera to open this page. Print it and put it up at
          the counter, on flyers, or on packaging.
        </Text>

        <Button title="📤 Share link" onPress={onShare} style={styles.shareBtn} />
        {outcome === 'copied' ? (
          <Text variant="caption" tone="brand" style={styles.feedback}>
            Link copied to clipboard
          </Text>
        ) : null}
        {outcome === 'shared' ? (
          <Text variant="caption" tone="brand" style={styles.feedback}>
            Shared!
          </Text>
        ) : null}
        {outcome === 'failed' ? (
          <Text variant="caption" tone="muted" style={styles.feedback}>
            Couldn’t share — copy the link above instead.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: spacing.lg },
  icon: { fontSize: 44, marginBottom: spacing.sm },
  name: { textAlign: 'center', marginBottom: spacing.xs },
  tagline: { textAlign: 'center', marginBottom: spacing.md },
  qrCard: {
    backgroundColor: '#FFFFFF',
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    // Soft edge so the white card reads on the white theme too.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#00000022',
  },
  url: { textAlign: 'center', marginBottom: spacing.md },
  hint: { textAlign: 'center', marginBottom: spacing.lg, maxWidth: 320 },
  shareBtn: { alignSelf: 'stretch' },
  feedback: { marginTop: spacing.sm },
});
