/**
 * "Your website" — the business's free public page on the One Place website
 * (`lib/website.ts`), with Share and Open. Lives in the Workspace hub so an
 * owner can put the link on WhatsApp, Instagram, Google Maps or a visiting card
 * without hunting for it.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, IconTile, Text } from '@/components/ui';
import { businessWebsiteUrl, openBusinessWebsite, shareBusinessWebsite } from '@/lib/website';
import { spacing } from '@/theme/theme';

export function ShareWebsiteCard({ business }: { business: { id: string; name: string } }) {
  const [note, setNote] = useState<string | null>(null);
  const url = businessWebsiteUrl(business.id);

  async function share() {
    const outcome = await shareBusinessWebsite(business);
    setNote(
      outcome === 'copied'
        ? 'Link copied — paste it anywhere.'
        : outcome === 'failed'
          ? `Couldn’t open sharing. Your link: ${url}`
          : null,
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <IconTile icon="explore" />
        <View style={styles.flex}>
          <Text weight="bold">Your website</Text>
          <Text variant="caption" tone="muted">
            A free web page for {business.name} — menu, prices, photos, reviews and map. Anyone can
            open it, no app needed.
          </Text>
        </View>
      </View>
      <Text variant="caption" tone="brand" numberOfLines={1} selectable style={styles.url}>
        {url.replace(/^https:\/\//, '')}
      </Text>
      <View style={styles.actions}>
        <Button title="Share my website" icon="share" size="sm" onPress={share} style={styles.flex} />
        <Button
          title="Open"
          variant="outline"
          size="sm"
          onPress={() => openBusinessWebsite(business.id)}
        />
      </View>
      {note ? (
        <Text variant="caption" tone="muted" selectable style={styles.note}>
          {note}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  url: { marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  note: { marginTop: spacing.sm },
});
