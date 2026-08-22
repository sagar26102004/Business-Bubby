/**
 * Catalog builder for a shop's PRODUCTS (and a personal stall's items), driven
 * by the goods library in domain/goods.ts. It is the menu builder's flow
 * applied to goods, because a hardware shop's stock is browsed exactly the way
 * a restaurant's menu is — you open a shelf, not a chip row.
 *
 * The navigation is folder-like, one level at a time, three deep:
 *
 *   Shelf            Home electronics        -> ProductItem.category
 *     Kind           Air conditioner         -> ProductItem.subcategory
 *       Brand        Samsung                 -> ProductItem.brand
 *         the thing  1.5 Ton · Split, ₹34,999
 *
 * Each level lists only what is filed AT it, so finishing Samsung's ACs and
 * opening Voltas hides the Samsungs and shows an empty Voltas ready for its
 * own. You can stop early at any level: a shop that just sells "cement" files
 * it straight under the shelf without picking a kind or a brand.
 *
 * At the last level the specs of the thing (1.5 Ton, Split, 5 Star) are picked
 * as chips from the library, and the model box is OPTIONAL — with the folders
 * and specs picked, `composeProductName` writes the name ("Samsung 1.5 Ton
 * Split Air conditioner"), so a shop puts a whole shelf in without typing a
 * name once. Anything typed always wins.
 *
 * The library is a head start, not a cage: every level takes a typed-in shelf,
 * kind or brand of its own. Custom levels are not stored separately — they live
 * on the products that carry them, so reopening the editor rebuilds the tree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { ProductItem } from '@/domain/types';
import {
  PRODUCT_CATEGORIES,
  composeProductName,
  findProductCategory,
  productBrands,
  productVariants,
  type ProductCategory,
} from '@/domain/goods';
import { Button, Card, Input, Tag, Text } from '@/components/ui';
import { PhotosField } from '@/features/media/PhotosField';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { radius, spacing, useColors } from '@/theme/theme';

/** "150" → "₹150"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

const same = (a?: string, b?: string) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Shelves the owner invented, read back off the products already listed. */
function deriveCustomShelves(products: ProductItem[]): ProductCategory[] {
  const shelves: ProductCategory[] = [];
  for (const p of products) {
    const category = p.category?.trim();
    if (!category || findProductCategory(category)) continue;
    if (shelves.some((s) => same(s.name, category))) continue;
    shelves.push({
      id: `custom:${category}`,
      name: category,
      icon: '📦',
      subcategoryId: 'other',
      types: [],
    });
  }
  return shelves;
}

export interface GoodsEditorProps<T extends ProductItem> {
  value: T[];
  onChange: (next: T[]) => void;
  /** A personal stall lists "items"; a shop lists "products". */
  noun?: 'product' | 'item';
}

export function GoodsEditor<T extends ProductItem>({
  value,
  onChange,
  noun = 'product',
}: GoodsEditorProps<T>) {
  const colors = useColors();
  // Shelves the owner made by hand that hold no product YET — a freshly created
  // empty shelf would otherwise vanish before anything is put on it. The
  // shelves that DO hold products are re-derived from `value` every render, so
  // a catalog pasted in through the import panel shows its shelves at once.
  const [ownShelves, setOwnShelves] = useState<ProductCategory[]>([]);
  const [openShelfId, setOpenShelfId] = useState<string | null>(null);
  const [newShelf, setNewShelf] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const shelves = useMemo(() => {
    const fromProducts = deriveCustomShelves(value);
    const empty = ownShelves.filter((own) => !fromProducts.some((d) => same(d.name, own.name)));
    return [...PRODUCT_CATEGORIES, ...fromProducts, ...empty];
  }, [value, ownShelves]);
  const openShelf = shelves.find((s) => s.id === openShelfId) ?? null;

  const countIn = (shelf: ProductCategory) =>
    value.filter((p) => same(p.category, shelf.name)).length;

  // Only shelves the owner invented can be renamed — the library ones are
  // shared and canonical so every shop's catalog reads the same.
  const isCustom = (s: ProductCategory) => s.id.startsWith('custom:');

  const startRename = (s: ProductCategory) => {
    setNewShelf(null);
    setRenamingId(s.id);
    setRenameText(s.name);
  };

  const commitRename = (shelf: ProductCategory) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === shelf.name) return;
    // Don't let a rename silently merge into another shelf.
    if (shelves.some((s) => s.id !== shelf.id && same(s.name, name))) return;
    // The name lives on every product on the shelf — move them all.
    onChange(value.map((p) => (same(p.category, shelf.name) ? { ...p, category: name } : p)));
    setOwnShelves((prev) =>
      prev.map((s) => (s.id === shelf.id ? { ...s, id: `custom:${name}`, name } : s)),
    );
  };

  const createShelf = () => {
    const name = (newShelf ?? '').trim();
    if (!name) return;
    const existing = shelves.find((s) => same(s.name, name));
    if (existing) {
      // Don't fork "Furniture" into a second "furniture" — open the one we have.
      setNewShelf(null);
      setOpenShelfId(existing.id);
      return;
    }
    const shelf: ProductCategory = {
      id: `custom:${name}`,
      name,
      icon: '📦',
      subcategoryId: 'other',
      types: [],
    };
    setOwnShelves((prev) => [...prev, shelf]);
    setNewShelf(null);
    setOpenShelfId(shelf.id);
  };

  if (openShelf) {
    return (
      <ShelfEditor
        shelf={openShelf}
        value={value}
        onChange={onChange}
        noun={noun}
        onBack={() => setOpenShelfId(null)}
      />
    );
  }

  return (
    <View>
      <Text variant="caption" tone="muted" style={styles.hint}>
        Tap a shelf to add what you stock. Skip the ones you don’t sell.
      </Text>
      {shelves.map((shelf) => {
        const count = countIn(shelf);
        const kinds = shelf.types.map((t) => t.name);
        if (renamingId === shelf.id) {
          return (
            <Card key={shelf.id} style={styles.shelfCard}>
              <Input
                placeholder="Shelf name"
                value={renameText}
                onChangeText={setRenameText}
                onSubmitEditing={() => commitRename(shelf)}
                autoFocus
              />
              <View style={styles.newShelfActions}>
                <View style={styles.newShelfButton}>
                  <Button title="Cancel" variant="ghost" onPress={() => setRenamingId(null)} />
                </View>
                <View style={styles.newShelfButton}>
                  <Button title="Save" variant="secondary" onPress={() => commitRename(shelf)} />
                </View>
              </View>
            </Card>
          );
        }
        return (
          <Card key={shelf.id} style={styles.shelfCard}>
            <View style={styles.shelfRow}>
              <Pressable
                onPress={() => setOpenShelfId(shelf.id)}
                accessibilityRole="button"
                style={styles.shelfOpen}
              >
                <Text style={styles.shelfIcon}>{shelf.icon}</Text>
                <View style={styles.shelfInfo}>
                  <Text weight="semibold">{shelf.name}</Text>
                  {count > 0 ? (
                    <Text variant="caption" tone="brand" weight="semibold">
                      {count} {count === 1 ? noun : `${noun}s`} added
                    </Text>
                  ) : kinds.length > 0 ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {kinds.slice(0, 4).join(' · ')}
                      {kinds.length > 4 ? ' …' : ''}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {isCustom(shelf) ? (
                <Pressable
                  onPress={() => startRename(shelf)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${shelf.name}`}
                >
                  <Text tone="brand" weight="semibold">
                    ✏️
                  </Text>
                </Pressable>
              ) : null}
              <Text tone="muted" onPress={() => setOpenShelfId(shelf.id)}>
                ›
              </Text>
            </View>
          </Card>
        );
      })}

      {newShelf === null ? (
        <Pressable
          onPress={() => setNewShelf('')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.addShelf,
            { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text weight="semibold" tone="brand">
            ＋ Create a new shelf
          </Text>
        </Pressable>
      ) : (
        <Card style={styles.shelfCard}>
          <Input
            placeholder="Shelf name — e.g. Fireworks, Musical instruments"
            value={newShelf}
            onChangeText={setNewShelf}
            onSubmitEditing={createShelf}
            autoFocus
          />
          <View style={styles.newShelfActions}>
            <View style={styles.newShelfButton}>
              <Button title="Cancel" variant="ghost" onPress={() => setNewShelf(null)} />
            </View>
            <View style={styles.newShelfButton}>
              <Button title="Create" variant="secondary" onPress={createShelf} />
            </View>
          </View>
        </Card>
      )}
    </View>
  );
}

/** How deep in the shelf we are: [] = shelf root, [kind], [kind, brand]. */
type Path = string[];

/**
 * Add/remove products inside ONE shelf, walking its kind → brand folders. The
 * owner only ever sees one folder at a time: the folders inside it, the
 * products filed directly in it, and the form to add more.
 */
function ShelfEditor<T extends ProductItem>({
  shelf,
  value,
  onChange,
  noun,
  onBack,
}: {
  shelf: ProductCategory;
  value: T[];
  onChange: (next: T[]) => void;
  noun: 'product' | 'item';
  onBack: () => void;
}) {
  const [path, setPath] = useState<Path>([]);
  // Folders the owner just made that hold nothing yet — kept so a fresh empty
  // folder doesn't vanish before anything goes in it.
  const [customFolders, setCustomFolders] = useState<Path[]>([]);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const shelfItems = useMemo(
    () => value.filter((p) => same(p.category, shelf.name)),
    [value, shelf.name],
  );

  /** Where a product sits inside this shelf: [] / [kind] / [kind, brand]. */
  const pathOf = (p: ProductItem): Path => {
    const kind = p.subcategory?.trim();
    if (!kind) return [];
    const brand = p.brand?.trim();
    return brand ? [kind, brand] : [kind];
  };
  const samePathAs = (a: Path, b: Path) =>
    a.length === b.length && a.every((seg, i) => same(seg, b[i]));
  const isUnder = (parent: Path, p: Path) =>
    p.length >= parent.length && parent.every((seg, i) => same(seg, p[i]));

  // Products filed exactly at the folder we're standing in.
  const here = shelfItems.filter((p) => samePathAs(pathOf(p), path));

  // The folders visible at this level: the library's (kinds at the shelf root,
  // that kind's brands one level in), any inferred from products already
  // listed, and freshly-created empty ones. Nothing below brand — that's where
  // the products themselves live.
  const childFolders = useMemo(() => {
    if (path.length >= 2) return [];
    const names: string[] = [];
    const add = (name?: string) => {
      if (name && !names.some((n) => same(n, name))) names.push(name);
    };
    if (path.length === 0) shelf.types.forEach((t) => add(t.name));
    else productBrands(shelf.name, path[0]).forEach(add);
    for (const p of shelfItems) {
      const full = pathOf(p);
      if (full.length > path.length && isUnder(path, full)) add(full[path.length]);
    }
    for (const f of customFolders) {
      if (f.length === path.length + 1 && isUnder(path, f)) add(f[path.length]);
    }
    return names;
  }, [shelf, shelfItems, customFolders, path]);

  const descendantCount = (folder: Path) =>
    shelfItems.filter((p) => isUnder(folder, pathOf(p))).length;

  const openFolder = (name: string) => {
    setNewFolder(null);
    setPath((p) => [...p, name]);
  };
  const goToDepth = (depth: number) => {
    setNewFolder(null);
    setPath((p) => p.slice(0, depth));
  };

  const createFolder = () => {
    const name = (newFolder ?? '').trim();
    if (!name) return;
    const full = [...path, name];
    if (!customFolders.some((f) => samePathAs(f, full)) && !childFolders.some((n) => same(n, name))) {
      setCustomFolders((prev) => [...prev, full]);
    }
    setNewFolder(null);
    setPath(full);
  };

  return (
    <View>
      <ShelfBreadcrumb shelf={shelf} path={path} onNavigate={goToDepth} onExit={onBack} />

      {childFolders.length > 0 || newFolder !== null ? (
        <FolderRow
          folders={childFolders}
          count={(name) => descendantCount([...path, name])}
          onOpen={openFolder}
          newFolder={newFolder}
          onStartNew={() => setNewFolder('')}
          onChangeNew={setNewFolder}
          onCommitNew={createFolder}
          depth={path.length}
          shelfName={shelf.name}
        />
      ) : path.length < 2 ? (
        <Pressable
          onPress={() => setNewFolder('')}
          accessibilityRole="button"
          style={styles.addFolderInline}
        >
          <Text weight="semibold" tone="brand">
            ＋ Add {path.length === 0 ? 'a kind of thing' : 'a brand'}
          </Text>
        </Pressable>
      ) : null}

      <ProductComposer
        key={path.join('›') || 'root'}
        shelf={shelf}
        path={path}
        here={here}
        value={value}
        onChange={onChange}
        noun={noun}
      />
    </View>
  );
}

/** Shelf title + a tappable breadcrumb of the folders you've opened. */
function ShelfBreadcrumb({
  shelf,
  path,
  onNavigate,
  onExit,
}: {
  shelf: ProductCategory;
  path: Path;
  onNavigate: (depth: number) => void;
  onExit: () => void;
}) {
  return (
    <View>
      <Pressable onPress={onExit} style={styles.back} accessibilityRole="button">
        <Text weight="semibold" tone="brand">
          ‹ All shelves
        </Text>
      </Pressable>

      <View style={styles.crumbRow}>
        <Pressable onPress={() => onNavigate(0)} accessibilityRole="button">
          <Text variant="subheading" weight="bold">
            {shelf.icon} {shelf.name}
          </Text>
        </Pressable>
        {path.map((seg, i) => (
          <View key={`${seg}-${i}`} style={styles.crumbRow}>
            <Text tone="muted" style={styles.crumbSep}>
              ›
            </Text>
            <Pressable onPress={() => onNavigate(i + 1)} accessibilityRole="button">
              <Text variant="subheading" weight="bold">
                {seg}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The folders at the current level, plus "add one of your own". */
function FolderRow({
  folders,
  count,
  onOpen,
  newFolder,
  onStartNew,
  onChangeNew,
  onCommitNew,
  depth,
  shelfName,
}: {
  folders: string[];
  count: (name: string) => number;
  onOpen: (name: string) => void;
  newFolder: string | null;
  onStartNew: () => void;
  onChangeNew: (v: string) => void;
  onCommitNew: () => void;
  depth: number;
  shelfName: string;
}) {
  const colors = useColors();
  return (
    <>
      <Text variant="label" weight="semibold" style={styles.folderLabel}>
        {depth === 0 ? 'What kind of thing? (optional)' : 'Which brand? (optional)'}
      </Text>
      <View style={styles.folderRow}>
        {folders.map((name) => (
          <Pressable
            key={name}
            onPress={() => onOpen(name)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.folderChip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text weight="semibold">
              {name}
              {count(name) > 0 ? <Text tone="muted"> · {count(name)}</Text> : null} ›
            </Text>
          </Pressable>
        ))}
        {newFolder === null ? (
          <Pressable
            onPress={onStartNew}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.folderChip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderStyle: 'dashed',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text weight="semibold" tone="brand">
              ＋ {depth === 0 ? 'New kind' : 'New brand'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {newFolder !== null ? (
        <View style={styles.newFolderRow}>
          <View style={styles.nameField}>
            <Input
              placeholder={
                depth === 0
                  ? `Kind of ${shelfName.toLowerCase()} — e.g. Air conditioner`
                  : 'Brand — e.g. Samsung'
              }
              value={newFolder}
              onChangeText={onChangeNew}
              onSubmitEditing={onCommitNew}
              autoFocus
            />
          </View>
          <Button title="Add" variant="secondary" onPress={onCommitNew} />
        </View>
      ) : null}
    </>
  );
}

/**
 * The products at the current folder + the form to add another. The specs of
 * the thing come from the library as multi-pick chips ("1.5 Ton" AND "Split"),
 * and they name the product when the model box is left empty.
 */
function ProductComposer<T extends ProductItem>({
  shelf,
  path,
  here,
  value,
  onChange,
  noun,
}: {
  shelf: ProductCategory;
  path: Path;
  here: T[];
  value: T[];
  onChange: (next: T[]) => void;
  noun: 'product' | 'item';
}) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [customSpec, setCustomSpec] = useState<string | null>(null);
  // The product being edited in place, or null when the form adds a new one.
  const [editing, setEditing] = useState<T | null>(null);
  // Why: a silently disabled Add button reads as broken — keep it tappable and
  // say what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const kind = path[0];
  const brand = path[1];
  const specs = useMemo(() => productVariants(shelf.name, kind), [shelf.name, kind]);
  // Anything typed in as its own spec joins the row so it can be un-picked.
  const specOptions = useMemo(() => {
    const known = specs?.options ?? [];
    return [...known, ...variants.filter((v) => !known.some((k) => same(k, v)))];
  }, [specs, variants]);

  /** The name the folders and specs already say, for an empty model box. */
  const composed = composeProductName({ subcategory: kind, brand, variants });

  const toggleVariant = (spec: string) =>
    setVariants((prev) => (prev.some((v) => same(v, spec)) ? prev.filter((v) => !same(v, spec)) : [...prev, spec]));

  const commitCustomSpec = () => {
    const clean = (customSpec ?? '').trim();
    setCustomSpec(null);
    if (clean && !variants.some((v) => same(v, clean))) toggleVariant(clean);
  };

  const buildItem = (): T =>
    ({
      // Keep what the composer doesn't own — a product's id, its sold flag —
      // so editing a price never detaches it from its page or its thread.
      ...(editing ?? {}),
      // Typed model wins; otherwise the picks name it.
      name: name.trim() || composed || '',
      price: toPriceLabel(price),
      description: description.trim() || undefined,
      images: images.length > 0 ? images : undefined,
      category: shelf.name,
      subcategory: kind,
      brand,
      variants: variants.length > 0 ? variants : undefined,
      // The browse-catalog id the shelf files under, so the Stalls chips match.
      subcategoryId: shelf.subcategoryId,
    }) as T;

  const clearForm = () => {
    setName('');
    setPrice('');
    setDescription('');
    setImages([]);
    // The specs described the thing that just went in — the next gets its own.
    setVariants([]);
    setCustomSpec(null);
    setEditing(null);
    setError(null);
  };

  const add = () => {
    if (!name.trim() && !composed) {
      setError(
        `Type a name for it — or open a kind and a brand above and we’ll name the ${noun} for you.`,
      );
      return;
    }
    const built = buildItem();
    onChange(editing ? value.map((p) => (p === editing ? built : p)) : [...value, built]);
    clearForm();
  };

  /** Load a product into the form to edit it (rather than add a new one). */
  const startEdit = (item: T) => {
    setEditing(item);
    setName(item.name);
    setPrice(item.price ? String(parsePrice(item.price) ?? '') : '');
    setDescription(item.description ?? '');
    setImages(item.images ?? []);
    setVariants(item.variants ?? []);
    setCustomSpec(null);
    setError(null);
  };

  const remove = (item: T) => {
    if (item === editing) clearForm();
    onChange(value.filter((p) => p !== item));
  };

  // A NEW row filled in but never "Add"ed would vanish when they navigate or
  // tap Next in the wizard. Commit it on unmount instead. (Re-keyed per folder,
  // so switching folders also flushes the pending row into the right one.) An
  // unsaved EDIT is discarded — we never silently overwrite the original.
  const latest = useRef({ name, price, composed, buildItem, value, onChange, editing });
  latest.current = { name, price, composed, buildItem, value, onChange, editing };
  useEffect(
    () => () => {
      const pending = latest.current;
      // A row named only by its folders counts as started once a price is in.
      const started = pending.name.trim() || (pending.composed && pending.price.trim());
      if (!pending.editing && started) {
        pending.onChange([...pending.value, pending.buildItem()]);
      }
    },
    [],
  );

  const placeLabel = path.length > 0 ? path[path.length - 1] : shelf.name;

  return (
    <View style={styles.composer}>
      {here.length > 0 ? (
        <Card style={styles.list}>
          {here.map((item, i) => {
            const isEditing = item === editing;
            return (
              <View
                key={`${item.name}-${i}`}
                style={[styles.itemRow, isEditing && { backgroundColor: colors.brandSoft }]}
              >
                {item.images?.[0] ? (
                  <Image source={{ uri: item.images[0] }} style={styles.thumb} resizeMode="cover" />
                ) : null}
                <View style={styles.itemInfo}>
                  <Text weight={isEditing ? 'semibold' : 'regular'}>{item.name}</Text>
                  {item.variants?.length ? (
                    <Text variant="caption" tone="muted">
                      {item.variants.join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {item.price ? (
                  <Text weight="semibold" tone="brand">
                    {item.price}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => startEdit(item)}
                  hitSlop={6}
                  accessibilityLabel={`Edit ${item.name}`}
                >
                  <Text tone="brand" weight="semibold">
                    ✏️
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => remove(item)}
                  hitSlop={6}
                  accessibilityLabel={`Remove ${item.name}`}
                >
                  <Text tone="danger" weight="semibold">
                    ✕
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Text variant="caption" tone="muted" style={styles.addingTo}>
        {editing ? 'Editing ' : 'Adding to '}
        <Text weight="semibold">{editing ? editing.name : placeLabel}</Text>
      </Text>

      {/* The specs of the thing — pick as many as describe it. */}
      {specs ? (
        <>
          <Text variant="label" weight="semibold" style={styles.folderLabel}>
            {specs.label}
          </Text>
          <View style={styles.folderRow}>
            {specOptions.map((spec) => (
              <Tag
                key={spec}
                label={spec}
                selected={variants.some((v) => same(v, spec))}
                onPress={() => toggleVariant(spec)}
              />
            ))}
            <Tag
              label="＋ Own"
              selected={customSpec !== null}
              onPress={() => setCustomSpec(customSpec === null ? '' : null)}
            />
          </View>
          {customSpec !== null ? (
            <View style={styles.newFolderRow}>
              <View style={styles.nameField}>
                <Input
                  placeholder="Your own size / spec"
                  value={customSpec}
                  onChangeText={setCustomSpec}
                  onSubmitEditing={commitCustomSpec}
                  autoFocus
                />
              </View>
              <Button title="Use" variant="secondary" onPress={commitCustomSpec} />
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.inputs}>
        <View style={styles.nameField}>
          <Input
            placeholder={
              composed ? 'Model (optional) — e.g. AR18BY5APWK' : `Name of the ${noun}`
            }
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

      {/* What the folders and specs have written, so the owner sees the name
          before the listing exists rather than after. */}
      {composed && !name.trim() ? (
        <Text variant="caption" tone="brand" style={styles.willBe}>
          Will be listed as “{composed}” — type a model above to say it differently.
        </Text>
      ) : null}

      <View style={styles.field}>
        <Input
          placeholder="Anything worth knowing — warranty, condition… (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </View>

      <PhotosField label="Photos (optional)" value={images} onChange={setImages} />

      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {editing ? (
        <View style={styles.editActions}>
          <View style={styles.editBtn}>
            <Button title="Cancel" variant="ghost" onPress={clearForm} />
          </View>
          <View style={styles.editBtnWide}>
            <Button title="Save changes" variant="secondary" onPress={add} />
          </View>
        </View>
      ) : (
        <Button title={`＋ Add ${noun}`} variant="secondary" onPress={add} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  shelfCard: { marginBottom: spacing.sm },
  shelfRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shelfOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shelfIcon: { fontSize: 22 },
  shelfInfo: { flex: 1 },
  addShelf: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: spacing.sm,
  },
  newShelfActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  newShelfButton: { flex: 1 },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.sm },
  crumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  crumbSep: { marginHorizontal: spacing.sm },
  folderLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  folderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  folderChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  addFolderInline: { paddingVertical: spacing.sm, marginBottom: spacing.sm },
  newFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  composer: { marginTop: spacing.sm },
  addingTo: { marginBottom: spacing.sm },
  list: { marginBottom: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  itemInfo: { flex: 1 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  inputs: { flexDirection: 'row', gap: spacing.md },
  nameField: { flex: 1 },
  priceField: { width: 90 },
  willBe: { marginTop: spacing.sm },
  field: { marginTop: spacing.sm, marginBottom: spacing.sm },
  error: { marginTop: spacing.sm, marginBottom: spacing.sm },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  editBtn: { flex: 1 },
  editBtnWide: { flex: 2 },
});
