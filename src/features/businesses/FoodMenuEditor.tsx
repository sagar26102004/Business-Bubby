/**
 * Menu builder for food businesses, driven by the prebuilt library in
 * domain/foodMenu.ts — the owner starts from ready-made sections instead of
 * inventing one, and starts from ready-made dishes instead of typing one out.
 *
 * The flow is folder-like, one level at a time: the sections list (with a
 * count of what's in each), tap one to open it, then EITHER add dishes right
 * here OR open a subcategory folder and add dishes inside it. Subcategories
 * NEST — "South Indian › Dosa › Plain" — and every level works the same way:
 * the dishes you see are only the ones at the folder you're standing in, so
 * finishing "Dosa" and opening "Uttapam" hides the dosas and shows an empty
 * Uttapam ready for its dishes.
 *
 * Dishes come from the catalog in domain/dishes.ts and surface ONLY as the
 * owner types — "pane" lists Paneer Butter Masala, Matar Paneer, Shahi Paneer…
 * Tapping one fills the name, description, photo and veg dot, leaving them just
 * the price to set. Anything the catalog doesn't know is still typed by hand.
 *
 * The library is a head start, not a cage: a restaurant with something it
 * misses (Chaat, Thali, Combos) adds its own section — and its own nested
 * subcategories inside any section — right here. Custom sections/folders are
 * not stored separately; they live on the MenuItems that carry them (the
 * category + the encoded subcategory path), so reopening the editor rebuilds
 * the whole tree from the menu.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { MenuItem } from '@/domain/types';
import {
  FOOD_MENU_SECTIONS,
  findFoodSection,
  isPathPrefix,
  joinSubcategoryPath,
  samePath,
  subcategoryPath,
  type FoodMenuSection,
} from '@/domain/foodMenu';
import { dishImage, dishSection, searchDishes, type Dish } from '@/domain/dishes';
import { Button, Card, Input, Text } from '@/components/ui';
import { PhotosField } from '@/features/media/PhotosField';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { radius, spacing, useColors } from '@/theme/theme';

/** "150" → "₹150"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

/** Custom top-level sections the owner invented, read back off their dishes. */
function deriveCustomSections(menu: MenuItem[]): FoodMenuSection[] {
  const sections: FoodMenuSection[] = [];
  for (const item of menu) {
    const category = item.category?.trim();
    if (!category) continue;
    if (findFoodSection(category)) continue;
    if (!sections.some((s) => s.name === category)) {
      sections.push({ id: `custom:${category}`, name: category, icon: '🍽️' });
    }
  }
  return sections;
}

export interface FoodMenuEditorProps {
  value: MenuItem[];
  onChange: (next: MenuItem[]) => void;
}

export function FoodMenuEditor({ value, onChange }: FoodMenuEditorProps) {
  const colors = useColors();
  const derived = useRef(deriveCustomSections(value)).current;
  const [customSections, setCustomSections] = useState<FoodMenuSection[]>(derived);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [newSection, setNewSection] = useState<string | null>(null);
  // Renaming a custom section (id + name), plus the in-progress text.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const sections = useMemo(
    () => [...FOOD_MENU_SECTIONS, ...customSections],
    [customSections],
  );
  const openSection = sections.find((s) => s.id === openSectionId) ?? null;

  const countIn = (section: FoodMenuSection) =>
    value.filter((m) => m.category === section.name).length;

  // Only sections the owner invented can be renamed — the library ones are
  // shared and canonical so every restaurant's menu reads the same.
  const isCustom = (s: FoodMenuSection) => s.id.startsWith('custom:');

  const startRename = (s: FoodMenuSection) => {
    setNewSection(null);
    setRenamingId(s.id);
    setRenameText(s.name);
  };

  const commitRename = (section: FoodMenuSection) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === section.name) return;
    // Don't let a rename silently merge into another section.
    if (sections.some((s) => s.id !== section.id && s.name.toLowerCase() === name.toLowerCase())) return;
    // The name lives on every dish in the section — move them all.
    onChange(value.map((m) => (m.category === section.name ? { ...m, category: name } : m)));
    setCustomSections((prev) =>
      prev.map((s) => (s.id === section.id ? { ...s, id: `custom:${name}`, name } : s)),
    );
  };

  const createSection = () => {
    const name = (newSection ?? '').trim();
    if (!name) return;
    const existing = sections.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // Don't fork "Soups" into a second "soups" — just open the one we have.
      setNewSection(null);
      setOpenSectionId(existing.id);
      return;
    }
    const section: FoodMenuSection = { id: `custom:${name}`, name, icon: '🍽️' };
    setCustomSections((prev) => [...prev, section]);
    setNewSection(null);
    setOpenSectionId(section.id);
  };

  if (openSection) {
    return (
      <SectionEditor
        section={openSection}
        value={value}
        onChange={onChange}
        onBack={() => setOpenSectionId(null)}
      />
    );
  }

  return (
    <View>
      <Text variant="caption" tone="muted" style={styles.hint}>
        Tap a section to add dishes to it. Skip any you don’t serve.
      </Text>
      {sections.map((section) => {
        const count = countIn(section);
        const subs = section.subcategories ?? [];
        if (renamingId === section.id) {
          return (
            <Card key={section.id} style={styles.sectionCard}>
              <Input
                placeholder="Section name"
                value={renameText}
                onChangeText={setRenameText}
                onSubmitEditing={() => commitRename(section)}
                autoFocus
              />
              <View style={styles.newSectionActions}>
                <View style={styles.newSectionButton}>
                  <Button title="Cancel" variant="ghost" onPress={() => setRenamingId(null)} />
                </View>
                <View style={styles.newSectionButton}>
                  <Button title="Save" variant="secondary" onPress={() => commitRename(section)} />
                </View>
              </View>
            </Card>
          );
        }
        return (
          <Card key={section.id} style={styles.sectionCard}>
            <View style={styles.sectionRow}>
              <Pressable
                onPress={() => setOpenSectionId(section.id)}
                accessibilityRole="button"
                style={styles.sectionOpen}
              >
                <Text style={styles.sectionIcon}>{section.icon}</Text>
                <View style={styles.sectionInfo}>
                  <Text weight="semibold">{section.name}</Text>
                  {count > 0 ? (
                    <Text variant="caption" tone="brand" weight="semibold">
                      {count} item{count === 1 ? '' : 's'} added
                    </Text>
                  ) : subs.length > 0 ? (
                    <Text variant="caption" tone="muted">
                      {subs.join(' · ')}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {isCustom(section) ? (
                <Pressable
                  onPress={() => startRename(section)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${section.name}`}
                >
                  <Text tone="brand" weight="semibold">
                    ✏️
                  </Text>
                </Pressable>
              ) : null}
              <Text tone="muted" onPress={() => setOpenSectionId(section.id)}>
                ›
              </Text>
            </View>
          </Card>
        );
      })}

      {newSection === null ? (
        <Pressable
          onPress={() => setNewSection('')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.addSection,
            { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text weight="semibold" tone="brand">
            ＋ Create a new section
          </Text>
        </Pressable>
      ) : (
        <Card style={styles.sectionCard}>
          <Input
            placeholder="Section name — e.g. Chaat, Thali, Combos"
            value={newSection}
            onChangeText={setNewSection}
            onSubmitEditing={createSection}
            autoFocus
          />
          <View style={styles.newSectionActions}>
            <View style={styles.newSectionButton}>
              <Button title="Cancel" variant="ghost" onPress={() => setNewSection(null)} />
            </View>
            <View style={styles.newSectionButton}>
              <Button title="Create" variant="secondary" onPress={createSection} />
            </View>
          </View>
        </Card>
      )}
    </View>
  );
}

/**
 * Add/remove dishes inside ONE section, navigating its nested subcategory
 * folders. The owner only ever sees one folder at a time: its child folders,
 * the dishes filed directly in it, and the form to add more.
 */
function SectionEditor({
  section,
  value,
  onChange,
  onBack,
}: {
  section: FoodMenuSection;
  value: MenuItem[];
  onChange: (next: MenuItem[]) => void;
  onBack: () => void;
}) {
  // Where in the subcategory tree we're standing (within this section).
  const [path, setPath] = useState<string[]>([]);
  // Folders the owner just created that don't hold a dish yet — kept so a fresh
  // empty folder doesn't vanish before they add anything to it. Stored as full
  // paths so nesting works.
  const [customFolders, setCustomFolders] = useState<string[][]>([]);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Renaming the subcategory folder we're standing in (its leaf segment).
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  const sectionItems = useMemo(
    () => value.filter((m) => m.category === section.name),
    [value, section.name],
  );

  // Dishes filed directly at the folder we're standing in.
  const here = sectionItems.filter((m) => samePath(subcategoryPath(m.subcategory), path));

  // The child folders visible at this level: library subcategories (only at the
  // section root), folders inferred from existing dishes, and freshly-created
  // empty ones.
  const childFolders = useMemo(() => {
    const names: string[] = [];
    const add = (name: string) => {
      if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    };
    if (path.length === 0) (section.subcategories ?? []).forEach(add);
    for (const m of sectionItems) {
      const p = subcategoryPath(m.subcategory);
      if (p.length > path.length && isPathPrefix(path, p)) add(p[path.length]);
    }
    for (const f of customFolders) {
      if (f.length === path.length + 1 && isPathPrefix(path, f)) add(f[path.length]);
    }
    return names;
  }, [section.subcategories, sectionItems, customFolders, path]);

  const descendantCount = (folderPath: string[]) =>
    sectionItems.filter((m) => isPathPrefix(folderPath, subcategoryPath(m.subcategory))).length;

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
    if (!customFolders.some((f) => samePath(f, full)) && !childFolders.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setCustomFolders((prev) => [...prev, full]);
    }
    setNewFolder(null);
    setPath(full);
  };

  // Rename the folder we're standing in — its name lives on every dish beneath
  // it (as one segment of the encoded path), so rewrite them all, then follow
  // the rename so we stay put.
  const commitFolderRename = () => {
    const name = renameText.trim();
    const depth = path.length - 1;
    setRenaming(false);
    if (depth < 0 || !name || name === path[depth]) return;
    const parent = path.slice(0, depth);
    const belongs = (p: string[]) => p.length > depth && isPathPrefix(parent, p) && p[depth] === path[depth];
    const rewrite = (p: string[]) => {
      const next = [...p];
      next[depth] = name;
      return next;
    };
    onChange(
      value.map((m) => {
        if (m.category !== section.name) return m;
        const p = subcategoryPath(m.subcategory);
        return belongs(p) ? { ...m, subcategory: joinSubcategoryPath(rewrite(p)) } : m;
      }),
    );
    setCustomFolders((prev) => prev.map((f) => (belongs(f) ? rewrite(f) : f)));
    setPath([...parent, name]);
  };

  return (
    <View>
      <SectionBreadcrumb section={section} path={path} onNavigate={goToDepth} onExit={onBack} />

      {path.length > 0 ? (
        renaming ? (
          <View style={styles.newSubRow}>
            <View style={styles.nameField}>
              <Input
                placeholder="Subcategory name"
                value={renameText}
                onChangeText={setRenameText}
                onSubmitEditing={commitFolderRename}
                autoFocus
              />
            </View>
            <Button title="Save" variant="secondary" onPress={commitFolderRename} />
            <Button title="Cancel" variant="ghost" onPress={() => setRenaming(false)} />
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setRenameText(path[path.length - 1]);
              setRenaming(true);
            }}
            accessibilityRole="button"
            style={styles.renameFolder}
          >
            <Text tone="brand" weight="semibold">
              ✏️ Rename “{path[path.length - 1]}”
            </Text>
          </Pressable>
        )
      ) : null}

      {/* Child subcategory folders — tap to go inside; the same pattern repeats
          at every depth. */}
      {childFolders.length > 0 || newFolder !== null ? (
        <FolderRow
          folders={childFolders}
          count={(name) => descendantCount([...path, name])}
          onOpen={openFolder}
          newFolder={newFolder}
          onStartNew={() => setNewFolder('')}
          onChangeNew={setNewFolder}
          onCommitNew={createFolder}
          sectionName={section.name}
          depth={path.length}
        />
      ) : (
        <Pressable
          onPress={() => setNewFolder('')}
          accessibilityRole="button"
          style={styles.addFolderInline}
        >
          <Text weight="semibold" tone="brand">
            ＋ Add a subcategory{path.length > 0 ? ' inside this one' : ''}
          </Text>
        </Pressable>
      )}

      <DishEditor
        key={path.join('›') || 'root'}
        section={section}
        path={path}
        here={here}
        value={value}
        onChange={onChange}
      />
    </View>
  );
}

/** Section title + a tappable breadcrumb of the folders you've opened. */
function SectionBreadcrumb({
  section,
  path,
  onNavigate,
  onExit,
}: {
  section: FoodMenuSection;
  path: string[];
  onNavigate: (depth: number) => void;
  onExit: () => void;
}) {
  return (
    <View>
      <Pressable onPress={onExit} style={styles.back} accessibilityRole="button">
        <Text weight="semibold" tone="brand">
          ‹ All sections
        </Text>
      </Pressable>

      <View style={styles.crumbRow}>
        <Pressable onPress={() => onNavigate(0)} accessibilityRole="button">
          <Text variant="subheading" weight="bold">
            {section.icon} {section.name}
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

/** The row of subcategory-folder chips at the current level, plus "add one". */
function FolderRow({
  folders,
  count,
  onOpen,
  newFolder,
  onStartNew,
  onChangeNew,
  onCommitNew,
  sectionName,
  depth,
}: {
  folders: string[];
  count: (name: string) => number;
  onOpen: (name: string) => void;
  newFolder: string | null;
  onStartNew: () => void;
  onChangeNew: (v: string) => void;
  onCommitNew: () => void;
  sectionName: string;
  depth: number;
}) {
  const colors = useColors();
  return (
    <>
      <Text variant="label" weight="semibold" style={styles.subLabel}>
        Subcategories {depth > 0 ? '(nested)' : '(optional)'}
      </Text>
      <View style={styles.subRow}>
        {folders.map((name) => (
          <Pressable
            key={name}
            onPress={() => onOpen(name)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.subChip,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text weight="semibold">
              {name}
              {count(name) > 0 ? (
                <Text tone="muted"> · {count(name)}</Text>
              ) : null}{' '}
              ›
            </Text>
          </Pressable>
        ))}
        {newFolder === null ? (
          <Pressable
            onPress={onStartNew}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.subChip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderStyle: 'dashed',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text weight="semibold" tone="brand">
              ＋ New subcategory
            </Text>
          </Pressable>
        ) : null}
      </View>

      {newFolder !== null ? (
        <View style={styles.newSubRow}>
          <View style={styles.nameField}>
            <Input
              placeholder={
                depth > 0
                  ? 'Nested kind — e.g. Plain, Masala'
                  : `Kind of ${sectionName.toLowerCase()} — e.g. Dosa, Uttapam`
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

/** The list of dishes at the current folder + the form to add another. */
function DishEditor({
  section,
  path,
  here,
  value,
  onChange,
}: {
  section: FoodMenuSection;
  path: string[];
  here: MenuItem[];
  value: MenuItem[];
  onChange: (next: MenuItem[]) => void;
}) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isVeg, setIsVeg] = useState<boolean | undefined>();
  // The dish being edited in place, or null when the form adds a new one.
  const [editing, setEditing] = useState<MenuItem | null>(null);
  // Why: a silently disabled Add button reads as broken — keep it tappable and
  // say what's missing instead.
  const [error, setError] = useState<string | null>(null);

  // Suggestions hide the moment one is taken — otherwise the picked dish keeps
  // matching itself and the list sits there under the field.
  const [picked, setPicked] = useState(false);
  const leaf = path[path.length - 1];
  const suggestions = useMemo(
    () => (picked ? [] : searchDishes(name, { sectionId: section.id, subcategory: leaf })),
    [picked, name, section.id, leaf],
  );

  const buildItem = (): MenuItem => ({
    name: name.trim(),
    price: toPriceLabel(price),
    description: description.trim() || undefined,
    category: section.name,
    subcategory: joinSubcategoryPath(path),
    imageUrl: imageUrl.trim() || undefined,
    isVeg,
  });

  const clearForm = () => {
    setName('');
    setPrice('');
    setDescription('');
    setImageUrl('');
    setIsVeg(undefined);
    setPicked(false);
    setEditing(null);
    setError(null);
  };

  const add = () => {
    if (!name.trim()) {
      setError('Type a dish name first — everything else is optional.');
      return;
    }
    if (editing) {
      // Replace the dish in place, keeping its position in the list.
      onChange(value.map((m) => (m === editing ? buildItem() : m)));
    } else {
      onChange([...value, buildItem()]);
    }
    clearForm();
  };

  /** Load a dish into the form to edit it (rather than add a new one). */
  const startEdit = (item: MenuItem) => {
    setEditing(item);
    setName(item.name);
    setPrice(item.price ? String(parsePrice(item.price) ?? '') : '');
    setDescription(item.description ?? '');
    setImageUrl(item.imageUrl ?? '');
    setIsVeg(item.isVeg);
    setPicked(true);
    setError(null);
  };

  /** Take a catalog dish whole — name, description, photo, veg dot. Price is theirs. */
  const pickDish = (dish: Dish) => {
    setName(dish.name);
    setDescription(dish.description);
    setImageUrl(dishImage(dish));
    setIsVeg(dish.isVeg);
    setPicked(true);
    setError(null);
  };

  // A NEW dish typed but never "Add"ed would vanish when they navigate or tap
  // Next in the wizard. Commit it on unmount instead. (Re-keyed per folder, so
  // switching folders also flushes the pending dish into the right one.) An
  // unsaved EDIT is discarded — we never silently overwrite the original.
  const latest = useRef({ name, buildItem, value, onChange, editing });
  latest.current = { name, buildItem, value, onChange, editing };
  useEffect(
    () => () => {
      const pending = latest.current;
      if (!pending.editing && pending.name.trim()) {
        pending.onChange([...pending.value, pending.buildItem()]);
      }
    },
    [],
  );

  const remove = (item: MenuItem) => {
    if (item === editing) clearForm();
    onChange(value.filter((m) => m !== item));
  };

  const placeLabel = path.length > 0 ? path[path.length - 1] : section.name;

  return (
    <View style={styles.dishBlock}>
      {here.length > 0 ? (
        <Card style={styles.list}>
          {here.map((item, i) => {
            const isEditing = item === editing;
            return (
              <View
                key={`${item.name}-${i}`}
                style={[styles.itemRow, isEditing && { backgroundColor: colors.brandSoft }]}
              >
                <VegDot isVeg={item.isVeg} />
                <View style={styles.itemInfo}>
                  <Text weight={isEditing ? 'semibold' : 'regular'}>{item.name}</Text>
                </View>
                {item.price ? (
                  <Text weight="semibold" tone="brand">
                    {item.price}
                  </Text>
                ) : null}
                <Pressable onPress={() => startEdit(item)} hitSlop={6} accessibilityLabel={`Edit ${item.name}`}>
                  <Text tone="brand" weight="semibold">
                    ✏️
                  </Text>
                </Pressable>
                <Pressable onPress={() => remove(item)} hitSlop={6} accessibilityLabel={`Remove ${item.name}`}>
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

      <View style={styles.inputs}>
        <View style={styles.nameField}>
          <Input
            placeholder="Type a dish — e.g. pane…"
            value={name}
            onChangeText={(t) => {
              setName(t);
              setPicked(false);
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

      {suggestions.length > 0 ? (
        <View
          style={[
            styles.suggestions,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          {suggestions.map((dish) => {
            const from = dish.sectionId === section.id ? undefined : dishSection(dish)?.name;
            return (
              <Pressable
                key={dish.id}
                onPress={() => pickDish(dish)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.suggestion, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Image source={{ uri: dishImage(dish) }} style={styles.suggestionPhoto} />
                <View style={styles.suggestionInfo}>
                  <View style={styles.suggestionName}>
                    <VegDot isVeg={dish.isVeg} />
                    <Text weight="semibold">{dish.name}</Text>
                    {from ? (
                      <Text variant="caption" tone="muted">
                        · {from}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {dish.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Input
        placeholder="Short description (optional)"
        value={description}
        onChangeText={setDescription}
        style={styles.field}
      />

      {/* Photos of the dish — take one now or pick from the gallery. Picking a
          catalog dish above pre-fills its stock photo; this replaces it. */}
      <PhotosField
        label="Dish photo (optional)"
        value={imageUrl ? [imageUrl] : []}
        onChange={(photos) => setImageUrl(photos[0] ?? '')}
        max={1}
      />

      <View style={styles.vegRow}>
        {[
          { label: 'Veg', veg: true },
          { label: 'Non-veg', veg: false },
        ].map((o) => {
          const selected = isVeg === o.veg;
          return (
            <Pressable
              key={o.label}
              onPress={() => setIsVeg(selected ? undefined : o.veg)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.vegChip,
                {
                  backgroundColor: colors.surface,
                  borderColor: selected ? (o.veg ? colors.success : colors.danger) : colors.border,
                  borderWidth: selected ? 1.5 : 1,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <VegDot isVeg={o.veg} />
              <Text weight={selected ? 'semibold' : 'regular'}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

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
        <Button title="Add dish" variant="secondary" onPress={add} />
      )}
    </View>
  );
}

/** The green/red square every Indian menu carries. */
export function VegDot({ isVeg }: { isVeg?: boolean }) {
  const colors = useColors();
  if (isVeg === undefined) return null;
  const color = isVeg ? colors.success : colors.danger;
  return (
    <View style={[styles.vegDot, { borderColor: color }]}>
      <View style={[styles.vegDotInner, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  sectionCard: { marginBottom: spacing.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionIcon: { fontSize: 22 },
  sectionInfo: { flex: 1 },
  addSection: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: spacing.sm,
  },
  newSectionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  newSectionButton: { flex: 1 },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.sm },
  crumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  crumbSep: { marginHorizontal: spacing.sm },
  subLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  subChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  addFolderInline: { paddingVertical: spacing.sm, marginBottom: spacing.sm },
  renameFolder: { paddingVertical: spacing.xs, marginBottom: spacing.sm },
  newSubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  dishBlock: { marginTop: spacing.sm },
  addingTo: { marginBottom: spacing.sm },
  list: { marginBottom: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  itemInfo: { flex: 1 },
  inputs: { flexDirection: 'row', gap: spacing.md },
  nameField: { flex: 1 },
  priceField: { width: 90 },
  suggestions: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  suggestionPhoto: { width: 44, height: 44, borderRadius: radius.sm },
  suggestionInfo: { flex: 1 },
  suggestionName: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  field: { marginTop: spacing.xs, marginBottom: spacing.sm },
  vegRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  vegChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  vegDot: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegDotInner: { width: 8, height: 8, borderRadius: 4 },
  error: { marginBottom: spacing.sm },
  editActions: { flexDirection: 'row', gap: spacing.sm },
  editBtn: { flex: 1 },
  editBtnWide: { flex: 2 },
});
