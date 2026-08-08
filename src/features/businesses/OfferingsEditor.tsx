/**
 * Editor for a list of priced offerings — a shop's products, a service
 * provider's services, or things for rent. Add each with a name + optional
 * price.
 *
 * Pass `sections` (SERVICE_SECTIONS / RENTAL_SECTIONS from
 * `domain/offeringSections.ts`) to file each item under a ready-made category
 * instead of leaving the list as one undifferentiated pile: a row of section
 * chips, a second row of that section's subcategories, and "＋ Own" on either
 * row for the thing the library misses. The pick STICKS between adds, so a
 * whole section goes in without re-picking, and it lands on the item's
 * `category`/`subcategory` — the two fields the business page already groups by.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { OfferingSection } from '@/domain/offeringSections';
import { Button, Card, Input, Tag, Text } from '@/components/ui';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { PhotosField } from '@/features/media/PhotosField';
import { radius, spacing, useColors } from '@/theme/theme';

/** "150" / "4.5" (numeric box) → "₹150" / "₹4.50"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

export interface OfferingItem {
  name: string;
  price?: string;
  description?: string;
  /** Photos of the thing being sold (products/stall items); first is the cover. */
  images?: string[];
  /** Section the item files under, e.g. "Repairs" — a library section's name. */
  category?: string;
  /** Group inside the section, e.g. "AC". */
  subcategory?: string;
  /** Browse-catalog id carried by the picked section (rental items). */
  subcategoryId?: string;
}

export interface OfferingsEditorProps<T extends OfferingItem> {
  value: T[];
  onChange: (next: T[]) => void;
  namePlaceholder?: string;
  addLabel?: string;
  /** Prebuilt category library — chips each added item files under. */
  sections?: OfferingSection[];
  /** Label above the section chips, e.g. "What kind of thing is it?". */
  sectionsLabel?: string;
  /** Show an optional multi-line Description box for each item (services). */
  withDescription?: boolean;
  /** Placeholder inside the Description box (withDescription). */
  descriptionPlaceholder?: string;
  /** Let each item carry a photo (camera/gallery) — the Stalls grid leads with it. */
  withImage?: boolean;
}

/** Sections the owner invented, read back off the items already added. */
function deriveCustomSections(items: OfferingItem[], library: OfferingSection[]): OfferingSection[] {
  const custom: OfferingSection[] = [];
  for (const item of items) {
    const name = item.category?.trim();
    if (!name) continue;
    if (library.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    if (custom.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    custom.push({ id: `custom:${name}`, name, icon: '✨' });
  }
  return custom;
}

export function OfferingsEditor<T extends OfferingItem>({
  value,
  onChange,
  namePlaceholder = 'Name',
  addLabel = 'Add',
  sections,
  sectionsLabel = 'Which section does it go in?',
  withDescription = false,
  descriptionPlaceholder = 'What it includes (optional)',
  withImage = false,
}: OfferingsEditorProps<T>) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  // The section pick persists between adds — a whole section goes in without
  // re-picking it for every item.
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [subcategory, setSubcategory] = useState<string | undefined>();
  // Sections/subcategories the owner typed because the library missed them.
  const library = sections ?? [];
  const [customSections, setCustomSections] = useState<OfferingSection[]>(() =>
    deriveCustomSections(value, library),
  );
  const [customSubs, setCustomSubs] = useState<string[]>([]);
  // Which "＋ Own" box is open ('section' | 'sub'), and what's being typed.
  const [adding, setAdding] = useState<'section' | 'sub' | null>(null);
  const [customText, setCustomText] = useState('');
  // Why: a silently disabled Add button reads as broken — keep it tappable
  // and explain what's missing instead.
  const [error, setError] = useState<string | null>(null);
  // Index of the row loaded into the composer for editing, or null when the
  // composer is adding a new item. Editing reuses the composer rather than
  // growing a second form, so every field stays editable the same way.
  const [editing, setEditing] = useState<number | null>(null);

  const allSections = useMemo(
    () => [...library, ...customSections],
    [library, customSections],
  );
  const section = allSections.find((s) => s.id === sectionId);
  const subOptions = useMemo(
    () => [...(section?.subcategories ?? []), ...customSubs],
    [section, customSubs],
  );

  const pickSection = (next: OfferingSection) => {
    const same = sectionId === next.id;
    setSectionId(same ? undefined : next.id);
    // Subcategories belong to their section — never carry one across.
    setSubcategory(undefined);
    setCustomSubs([]);
    setAdding(null);
  };

  /** Commit the "＋ Own" box into a custom section or subcategory. */
  const commitCustom = () => {
    const clean = customText.trim();
    setCustomText('');
    setAdding(null);
    if (!clean) return;
    if (adding === 'sub') {
      const existing = subOptions.find((s) => s.toLowerCase() === clean.toLowerCase());
      if (!existing) setCustomSubs((prev) => [...prev, clean]);
      setSubcategory(existing ?? clean);
      return;
    }
    const existing = allSections.find((s) => s.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      setSectionId(existing.id);
    } else {
      const made: OfferingSection = { id: `custom:${clean}`, name: clean, icon: '✨' };
      setCustomSections((prev) => [...prev, made]);
      setSectionId(made.id);
    }
    setSubcategory(undefined);
    setCustomSubs([]);
  };

  const buildItem = (rawName: string, rawPrice: string): T =>
    ({
      name: rawName.trim(),
      price: toPriceLabel(rawPrice),
      description: withDescription ? description.trim() || undefined : undefined,
      images: withImage && images.length > 0 ? images : undefined,
      category: section?.name,
      subcategory: section ? subcategory : undefined,
      subcategoryId: section?.subcategoryId,
    }) as T;

  /** Clear the composer back to an empty "add the next one" state. */
  const resetComposer = () => {
    setName('');
    setPrice('');
    setDescription('');
    setImages([]);
    setError(null);
  };

  const add = () => {
    if (!name.trim()) {
      setError('Type a name in the box above first — the price is optional.');
      return;
    }
    onChange([...value, buildItem(name, price)]);
    resetComposer();
  };

  /** Save the row being edited, keeping everything the composer holds. */
  const saveEdit = () => {
    if (editing === null) return;
    if (!name.trim()) {
      setError('An item needs a name. Clear the price instead if it’s not for sale.');
      return;
    }
    const edited = buildItem(name, price);
    onChange(
      value.map((item, i) =>
        // Keep fields the composer doesn't own (a product's id, its sold flag)
        // so editing a price never detaches the item from its page or thread.
        i === editing ? ({ ...item, ...edited } as T) : item,
      ),
    );
    setEditing(null);
    resetComposer();
  };

  /** Load a row into the composer so every field can be changed in place. */
  const startEdit = (index: number) => {
    const item = value[index];
    if (!item) return;
    setEditing(index);
    setError(null);
    setName(item.name);
    // Stored prices are labels ("₹120"); the box holds the bare number.
    const amount = parsePrice(item.price);
    setPrice(amount === undefined ? '' : String(amount));
    setDescription(item.description ?? '');
    setImages(item.images ?? []);

    // Re-select the section/subcategory it was filed under, inventing chips for
    // anything the library doesn't know so the pick round-trips unchanged.
    const categoryName = item.category?.trim();
    if (!categoryName) {
      setSectionId(undefined);
      setSubcategory(undefined);
      return;
    }
    let target = allSections.find((s) => s.name.toLowerCase() === categoryName.toLowerCase());
    if (!target) {
      target = { id: `custom:${categoryName}`, name: categoryName, icon: '✨' };
      setCustomSections((prev) => [...prev, target!]);
    }
    setSectionId(target.id);
    const sub = item.subcategory?.trim();
    setSubcategory(sub || undefined);
    setCustomSubs(
      sub && !(target.subcategories ?? []).some((s) => s.toLowerCase() === sub.toLowerCase())
        ? [sub]
        : [],
    );
  };

  const cancelEdit = () => {
    setEditing(null);
    resetComposer();
  };

  // A row typed but never "Add"ed would silently vanish when the user moves
  // on (e.g. taps Next in the register wizard). Commit it on unmount instead.
  // An in-progress EDIT is not committed — it already exists in the list, and
  // appending it would duplicate the row.
  const latest = useRef({ name, price, value, onChange, buildItem, editing });
  latest.current = { name, price, value, onChange, buildItem, editing };
  useEffect(
    () => () => {
      const pending = latest.current;
      if (pending.editing === null && pending.name.trim()) {
        pending.onChange([...pending.value, pending.buildItem(pending.name, pending.price)]);
      }
    },
    [],
  );

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    // Removing a row shifts every later index — drop the edit rather than let
    // it write over whatever slid into the slot.
    if (editing !== null && editing >= index) cancelEdit();
  };

  /** "Repairs › AC" — where the item was filed, shown under its name. */
  const groupLabel = (item: T): string | undefined =>
    [item.category, item.subcategory].filter(Boolean).join(' › ') || undefined;

  return (
    <View>
      {value.length > 0 ? (
        <Card style={styles.list}>
          {value.map((item, i) => (
            <View
              key={`${item.name}-${i}`}
              style={[
                styles.row,
                editing === i ? { ...styles.rowEditing, borderColor: colors.brand } : null,
              ]}
            >
              {withImage && item.images?.[0] ? (
                <Image source={{ uri: item.images[0] }} style={styles.thumb} resizeMode="cover" />
              ) : null}
              <View style={styles.itemName}>
                <Text>{item.name}</Text>
                {groupLabel(item) ? (
                  <Text variant="caption" tone="brand">
                    {groupLabel(item)}
                  </Text>
                ) : null}
                {item.description ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              {item.price ? (
                <Text weight="semibold" tone="brand">
                  {item.price}
                </Text>
              ) : null}
              <Text
                weight="semibold"
                tone={editing === i ? 'brand' : 'muted'}
                onPress={() => (editing === i ? cancelEdit() : startEdit(i))}
              >
                ✏️
              </Text>
              <Text tone="danger" weight="semibold" onPress={() => remove(i)}>
                ✕
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {sections ? (
        <>
          <Text variant="label" weight="semibold" style={styles.chipLabel}>
            {sectionsLabel}
          </Text>
          <View style={styles.chipRow}>
            {allSections.map((s) => (
              <Tag
                key={s.id}
                label={s.name}
                icon={s.icon}
                selected={sectionId === s.id}
                onPress={() => pickSection(s)}
                style={styles.chip}
              />
            ))}
            <Tag
              label="＋ Own"
              selected={adding === 'section'}
              onPress={() => {
                setAdding(adding === 'section' ? null : 'section');
                setCustomText('');
              }}
              style={styles.chip}
            />
          </View>

          {/* The section's own groups — only once a section is picked, because
              "AC" means nothing until you know it's under Repairs. */}
          {section ? (
            <View style={styles.chipRow}>
              {subOptions.map((s) => (
                <Tag
                  key={s}
                  label={s}
                  selected={subcategory === s}
                  onPress={() => setSubcategory(subcategory === s ? undefined : s)}
                  style={styles.chip}
                />
              ))}
              <Tag
                label="＋ Own"
                selected={adding === 'sub'}
                onPress={() => {
                  setAdding(adding === 'sub' ? null : 'sub');
                  setCustomText('');
                }}
                style={styles.chip}
              />
            </View>
          ) : null}

          {adding ? (
            <View style={styles.customBox}>
              <View style={styles.nameField}>
                <Input
                  placeholder={adding === 'sub' ? 'Your own group' : 'Your own section'}
                  value={customText}
                  onChangeText={setCustomText}
                  onSubmitEditing={commitCustom}
                  autoFocus
                />
              </View>
              <Button title="Use" variant="secondary" onPress={commitCustom} />
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.inputs}>
        <View style={styles.nameField}>
          <Input
            placeholder={namePlaceholder}
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            onSubmitEditing={add}
          />
        </View>
        <View style={styles.priceField}>
          <Input
            placeholder="₹"
            value={price}
            onChangeText={(t) => setPrice(sanitizePriceInput(t))}
            keyboardType="numeric"
            onSubmitEditing={add}
          />
        </View>
      </View>
      {withDescription ? (
        <View style={styles.descField}>
          <Input
            placeholder={descriptionPlaceholder}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>
      ) : null}
      {withImage ? (
        <PhotosField label="Photos (optional)" value={images} onChange={setImages} />
      ) : null}
      {sections ? (
        <Text variant="caption" tone="muted" style={styles.groupsHint}>
          {editing !== null
            ? `Filed under ${section ? [section.name, subcategory].filter(Boolean).join(' › ') : 'no section'} — switch it above to move the item.`
            : section
              ? `Adding to ${[section.name, subcategory].filter(Boolean).join(' › ')} — the section sticks, so put the whole lot in, then switch.`
              : 'Pick a section above so customers can browse your list instead of scrolling it.'}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {editing !== null ? (
        <View style={styles.editActions}>
          <View style={styles.editBtn}>
            <Button title="Cancel" variant="ghost" onPress={cancelEdit} />
          </View>
          <View style={styles.editBtn}>
            <Button title="Save changes" variant="secondary" onPress={saveEdit} />
          </View>
        </View>
      ) : (
        <Button title={addLabel} variant="secondary" onPress={add} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  // The row loaded into the composer — a left rule so it's obvious which item
  // the fields below belong to.
  rowEditing: {
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
    marginLeft: -spacing.sm,
    borderRadius: radius.sm,
  },
  editActions: { flexDirection: 'row', gap: spacing.sm },
  editBtn: { flex: 1 },
  itemName: { flex: 1 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  inputs: { flexDirection: 'row', gap: spacing.md },
  customBox: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.md },
  descField: { marginTop: spacing.sm },
  error: { marginBottom: spacing.sm },
  groupsHint: { marginBottom: spacing.sm },
  nameField: { flex: 1 },
  priceField: { width: 90 },
  chipLabel: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: { marginRight: 0 },
});
