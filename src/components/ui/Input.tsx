/**
 * Labeled text input with themed styling and optional helper/error text.
 *
 * A field marked `secureTextEntry` grows an eye button on its right edge that
 * reveals what was typed. It lives HERE rather than on the sign-in screen so
 * every password box in the app — sign in, sign up, change password — behaves
 * the same way, and so a new one never ships without it.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string;
}

export function Input({ label, helper, error, style, ...rest }: InputProps) {
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!rest.secureTextEntry;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" weight="medium" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View style={styles.field}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.surface,
              borderColor: error ? colors.danger : colors.border,
            },
            // Room for the eye, so a long password never runs under it.
            isPassword && styles.inputWithToggle,
            style,
          ]}
          {...rest}
          // After the spread on purpose: revealing the password is this
          // component's call, not the caller's.
          secureTextEntry={isPassword && !revealed}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: revealed }}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Icon
              name={revealed ? 'eyeOff' : 'eye'}
              size={20}
              color={revealed ? colors.brand : colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>

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
  field: { justifyContent: 'center' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  inputWithToggle: { paddingRight: 46 },
  toggle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  togglePressed: { opacity: 0.6 },
  helper: { marginTop: spacing.xs },
});
