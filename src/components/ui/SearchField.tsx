/**
 * A live search box for filtering a list in place — the app's drawn `search`
 * icon on the left (never an emoji), the field, and a ✕ that clears once
 * there's something to clear.
 *
 * Distinct from `SearchScanBar`, which is a Pressable that NAVIGATES to the
 * /search screen. This one is a real input: you type and the list below
 * narrows.
 */
import { Pressable, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  /** Screen-reader name, e.g. "Search customers by name". */
  accessibilityLabel?: string;
}

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search…',
  style,
  accessibilityLabel,
}: SearchFieldProps) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      <Icon name="search" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.text }]}
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text tone="muted" weight="bold">
            ✕
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
});
