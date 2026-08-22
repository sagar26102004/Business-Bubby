/**
 * "Paste a list instead" — the escape hatch beside every folder editor.
 *
 * Filling a sixty-dish menu one form at a time is the worst part of registering
 * a business, and the owner usually already has the list written down. This
 * takes the whole thing at once: paste it (or, on the web, pick a `.json` file),
 * see what it parsed into BEFORE anything is committed, then add it to the list
 * or replace what's there.
 *
 * Nothing here is authoritative — whatever it produces lands in the same editor
 * below, where every row can still be opened, priced, photographed and deleted
 * by hand. The format itself lives in `importOfferings.ts`.
 */
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, Input, Text } from '@/components/ui';
import {
  ImportError,
  parseOfferings,
  type ImportSummary,
  type ImportedOffering,
} from './importOfferings';
import { radius, spacing, useColors } from '@/theme/theme';

/**
 * The one-liner in the panel's own blurb — the shape, in the words of the list
 * being filled, so a service list isn't explained with a milkshake.
 */
export const INLINE_EXAMPLES = {
  menu: 'Beverages: { Cold: { Shake: { Banana: 120 } } }',
  goods: 'Home electronics: { Fan: { Havells: { 1200mm: 1650 } } }',
  services: 'Repairs: { AC: { Gas refill: 2400 } }',
  rentals: 'Cars: { Hatchback: { Swift: 1800 } }',
} as const;

/** Worked examples, one per list — shown under "What should it look like?". */
export const MENU_EXAMPLE = `Beverages: {
  Cold: {
    Shake: { Banana: 120, Mango: 130 },
    Mojito: { Virgin Mojito: 150 }
  },
  Hot: { Masala Chai: 90, Filter Coffee: 110 }
},
Snacks: [French Fries, Samosa],
Desserts: {
  Gulab Jamun: { price: 90, veg: true, description: Two pieces, warm }
}`;

export const GOODS_EXAMPLE = `Home electronics: {
  Air conditioner: {
    Samsung: { 1.5 Ton Split: 34999 },
    Voltas: { 1 Ton Window: 26999 }
  },
  Ceiling fan: { Havells 1200mm: 1650 }
},
Hardware: [Copper Wire 90m, MCB 16A]`;

export const SERVICE_EXAMPLE = `Repairs: {
  AC: { Gas refill: 2400, Servicing: 599 },
  Washing machine: { Front load: { Drum repair: 1200 } }
},
Installation: { Split AC installation: 1600 }`;

export const RENTAL_EXAMPLE = `Cars: {
  Hatchback: { Swift: { price: 1800, per: day } },
  SUV: { Ertiga: 3000 }
},
Flats & rooms: {
  Flat: { 2 BHK: { price: 15000, per: month } }
}`;

export interface OfferingImportProps<T> {
  /** The list the editor below is working on. */
  value: T[];
  onChange: (next: T[]) => void;
  /** Turns one parsed row into the list's own item type. */
  map: (row: ImportedOffering) => T;
  /** What one entry is called — "dish", "product", "service", "rental". */
  noun: string;
  /** The worked example for this list. */
  example: string;
  /** The one-line version shown in the blurb — see `INLINE_EXAMPLES`. */
  inlineExample: string;
}

export function OfferingImport<T>({
  value,
  onChange,
  map,
  noun,
  example,
  inlineExample,
}: OfferingImportProps<T>) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [text, setText] = useState('');
  // Set after a successful import so the panel says what it did instead of
  // sitting there with the same text looking like nothing happened.
  const [done, setDone] = useState<string | null>(null);

  // Parsed on every keystroke: the preview is the whole point, and a menu-sized
  // paste is a few thousand characters, not a document.
  const parsed = useMemo((): { summary?: ImportSummary; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { summary: parseOfferings(text) };
    } catch (err) {
      if (err instanceof ImportError) return { error: err.message };
      return { error: 'That didn’t read as a list — check the braces line up.' };
    }
  }, [text]);

  const rows = parsed.summary?.rows ?? [];
  // "1 dish" / "2 dishes" — a count that reads as "2 dishs" makes the whole
  // panel look like a prototype.
  const plural = (n: number) =>
    `${n} ${n === 1 ? noun : /(?:s|sh|ch|x|z)$/i.test(noun) ? `${noun}es` : `${noun}s`}`;

  /** On the web the list may be a real file; on a phone it's a paste. */
  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setText(String(reader.result ?? ''));
        setDone(null);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const commit = (replace: boolean) => {
    if (rows.length === 0) return;
    const mapped = rows.map(map);
    onChange(replace ? mapped : [...value, ...mapped]);
    setDone(`${replace ? 'Replaced with' : 'Added'} ${plural(mapped.length)}. Edit any of them below.`);
    setText('');
  };

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.opener,
          { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text weight="semibold" tone="brand">
          📋 Paste the whole list instead
        </Text>
        <Text variant="caption" tone="muted">
          Already have your {noun} list written down? Drop it in at once.
        </Text>
      </Pressable>
    );
  }

  return (
    <Card style={styles.panel}>
      <View style={styles.head}>
        <Text weight="semibold" style={styles.headTitle}>
          📋 Paste the whole list
        </Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button">
          <Text tone="muted" weight="semibold">
            ✕
          </Text>
        </Pressable>
      </View>

      <Text variant="caption" tone="muted" style={styles.blurb}>
        Braces inside braces are folders inside folders, and the last name is the {noun}:{' '}
        <Text variant="caption" weight="semibold">
          {inlineExample}
        </Text>
      </Text>

      <Pressable
        onPress={() => setShowFormat((s) => !s)}
        accessibilityRole="button"
        style={styles.formatToggle}
      >
        <Text variant="label" weight="semibold" tone="accent">
          {showFormat ? 'Hide the example' : 'What should it look like?'}
        </Text>
      </Pressable>

      {showFormat ? (
        <>
          <View style={[styles.code, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text variant="caption" style={styles.mono}>
              {example}
            </Text>
          </View>
          <View style={styles.exampleActions}>
            <Button
              title="Use this example"
              variant="ghost"
              onPress={() => {
                setText(example);
                setDone(null);
              }}
            />
          </View>
          <Text variant="caption" tone="muted" style={styles.blurb}>
            Quotes are optional. A number is the price; any other text is the description. Spell
            it out with <Text variant="caption" weight="semibold">{'{ price: 120, veg: true }'}</Text> when
            you need to. Proper JSON works too.
          </Text>
        </>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={styles.fileRow}>
          <Button title="📄 Choose a .json file" variant="ghost" onPress={pickFile} />
        </View>
      ) : null}

      <Input
        placeholder={`Paste your ${noun} list here…`}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setDone(null);
        }}
        multiline
        style={styles.box}
      />

      {parsed.error ? (
        <Text variant="caption" tone="danger" style={styles.result}>
          {parsed.error}
        </Text>
      ) : null}

      {parsed.summary ? (
        <View style={styles.result}>
          <Text variant="caption" tone="brand" weight="semibold">
            Found {plural(rows.length)}
            {parsed.summary.sections.length > 0
              ? ` in ${parsed.summary.sections.length} section${parsed.summary.sections.length === 1 ? '' : 's'}`
              : ''}
            {parsed.summary.depth > 1 ? ` · ${parsed.summary.depth} levels deep` : ''}
          </Text>
          <Preview rows={rows} />
        </View>
      ) : null}

      {done ? (
        <Text variant="caption" tone="brand" weight="semibold" style={styles.result}>
          ✓ {done}
        </Text>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.actions}>
          {value.length > 0 ? (
            <View style={styles.action}>
              <Button title="Replace all" variant="ghost" onPress={() => commit(true)} />
            </View>
          ) : null}
          <View style={styles.actionWide}>
            <Button
              title={value.length > 0 ? `＋ Add ${plural(rows.length)}` : `Add ${plural(rows.length)}`}
              variant="secondary"
              onPress={() => commit(false)}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** The first handful of rows, filed the way they'll appear in the editor. */
const PREVIEW_ROWS = 8;

function Preview({ rows }: { rows: ImportedOffering[] }) {
  const shown = rows.slice(0, PREVIEW_ROWS);
  const rest = rows.length - shown.length;
  return (
    <View style={styles.preview}>
      {shown.map((row, i) => (
        <View key={`${row.name}-${i}`} style={styles.previewRow}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.previewWhere}>
            {[row.category, ...row.path].filter(Boolean).join(' › ') || 'No section'}
          </Text>
          <Text variant="caption" numberOfLines={1} style={styles.previewName}>
            {row.name}
          </Text>
          {row.price ? (
            <Text variant="caption" weight="semibold">
              {row.price}
            </Text>
          ) : null}
        </View>
      ))}
      {rest > 0 ? (
        <Text variant="caption" tone="muted">
          …and {rest} more
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  opener: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: spacing.md,
    gap: 2,
  },
  panel: { marginBottom: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headTitle: { flex: 1 },
  blurb: { lineHeight: 18 },
  formatToggle: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  code: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  mono: { fontFamily: Platform.select({ web: 'monospace', default: undefined }), lineHeight: 18 },
  exampleActions: { alignSelf: 'flex-start' },
  fileRow: { alignSelf: 'flex-start' },
  box: { minHeight: 140, textAlignVertical: 'top' },
  result: { marginTop: spacing.xs },
  preview: { marginTop: spacing.sm, gap: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewWhere: { flexShrink: 1, maxWidth: '45%' },
  previewName: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
  actionWide: { flex: 2 },
});
