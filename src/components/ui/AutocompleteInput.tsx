/**
 * Text input with typeahead suggestions (JEE-form style): typing filters the
 * given options — prefix matches first — and tapping one fills the field.
 * Free text stays allowed, so places missing from the catalog still work.
 */
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Input } from './Input';
import { Text } from './Text';

const MAX_SUGGESTIONS = 6;

export interface AutocompleteInputProps {
  label?: string;
  placeholder?: string;
  helper?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** The full option list; typing filters it. */
  options: string[];
  /** Called with the tapped suggestion (after onChangeText). */
  onSelect?: (option: string) => void;
}

export function AutocompleteInput({
  label,
  placeholder,
  helper,
  value,
  onChangeText,
  options,
  onSelect,
}: AutocompleteInputProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  // Delay hiding on blur so a tap on a suggestion lands before the list goes.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_SUGGESTIONS);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const option of options) {
      const lower = option.toLowerCase();
      if (lower === q) continue; // already typed exactly — nothing to suggest
      if (lower.startsWith(q)) starts.push(option);
      else if (lower.includes(q)) contains.push(option);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [value, options]);

  const pick = (option: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChangeText(option);
    onSelect?.(option);
    setFocused(false);
  };

  return (
    <View>
      <Input
        label={label}
        placeholder={placeholder}
        helper={helper}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setFocused(false), 200);
        }}
        style={focused && matches.length > 0 ? styles.inputOpen : undefined}
      />
      {focused && matches.length > 0 ? (
        <View
          style={[
            styles.list,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {matches.map((option, i) => (
            <Pressable
              key={option}
              // Select on press-IN: the input's blur fires between touch-down
              // and touch-up, and once the hide timer runs the row unmounts
              // mid-press and a plain onPress never lands (tap "did nothing").
              onPressIn={() => pick(option)}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Text variant="label">{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  list: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    // Tuck under the input above (its wrapper carries a bottom margin).
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
});
