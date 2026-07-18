/**
 * Multi-select tag picker for registration/manage: selected tags as chips
 * (tap to remove), a typeahead over the tag catalog, quick-pick suggestions,
 * and free-text custom tags for anything the catalog doesn't cover.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { TAG_CATALOG } from '@/domain/tags';
import { AutocompleteInput, Button, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Quick-pick chips shown under the input. */
  suggestions?: string[];
}

export function TagPicker({ value, onChange, suggestions = [] }: TagPickerProps) {
  const [text, setText] = useState('');

  const has = (tag: string) => value.some((v) => v.toLowerCase() === tag.trim().toLowerCase());

  const add = (raw: string) => {
    const typed = raw.trim().replace(/\s+/g, ' ');
    setText('');
    if (!typed || has(typed)) return;
    // Prefer the catalog's casing when the tag is a known one.
    const canonical = TAG_CATALOG.find((c) => c.toLowerCase() === typed.toLowerCase()) ?? typed;
    onChange([...value, canonical]);
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  const quick = suggestions.filter((s) => !has(s)).slice(0, 12);

  return (
    <View>
      {value.length > 0 ? (
        <>
          <View style={styles.row}>
            {value.map((tag) => (
              <Tag key={tag} label={`${tag} ✕`} tone="brand" onPress={() => remove(tag)} style={styles.chip} />
            ))}
          </View>
          <Text variant="caption" tone="muted" style={styles.hint}>
            Tap a tag to remove it.
          </Text>
        </>
      ) : null}

      <AutocompleteInput
        placeholder="Type a tag… e.g. Cafe, Plumber, Video editor"
        value={text}
        onChangeText={setText}
        options={TAG_CATALOG.filter((c) => !has(c))}
        onSelect={add}
      />
      {text.trim() ? (
        <Button
          title={`＋ Add “${text.trim()}”`}
          variant="secondary"
          onPress={() => add(text)}
          style={styles.addBtn}
        />
      ) : null}

      {quick.length > 0 ? (
        <>
          <Text variant="caption" tone="muted" style={styles.suggestLabel}>
            Popular — tap to add:
          </Text>
          <View style={styles.row}>
            {quick.map((s) => (
              <Tag key={s} label={s} onPress={() => add(s)} style={styles.chip} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { marginRight: 0 },
  hint: { marginTop: spacing.sm, marginBottom: spacing.md },
  addBtn: { marginBottom: spacing.md },
  suggestLabel: { marginBottom: spacing.sm },
});
