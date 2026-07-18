/**
 * Dedicated search screen (Amazon-style). Browse's search bar routes here;
 * this screen owns its own top bar — back button + autofocused input.
 *
 * Typing shows debounced SUGGESTIONS (terms drawn from real listings: business
 * names, products, menu items, services, categories — "cop" → "Copy pen", …).
 * Submitting (enter or tapping a suggestion) runs the search and lists the
 * matching businesses, nearest first.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSubcategory } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { EmptyView, LoadingView, SearchIcon, Text } from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { radius, spacing, useColors } from '@/theme/theme';

const MAX_SUGGESTIONS = 8;

export default function SearchScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  /** The committed search term — set on enter or when a suggestion is tapped. */
  const [submitted, setSubmitted] = useState('');
  const debounced = useDebouncedValue(query.trim(), 300);

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const near = places?.[0]?.point;

  // Suggestion corpus, built once from everything searchable across listings.
  const { data: corpus } = useAsync(async () => {
    const all = await repos.businesses.list();
    const terms = new Set<string>();
    const add = (s?: string) => {
      const t = s?.trim();
      if (t) terms.add(t);
    };
    all.forEach((b) => {
      add(b.name);
      add(b.providerType);
      add(getSubcategory(b.type, b.subcategoryId)?.name);
      (b.tags ?? []).forEach(add);
      (b.products ?? []).forEach((p) => add(p.name));
      (b.menu ?? []).forEach((m) => add(m.name));
      (b.services ?? []).forEach((s) => add(s.name));
    });
    return Array.from(terms);
  }, []);

  const suggestions = useMemo(() => {
    const t = debounced.toLowerCase();
    if (!t) return [];
    return (corpus ?? [])
      .filter((s) => s.toLowerCase().includes(t))
      .sort((a, b) => {
        // Prefix matches first (Amazon-style), then alphabetical.
        const ap = a.toLowerCase().startsWith(t) ? 0 : 1;
        const bp = b.toLowerCase().startsWith(t) ? 0 : 1;
        return ap - bp || a.localeCompare(b);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [corpus, debounced]);

  const runSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setQuery(t);
    setSubmitted(t);
  };

  // Results load only for the committed term.
  const { data: results, loading } = useAsync(
    async () =>
      submitted ? repos.businesses.list({ search: submitted, near, sortByDistance: true }) : null,
    [submitted, near?.latitude, near?.longitude],
  );

  // Typing mode = the input differs from what was last searched.
  const isTyping = query.trim().length > 0 && query.trim() !== submitted;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Own top bar: back + search input */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + spacing.sm,
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text weight="bold" tone="brand" style={styles.backChevron}>
            ‹
          </Text>
        </Pressable>
        <View style={[styles.searchBar, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <SearchIcon size={17} />
          <TextInput
            placeholder="Search businesses, services…"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query)}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: colors.text }]}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                setQuery('');
                setSubmitted('');
              }}
              hitSlop={8}
              accessibilityLabel="Clear search"
            >
              <Text tone="muted" weight="semibold">
                ✕
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {isTyping ? (
        /* Suggestions while typing (debounced), like Amazon's dropdown. */
        <View>
          <SuggestionRow
            label={`Search for “${query.trim()}”`}
            bold
            onPress={() => runSearch(query)}
          />
          {suggestions
            .filter((s) => s.toLowerCase() !== query.trim().toLowerCase())
            .map((s) => (
              <SuggestionRow key={s} label={s} onPress={() => runSearch(s)} />
            ))}
        </View>
      ) : !submitted ? (
        <EmptyView
          title="What are you looking for?"
          subtitle="Search shops, services, rentals, and items for sale near you."
        />
      ) : loading && !results ? (
        <LoadingView label="Searching…" />
      ) : (results?.length ?? 0) === 0 ? (
        <EmptyView title="No results" subtitle={`Nothing matched “${submitted}”. Try another word.`} />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BusinessCard business={item} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text variant="caption" tone="muted" style={styles.count}>
              {results!.length} result{results!.length === 1 ? '' : 's'} for “{submitted}”
            </Text>
          }
        />
      )}
    </View>
  );
}

function SuggestionRow({
  label,
  onPress,
  bold,
}: {
  label: string;
  onPress: () => void;
  bold?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.suggestion,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceAlt },
      ]}
      accessibilityRole="button"
    >
      <SearchIcon size={14} />
      <Text weight={bold ? 'semibold' : 'regular'} numberOfLines={1} style={styles.suggestionText}>
        {label}
      </Text>
      <Text tone="muted" style={styles.suggestionArrow}>
        ↖
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: { fontSize: 22, marginTop: -2 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, height: 40, fontSize: 15 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: { flex: 1 },
  suggestionArrow: { fontSize: 14 },
  list: { padding: spacing.lg },
  count: { marginBottom: spacing.md },
});
