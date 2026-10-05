/**
 * Reading back what someone filled in on the joining form — on the pending
 * request (so the business decides with the details in front of them) and on the
 * member's own detail page afterwards.
 *
 * It prints the labels the ANSWER carries, not the ones the form carries now:
 * the owner is free to reword or delete a question, and an answer given in March
 * still has to read correctly in June. Photos draw as a thumbnail.
 */
import { Image, StyleSheet, View } from 'react-native';
import type { EnrollAnswer } from '@/domain/types';
import { thumbUrl } from '@/lib/media';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface EnrollAnswersProps {
  answers: EnrollAnswer[];
  /** A heading above the list — omit it when the caller draws its own. */
  title?: string;
}

export function EnrollAnswers({ answers, title }: EnrollAnswersProps) {
  const colors = useColors();
  if (answers.length === 0) return null;
  return (
    <View>
      {title ? (
        <Text weight="semibold" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {answers.map((a) => (
        <View key={a.fieldId} style={styles.row}>
          <Text variant="caption" tone="muted">
            {a.label}
          </Text>
          {a.type === 'photo' ? (
            <Image
              source={{ uri: thumbUrl(a.value) }}
              style={[styles.photo, { borderColor: colors.border }]}
              resizeMode="cover"
              accessibilityLabel={a.label}
            />
          ) : (
            <Text weight="medium">{a.value}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.sm },
  row: { marginBottom: spacing.sm },
  photo: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
});
