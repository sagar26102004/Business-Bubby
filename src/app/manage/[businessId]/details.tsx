/**
 * Name & details — how the listing introduces itself. The name customers
 * search for, the line under it, the paragraph on the page, and the photo
 * behind them all.
 *
 * A stall is a person's own pitch rather than a shop, so it gets its name and
 * nothing else — the same rule the register flow follows.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { PhotosField } from '@/features/media/PhotosField';
import { Button, Input, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageDetailsScreen() {
  return (
    <ManageGate
      title="Name & details"
      intro="Your name, your one-liner and the photo behind them. Changes show on your business page as soon as you save."
      need="owner"
      what="name & details"
      Form={DetailsForm}
    />
  );
}

function DetailsForm({ business, save, saving }: ManageFormProps) {
  const isStall = business.type === 'item';
  const [name, setName] = useState(business.name);
  const [tagline, setTagline] = useState(business.tagline ?? '');
  const [description, setDescription] = useState(business.description ?? '');
  // Kept as a list of one so it can reuse the picker sellers use for items.
  const [cover, setCover] = useState<string[]>(
    business.coverImageUrl ? [business.coverImageUrl] : [],
  );

  const submit = () =>
    save(
      isStall
        ? { ...(name.trim() ? { name: name.trim() } : {}) }
        : {
            ...(name.trim() ? { name: name.trim() } : {}),
            tagline: tagline.trim() || undefined,
            description: description.trim() || undefined,
            coverImageUrl: cover[0],
          },
    );

  if (isStall) {
    return (
      <>
        <Input
          label="Stall name"
          helper="Named after you by default — give your stall its own name if you like."
          value={name}
          onChangeText={setName}
        />
        <Button title="Save" onPress={submit} loading={saving} style={styles.save} />
      </>
    );
  }

  return (
    <>
      <Input
        label="Business name"
        placeholder="e.g. Sparks Electrical, Meera’s Cafe"
        value={name}
        onChangeText={setName}
      />
      <Input
        label="Tagline (optional)"
        placeholder="One line about what you offer"
        value={tagline}
        onChangeText={setTagline}
      />
      <Input
        label="Description (optional)"
        placeholder="Tell customers more…"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
      />

      <Text variant="label" weight="semibold" style={styles.label}>
        Display picture
      </Text>
      <Text variant="caption" tone="muted" style={styles.help}>
        Optional. Shown as the background behind your name — a photo of the
        place itself works best.
      </Text>
      <PhotosField label="" value={cover} onChange={setCover} max={1} />

      <Button title="Save" onPress={submit} loading={saving} style={styles.save} />
    </>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  label: { marginTop: spacing.md, marginBottom: spacing.xs },
  help: { marginBottom: spacing.md },
  save: { marginTop: spacing.lg },
});
