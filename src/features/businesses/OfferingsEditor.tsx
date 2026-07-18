/**
 * Editor for a list of priced offerings — a shop's menu items, a service
 * provider's services, or things for rent. Add each with a name + optional
 * price. Two optional grouping modes:
 *  - `withGroups`: free-text Category / Subcategory boxes ("Starters" → "Veg")
 *    that stick between adds, so a whole menu section goes in without retyping.
 *  - `categoryOptions`: catalog chips — each added item picks one (a rental
 *    lister tags the flat as Flats & rooms and the Activa as Bikes).
 */
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Card, Input, Tag, Text } from '@/components/ui';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { PhotosField } from '@/features/media/PhotosField';
import { radius, spacing } from '@/theme/theme';

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
  /** Free-text section, e.g. "Starters" (menu items). */
  category?: string;
  /** Free-text group inside the section, e.g. "Veg" (menu items). */
  subcategory?: string;
  /** Catalog category id picked from `categoryOptions` (rental items). */
  subcategoryId?: string;
}

export interface OfferingCategoryOption {
  id: string;
  name: string;
  icon?: string;
}

export interface OfferingsEditorProps<T extends OfferingItem> {
  value: T[];
  onChange: (next: T[]) => void;
  namePlaceholder?: string;
  addLabel?: string;
  /** Show free-text Category / Subcategory boxes for each item (menus). */
  withGroups?: boolean;
  /** Catalog chips — each added item carries the picked one (rentals). */
  categoryOptions?: OfferingCategoryOption[];
  /** Label above the category chips, e.g. "What kind of thing is it?". */
  categoryOptionsLabel?: string;
  /** Let each item carry a photo (camera/gallery) — the Stalls grid leads with it. */
  withImage?: boolean;
}

export function OfferingsEditor<T extends OfferingItem>({
  value,
  onChange,
  namePlaceholder = 'Name',
  addLabel = 'Add',
  withGroups = false,
  categoryOptions,
  categoryOptionsLabel = 'Category',
  withImage = false,
}: OfferingsEditorProps<T>) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [images, setImages] = useState<string[]>([]);
  // Groups persist between adds — a menu section goes in without retyping.
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  // Why: a silently disabled Add button reads as broken — keep it tappable
  // and explain what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const buildItem = (rawName: string, rawPrice: string): T =>
    ({
      name: rawName.trim(),
      price: toPriceLabel(rawPrice),
      images: withImage && images.length > 0 ? images : undefined,
      category: withGroups ? category.trim() || undefined : undefined,
      subcategory: withGroups ? subcategory.trim() || undefined : undefined,
      subcategoryId: categoryOptions ? categoryId : undefined,
    }) as T;

  const add = () => {
    if (!name.trim()) {
      setError('Type a name in the box above first — the price is optional.');
      return;
    }
    onChange([...value, buildItem(name, price)]);
    setName('');
    setPrice('');
    setImages([]);
    setError(null);
  };

  // A row typed but never "Add"ed would silently vanish when the user moves
  // on (e.g. taps Next in the register wizard). Commit it on unmount instead.
  const latest = useRef({ name, price, value, onChange, buildItem });
  latest.current = { name, price, value, onChange, buildItem };
  useEffect(
    () => () => {
      const pending = latest.current;
      if (pending.name.trim()) {
        pending.onChange([...pending.value, pending.buildItem(pending.name, pending.price)]);
      }
    },
    [],
  );

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  /** "Starters › Veg" / the picked chip's name — shown under the item. */
  const groupLabel = (item: T): string | undefined => {
    if (item.category || item.subcategory) {
      return [item.category, item.subcategory].filter(Boolean).join(' › ');
    }
    if (item.subcategoryId) {
      return categoryOptions?.find((c) => c.id === item.subcategoryId)?.name;
    }
    return undefined;
  };

  return (
    <View>
      {value.length > 0 ? (
        <Card style={styles.list}>
          {value.map((item, i) => (
            <View key={`${item.name}-${i}`} style={styles.row}>
              {withImage && item.images?.[0] ? (
                <Image source={{ uri: item.images[0] }} style={styles.thumb} resizeMode="cover" />
              ) : null}
              <View style={styles.itemName}>
                <Text>{item.name}</Text>
                {groupLabel(item) ? (
                  <Text variant="caption" tone="muted">
                    {groupLabel(item)}
                  </Text>
                ) : null}
              </View>
              {item.price ? (
                <Text weight="semibold" tone="brand">
                  {item.price}
                </Text>
              ) : null}
              <Text tone="danger" weight="semibold" onPress={() => remove(i)}>
                ✕
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {categoryOptions ? (
        <>
          <Text variant="label" weight="semibold" style={styles.chipLabel}>
            {categoryOptionsLabel}
          </Text>
          <View style={styles.chipRow}>
            {categoryOptions.map((c) => (
              <Tag
                key={c.id}
                label={c.name}
                icon={c.icon}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                style={styles.chip}
              />
            ))}
          </View>
        </>
      ) : null}

      {withGroups ? (
        <View style={styles.inputs}>
          <View style={styles.nameField}>
            <Input
              label="Category (optional)"
              placeholder="e.g. Starters, Beverages"
              value={category}
              onChangeText={setCategory}
            />
          </View>
          <View style={styles.nameField}>
            <Input
              label="Subcategory (optional)"
              placeholder="e.g. Veg, Non-veg"
              value={subcategory}
              onChangeText={setSubcategory}
            />
          </View>
        </View>
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
      {withImage ? (
        <PhotosField label="Photos (optional)" value={images} onChange={setImages} />
      ) : null}
      {withGroups ? (
        <Text variant="caption" tone="muted" style={styles.groupsHint}>
          The category sticks around — add every item in a section, then change it.
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button title={addLabel} variant="secondary" onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  itemName: { flex: 1 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  inputs: { flexDirection: 'row', gap: spacing.md },
  error: { marginBottom: spacing.sm },
  groupsHint: { marginBottom: spacing.sm },
  nameField: { flex: 1 },
  priceField: { width: 90 },
  chipLabel: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: { marginRight: 0 },
});
