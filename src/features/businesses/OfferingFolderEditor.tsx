/**
 * Catalog builder for a business's SERVICES (and anything else shaped like a
 * priced list under a prebuilt library). It is the menu builder's flow applied
 * to work rather than food, and the twin of `GoodsEditor` for products — a
 * service list is browsed the way a menu is, so it is built the same way.
 *
 * The navigation is folder-like, one level at a time:
 *
 *   Section         Repairs                 -> ServiceItem.category
 *     Kind          Washing machine         -> ServiceItem.subcategory
 *       Own folder  Front load                 (nested inside it)
 *         the work  Drum repair, ₹1,200
 *
 * Folders NEST as deep as the owner wants — "Repairs › Washing machine › Front
 * load › Out of warranty" — exactly like the menu builder, and by the same
 * trick: the path is encoded into the item's single `subcategory` string
 * (`domain/subcategoryPath.ts`), so nothing downstream needs to know.
 *
 * Each level lists only what is filed AT it, so finishing the ACs and opening
 * Refrigerator hides them and shows an empty folder ready for its own. You can
 * stop early: a one-man electrician files "Visit charge" straight under Home
 * services without picking a kind.
 *
 * Inside a folder the library offers the JOBS people actually ask for there
 * (Repairs › AC → gas refill, servicing, PCB repair; Repairs › Mobile → screen
 * and battery replacement). Tapping one fills the name box and leaves the
 * cursor free — exactly how the dish catalog fills a menu row. It saves the
 * typing; it never decides the wording.
 *
 * Sections and kinds the library misses are typed in at their own level. They
 * are not stored separately — they live on the items that carry them, so
 * reopening the editor rebuilds the whole tree from the list.
 *
 * Each item also takes a PHOTO, the way a dish does — the catalog screen that
 * shows all four offering lists (`features/offerings/OfferingCatalog`) leads
 * every row with one, and a service list without photos reads as a wall of
 * placeholders next to a menu that has them. Pass `withPhoto={false}` for a
 * list where a picture would be noise.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { sectionFolders, type OfferingSection } from '@/domain/offeringSections';
import {
  isPathPrefix,
  joinSubcategoryPath,
  samePath,
  subcategoryPath,
} from '@/domain/subcategoryPath';
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

/** The least an item must be for this editor to file it. */
export interface FoldableOffering {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  /** Photo of the thing, the way a dish carries one. */
  imageUrl?: string;
  /** Browse-catalog id carried by the section (rentals). */
  subcategoryId?: string;
  /**
   * How this one is charged, when the editor is given `basisOptions` — a
   * rental's "per day" / "per month". Kept as a plain string here; the caller's
   * item type narrows it (RentalItem.basis is a RentalBasis).
   */
  basis?: string;
}

/** Sections the owner invented, read back off the items already listed. */
function deriveCustomSections(
  items: FoldableOffering[],
  library: OfferingSection[],
  icon: string,
): OfferingSection[] {
  const custom: OfferingSection[] = [];
  for (const item of items) {
    const name = item.category?.trim();
    if (!name) continue;
    if (library.some((s) => same(s.name, name))) continue;
    if (custom.some((s) => same(s.name, name))) continue;
    custom.push({ id: `custom:${name}`, name, icon });
  }
  return custom;
}

export interface OfferingFolderEditorProps<T extends FoldableOffering> {
  value: T[];
  onChange: (next: T[]) => void;
  /** The prebuilt library — SERVICE_SECTIONS, RENTAL_SECTIONS… */
  sections: OfferingSection[];
  /** What one entry is called: "service", "rental". */
  noun: string;
  /** Line above the section list. */
  hint?: string;
  /** Placeholder in the "create a new section" box. */
  newSectionPlaceholder?: string;
  /** Icon given to a section the owner invents. */
  customIcon?: string;
  /** Tap-to-fill suggestions for the folder being stood in. */
  jobsFor?: (section: OfferingSection, kind?: string) => string[];
  /** Heading over those suggestions. */
  jobsLabel?: string;
  /** Heading over the folder row — services group work, rentals group things. */
  folderLabel?: string;
  /** Example inside the "your own folder" box, e.g. "AC, Washing machine". */
  folderExample?: string;
  /** Show the optional multi-line description box. */
  withDescription?: boolean;
  descriptionPlaceholder?: string;
  /**
   * Show the photo picker. On by default — a service list is browsed the way a
   * menu is, and a photo of the work is what makes a row scannable.
   */
  withPhoto?: boolean;
  photoLabel?: string;
  /**
   * A single-select chip row on the composer that lands on the item's `basis` —
   * rentals use it for per day / per month, because one lister's flat is
   * monthly while their scooter is daily. Omit it and no row is shown.
   */
  basisOptions?: { id: string; label: string; icon?: string }[];
  /** Which chip a new item starts on (the business-wide default). */
  basisDefault?: string;
  basisLabel?: string;
}

export function OfferingFolderEditor<T extends FoldableOffering>({
  value,
  onChange,
  sections: library,
  noun,
  hint,
  newSectionPlaceholder = 'Section name',
  customIcon = '✨',
  jobsFor,
  jobsLabel = 'Common jobs — tap one to fill it in',
  folderLabel = 'What kind of work? (optional)',
  folderExample = 'AC, Washing machine',
  withDescription = false,
  descriptionPlaceholder = 'What’s included (optional)',
  withPhoto = true,
  photoLabel,
  basisOptions,
  basisDefault,
  basisLabel = 'How is it charged?',
}: OfferingFolderEditorProps<T>) {
  const colors = useColors();
  // Sections the owner made by hand that hold nothing YET — a freshly created
  // empty section would otherwise vanish before anything is filed in it. The
  // sections that DO hold items are re-derived from `value` every render, so a
  // list pasted in through the import panel shows its sections at once.
  const [ownSections, setOwnSections] = useState<OfferingSection[]>([]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [newSection, setNewSection] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const sections = useMemo(() => {
    const fromItems = deriveCustomSections(value, library, customIcon);
    const empty = ownSections.filter((own) => !fromItems.some((d) => same(d.name, own.name)));
    return [...library, ...fromItems, ...empty];
  }, [value, library, customIcon, ownSections]);
  const openSection = sections.find((s) => s.id === openSectionId) ?? null;

  const countIn = (section: OfferingSection) =>
    value.filter((item) => same(item.category, section.name)).length;

  // Only sections the owner invented can be renamed — the library ones are
  // shared and canonical so every business's list reads the same way.
  const isCustom = (s: OfferingSection) => s.id.startsWith('custom:');

  const startRename = (s: OfferingSection) => {
    setNewSection(null);
    setRenamingId(s.id);
    setRenameText(s.name);
  };

  const commitRename = (section: OfferingSection) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === section.name) return;
    // Don't let a rename silently merge into another section.
    if (sections.some((s) => s.id !== section.id && same(s.name, name))) return;
    // The name lives on every item in the section — move them all.
    onChange(value.map((i) => (same(i.category, section.name) ? { ...i, category: name } : i)));
    setOwnSections((prev) =>
      prev.map((s) => (s.id === section.id ? { ...s, id: `custom:${name}`, name } : s)),
    );
  };

  const createSection = () => {
    const name = (newSection ?? '').trim();
    if (!name) return;
    const existing = sections.find((s) => same(s.name, name));
    if (existing) {
      // Don't fork "Repairs" into a second "repairs" — open the one we have.
      setNewSection(null);
      setOpenSectionId(existing.id);
      return;
    }
    const section: OfferingSection = { id: `custom:${name}`, name, icon: customIcon };
    setOwnSections((prev) => [...prev, section]);
    setNewSection(null);
    setOpenSectionId(section.id);
  };

  if (openSection) {
    return (
      <SectionFolder
        section={openSection}
        value={value}
        onChange={onChange}
        noun={noun}
        jobsFor={jobsFor}
        jobsLabel={jobsLabel}
        folderLabel={folderLabel}
        folderExample={folderExample}
        withDescription={withDescription}
        descriptionPlaceholder={descriptionPlaceholder}
        withPhoto={withPhoto}
        photoLabel={photoLabel}
        basisOptions={basisOptions}
        basisDefault={basisDefault}
        basisLabel={basisLabel}
        onBack={() => setOpenSectionId(null)}
      />
    );
  }

  return (
    <View>
      {hint ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
      {sections.map((section) => {
        const count = countIn(section);
        const kinds = sectionFolders(section, []);
        if (renamingId === section.id) {
          return (
            <Card key={section.id} style={styles.sectionCard}>
              <Input
                placeholder={newSectionPlaceholder}
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
            placeholder={newSectionPlaceholder}
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
 * Add/remove items inside ONE section, walking its folders. The owner sees one
 * folder at a time: the folders inside it, the items filed directly in it, and
 * the form to add more. Folders nest without limit — the library's kinds sit at
 * the top level, and the owner's own folders go anywhere, at any depth.
 */
function SectionFolder<T extends FoldableOffering>({
  section,
  value,
  onChange,
  noun,
  jobsFor,
  jobsLabel,
  folderLabel,
  folderExample,
  withDescription,
  descriptionPlaceholder,
  withPhoto,
  photoLabel,
  basisOptions,
  basisDefault,
  basisLabel,
  onBack,
}: {
  section: OfferingSection;
  value: T[];
  onChange: (next: T[]) => void;
  noun: string;
  jobsFor?: (section: OfferingSection, kind?: string) => string[];
  jobsLabel: string;
  folderLabel: string;
  folderExample: string;
  withDescription: boolean;
  descriptionPlaceholder: string;
  withPhoto: boolean;
  photoLabel?: string;
  basisOptions?: { id: string; label: string; icon?: string }[];
  basisDefault?: string;
  basisLabel: string;
  onBack: () => void;
}) {
  // Where in the folder tree we're standing (within this section).
  const [path, setPath] = useState<string[]>([]);
  // Folders the owner just made that hold nothing yet — kept so a fresh empty
  // folder doesn't vanish before anything goes in it. Full paths, so nesting
  // works.
  const [customFolders, setCustomFolders] = useState<string[][]>([]);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Renaming the folder we're standing in (its leaf segment).
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  const sectionItems = useMemo(
    () => value.filter((i) => same(i.category, section.name)),
    [value, section.name],
  );

  // Items filed directly at the folder we're standing in.
  const here = sectionItems.filter((i) => samePath(subcategoryPath(i.subcategory), path));

  // The child folders at this level: the library's kinds (only at the section
  // root), folders inferred from items already listed, and freshly-created
  // empty ones.
  const childFolders = useMemo(() => {
    const names: string[] = [];
    const add = (name?: string) => {
      if (name && !names.some((n) => same(n, name))) names.push(name);
    };
    // The library's own folders at THIS depth — one level for a flat library
    // (a service section's kinds), a whole tree for property.
    sectionFolders(section, path).forEach(add);
    for (const item of sectionItems) {
      const p = subcategoryPath(item.subcategory);
      if (p.length > path.length && isPathPrefix(path, p)) add(p[path.length]);
    }
    for (const f of customFolders) {
      if (f.length === path.length + 1 && isPathPrefix(path, f)) add(f[path.length]);
    }
    return names;
  }, [section, sectionItems, customFolders, path]);

  const descendantCount = (folder: string[]) =>
    sectionItems.filter((i) => isPathPrefix(folder, subcategoryPath(i.subcategory))).length;

  const openFolder = (name: string) => {
    setNewFolder(null);
    setRenaming(false);
    setPath((p) => [...p, name]);
  };
  const goToDepth = (depth: number) => {
    setNewFolder(null);
    setRenaming(false);
    setPath((p) => p.slice(0, depth));
  };

  const createFolder = () => {
    const name = (newFolder ?? '').trim();
    if (!name) return;
    const full = [...path, name];
    if (!customFolders.some((f) => samePath(f, full)) && !childFolders.some((n) => same(n, name))) {
      setCustomFolders((prev) => [...prev, full]);
    }
    setNewFolder(null);
    setPath(full);
  };

  // Rename the folder we're standing in — its name lives on every item beneath
  // it (as one segment of the encoded path), so rewrite them all, then follow
  // the rename so we stay put.
  const commitRename = () => {
    const name = renameText.trim();
    const depth = path.length - 1;
    setRenaming(false);
    if (depth < 0 || !name || name === path[depth]) return;
    const parent = path.slice(0, depth);
    const belongs = (p: string[]) =>
      p.length > depth && isPathPrefix(parent, p) && same(p[depth], path[depth]);
    const rewrite = (p: string[]) => {
      const next = [...p];
      next[depth] = name;
      return next;
    };
    onChange(
      value.map((item) => {
        if (!same(item.category, section.name)) return item;
        const p = subcategoryPath(item.subcategory);
        return belongs(p) ? { ...item, subcategory: joinSubcategoryPath(rewrite(p)) } : item;
      }),
    );
    setCustomFolders((prev) => prev.map((f) => (belongs(f) ? rewrite(f) : f)));
    setPath([...parent, name]);
  };

  return (
    <View>
      <View>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text weight="semibold" tone="brand">
            ‹ All sections
          </Text>
        </Pressable>
        <View style={styles.crumbRow}>
          <Pressable onPress={() => goToDepth(0)} accessibilityRole="button">
            <Text variant="subheading" weight="bold">
              {section.icon} {section.name}
            </Text>
          </Pressable>
          {path.map((seg, i) => (
            <View key={`${seg}-${i}`} style={styles.crumbRow}>
              <Text tone="muted" style={styles.crumbSep}>
                ›
              </Text>
              <Pressable onPress={() => goToDepth(i + 1)} accessibilityRole="button">
                <Text variant="subheading" weight="bold">
                  {seg}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </View>

      {/* Rename the folder you're standing in — a typo in your own folder
          shouldn't mean re-filing everything inside it. */}
      {path.length > 0 ? (
        renaming ? (
          <View style={styles.newKindRow}>
            <View style={styles.nameField}>
              <Input
                placeholder="Folder name"
                value={renameText}
                onChangeText={setRenameText}
                onSubmitEditing={commitRename}
                autoFocus
              />
            </View>
            <Button title="Save" variant="secondary" onPress={commitRename} />
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

      {/* The folders inside this one — the same row repeats at every depth, so
          a kind holds your own folders and those hold more. */}
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
          folderLabel={folderLabel}
          folderExample={folderExample}
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

      <ItemComposer
        key={path.join('›') || 'root'}
        section={section}
        path={path}
        here={here}
        value={value}
        onChange={onChange}
        noun={noun}
        // Suggestions follow the KIND — the library's own level. Deeper folders
        // are the owner's, so they keep the kind's list rather than going empty.
        jobs={jobsFor?.(section, path[0]) ?? []}
        jobsLabel={jobsLabel}
        withDescription={withDescription}
        descriptionPlaceholder={descriptionPlaceholder}
        withPhoto={withPhoto}
        photoLabel={photoLabel}
        basisOptions={basisOptions}
        basisDefault={basisDefault}
        basisLabel={basisLabel}
      />
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
  sectionName,
  depth,
  folderLabel,
  folderExample,
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
  folderLabel: string;
  folderExample: string;
}) {
  const colors = useColors();
  return (
    <>
      <Text variant="label" weight="semibold" style={styles.kindLabel}>
        {depth === 0 ? folderLabel : 'Inside this one (optional)'}
      </Text>
      <View style={styles.kindRow}>
        {folders.map((name) => (
          <Pressable
            key={name}
            onPress={() => onOpen(name)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.kindChip,
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
              styles.kindChip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderStyle: 'dashed',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text weight="semibold" tone="brand">
              ＋ {depth === 0 ? 'New kind' : 'New subcategory'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {newFolder !== null ? (
        <View style={styles.newKindRow}>
          <View style={styles.nameField}>
            <Input
              placeholder={
                depth === 0
                  ? `Kind of ${sectionName.toLowerCase()} — e.g. ${folderExample}`
                  : 'Inside this one — e.g. a size, a floor, a condition'
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

/** The items at the current folder + the form to add another. */
function ItemComposer<T extends FoldableOffering>({
  section,
  path,
  here,
  value,
  onChange,
  noun,
  jobs,
  jobsLabel,
  withDescription,
  descriptionPlaceholder,
  withPhoto,
  photoLabel,
  basisOptions,
  basisDefault,
  basisLabel,
}: {
  section: OfferingSection;
  path: string[];
  here: T[];
  value: T[];
  onChange: (next: T[]) => void;
  noun: string;
  jobs: string[];
  jobsLabel: string;
  withDescription: boolean;
  descriptionPlaceholder: string;
  withPhoto: boolean;
  photoLabel?: string;
  basisOptions?: { id: string; label: string; icon?: string }[];
  basisDefault?: string;
  basisLabel: string;
}) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  // How this one is charged (rentals). Sticks between adds — a page of flats
  // is monthly all the way down — but every row keeps whatever it was given.
  const [basis, setBasis] = useState<string | undefined>(basisDefault);
  // The item being edited in place, or null when the form adds a new one.
  const [editing, setEditing] = useState<T | null>(null);
  // Why: a silently disabled Add button reads as broken — keep it tappable and
  // say what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const buildItem = (): T =>
    ({
      // Keep anything the composer doesn't own (an id a repository assigned).
      ...(editing ?? {}),
      name: name.trim(),
      price: toPriceLabel(price),
      description: withDescription ? description.trim() || undefined : editing?.description,
      imageUrl: withPhoto ? imageUrl.trim() || undefined : editing?.imageUrl,
      category: section.name,
      subcategory: joinSubcategoryPath(path),
      subcategoryId: section.subcategoryId,
      basis: basisOptions ? basis : editing?.basis,
    }) as T;

  const clearForm = () => {
    setName('');
    setPrice('');
    setDescription('');
    setImageUrl('');
    setEditing(null);
    setError(null);
  };

  const add = () => {
    if (!name.trim()) {
      setError(`Give the ${noun} a name first — tap a suggestion above or type one.`);
      return;
    }
    const built = buildItem();
    onChange(editing ? value.map((i) => (i === editing ? built : i)) : [...value, built]);
    clearForm();
  };

  /** Load an item into the form to edit it (rather than add a new one). */
  const startEdit = (item: T) => {
    setEditing(item);
    setName(item.name);
    setPrice(item.price ? String(parsePrice(item.price) ?? '') : '');
    setDescription(item.description ?? '');
    setImageUrl(item.imageUrl ?? '');
    if (basisOptions) setBasis(item.basis ?? basisDefault);
    setError(null);
  };

  const remove = (item: T) => {
    if (item === editing) clearForm();
    onChange(value.filter((i) => i !== item));
  };

  // A NEW row typed but never "Add"ed would vanish when they navigate or tap
  // Next in the wizard. Commit it on unmount instead. (Re-keyed per folder, so
  // switching folders also flushes the pending row into the right one.) An
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

  // A suggestion already listed here is done — don't offer it again.
  const suggestions = jobs.filter((job) => !here.some((i) => same(i.name, job)));

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
                <View style={styles.itemInfo}>
                  <Text weight={isEditing ? 'semibold' : 'regular'}>{item.name}</Text>
                  {item.basis && basisOptions ? (
                    <Text variant="caption" tone="brand">
                      {basisOptions.find((b) => b.id === item.basis)?.label ?? item.basis}
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
        <Text weight="semibold">
          {editing ? editing.name : (path[path.length - 1] ?? section.name)}
        </Text>
      </Text>

      {/* What people actually ask for here — tap to fill the name box. */}
      {suggestions.length > 0 && !editing ? (
        <>
          <Text variant="label" weight="semibold" style={styles.kindLabel}>
            {jobsLabel}
          </Text>
          <View style={styles.kindRow}>
            {suggestions.map((job) => (
              <Pressable
                key={job}
                onPress={() => {
                  setName(job);
                  setError(null);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.kindChip,
                  {
                    backgroundColor: same(name, job) ? colors.brandSoft : colors.surface,
                    borderColor: same(name, job) ? colors.brand : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text weight="semibold">{job}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {basisOptions ? (
        <>
          <Text variant="label" weight="semibold" style={styles.kindLabel}>
            {basisLabel}
          </Text>
          <View style={styles.kindRow}>
            {basisOptions.map((b) => (
              <Tag
                key={b.id}
                label={b.label}
                icon={b.icon}
                selected={basis === b.id}
                onPress={() => setBasis(b.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.inputs}>
        <View style={styles.nameField}>
          <Input
            placeholder={`Name of the ${noun}`}
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
        <View style={styles.field}>
          <Input
            placeholder={descriptionPlaceholder}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>
      ) : null}

      {/* A photo of the work or the thing — take one now or pick from the
          gallery, exactly as a dish photo is added. */}
      {withPhoto ? (
        <PhotosField
          label={photoLabel ?? `Photo of the ${noun} (optional)`}
          value={imageUrl ? [imageUrl] : []}
          onChange={(photos) => setImageUrl(photos[0] ?? '')}
          max={1}
        />
      ) : null}

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
  kindLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  kindChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  addFolderInline: { paddingVertical: spacing.sm, marginBottom: spacing.sm },
  renameFolder: { paddingVertical: spacing.xs, marginBottom: spacing.sm },
  newKindRow: {
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
  inputs: { flexDirection: 'row', gap: spacing.md },
  nameField: { flex: 1 },
  priceField: { width: 90 },
  field: { marginTop: spacing.sm, marginBottom: spacing.sm },
  error: { marginTop: spacing.sm, marginBottom: spacing.sm },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  editBtn: { flex: 1 },
  editBtnWide: { flex: 2 },
});
