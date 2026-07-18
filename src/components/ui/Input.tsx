/** Labeled text input with themed styling and optional helper/error text. */
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string;
}

export function Input({ label, helper, error, style, ...rest }: InputProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" weight="medium" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={styles.helper}>
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  helper: { marginTop: spacing.xs },
});
