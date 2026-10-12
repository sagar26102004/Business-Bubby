/**
 * Dedicated search screen (Amazon-style). Browse's search bar routes here;
 * this screen owns its own top bar — back button + autofocused input.
 *
 * People search three ways, often mixed — a business's NAME, a KIND of
 * business ("cafe", "plumber") or something it SELLS ("banana shake") — and
 * the ranking for all three lives in domain/search.ts (run by the database on
 * Supabase). Nothing here downloads the directory: suggestions and results
 * are each one small request.
 *
 * Typing shows debounced SUGGESTIONS, kinds of business first, each labelled
 * with what it is; a suggestion that is ONE business's name opens that
 * business directly. Submitting (enter, or tapping any other suggestion) runs
 * the search: best matches first, nearest first among equals, and each card
 * says which of its items matched.
 */
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SearchSuggestion, SearchTermKind } from '@/domain/search';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useResponsive } from '@/lib/useResponsive';
import { EmptyView, LoadingView, SearchIcon, Text } from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { radius, spacing, useColors } from '@/theme/theme';
import { isDemoViewer, isListedPublicly } from '@/lib/onHold';
import { NO_WEB_OUTLINE, fontFor } from '@/theme/fonts';

const MAX_SUGGESTIONS = 8;

/** What a suggestion IS, in words a customer reads. */
const KIND_LABEL: Record<SearchTermKind, string> = {
  type: 'Type of business',
  name: 'Business',
  item: 'Sold here',
  section: 'Category',
  about: '',
};

export default function SearchScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const dismiss = useDismiss('/');
  const insets = useSafeAreaInsets();
  const { cardColumns, gridMaxWidth, readableMaxWidth, centered } = useResponsive();

  // `?q=` pre-fills and runs a search.
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');
  /** The committed search term — set on enter or when a suggestion is tapped. */
  const [submitted, setSubmitted] = useState(q ?? '');
  const debounced = useDebouncedValue(query.trim(), 200);

  // Same key as Explore, so the location is already known on arrival.
  const { data: places } = useAsync(() => repos.places.listPlaces(), [], { key: 'places' });
  const near = places?.[0]?.point;
  const nearKey = near ? `${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : 'none';

  // Typing mode = the input differs from what was last searched.
  const isTyping = query.trim().length > 0 && query.trim() !== submitted;

  const { data: suggestions } = useAsync(
    () => repos.businesses.suggest(debounced, MAX_SUGGESTIONS),
    [debounced],
    {
      key: ['suggest', debounced.toLowerCase()],
      enabled: isTyping && debounced.length >= 2,
      refetchOnFocus: false,
      refetchOnForeground: false,
    },
  );

  const runSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setQuery(t);
    setSubmitted(t);
  };

  const pick = (s: SearchSuggestion) => {
    // One business's own name: the customer knows where they want to go.
    if (s.businessId) router.push(`/business/${s.businessId}`);
    else runSearch(s.term);
  };

  // Results load only for the committed term.
  const { data: found, loading } = useAsync(
    () => repos.businesses.search(submitted, { near }),
    [submitted, near?.latitude, near?.longitude],
    { key: ['search', submitted.toLowerCase(), nearKey, isDemoViewer()], enabled: !!submitted },
  );
  // ON HOLD (redesign 2026-10): stall — stall listings are hidden from public lists.
  const results = found?.filter((r) => isListedPublicly(r.business));

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
          onPress={dismiss}
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
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
            style={[styles.input, { color: colors.text }, fontFor('regular')]}
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
        <View style={centered(readableMaxWidth)}>
          <SuggestionRow
            label={`Search for “${query.trim()}”`}
            bold
            onPress={() => runSearch(query)}
          />
          {(debounced.length >= 2 ? suggestions ?? [] : [])
            .filter((s) => s.businessId || s.term.toLowerCase() !== query.trim().toLowerCase())
            .map((s) => (
              <SuggestionRow
                key={`${s.kind}:${s.term}:${s.businessId ?? ''}`}
                label={s.term}
                meta={suggestionMeta(s)}
                opens={!!s.businessId}
                onPress={() => pick(s)}
              />
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
          // Keyed to remount when the responsive column count changes.
          key={`cols-${cardColumns}`}
          data={results ?? []}
          keyExtractor={(r) => r.business.id}
          numColumns={cardColumns}
          columnWrapperStyle={cardColumns > 1 ? styles.column : undefined}
          renderItem={({ item }) => (
            <View style={cardColumns > 1 ? styles.gridItem : undefined}>
              <BusinessCard business={item.business} matches={item.hits} />
            </View>
          )}
          contentContainerStyle={[styles.list, centered(gridMaxWidth)]}
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

/** "Type of business · 556 places", "Business", "Sold here · 69 places". */
function suggestionMeta(s: SearchSuggestion): string {
  const what = KIND_LABEL[s.kind];
  if (s.businessId || s.businesses <= 1) return what;
  return `${what} · ${s.businesses} places`;
}

function SuggestionRow({
  label,
  meta,
  opens,
  onPress,
  bold,
}: {
  label: string;
  /** What the suggestion is — shown small under it. */
  meta?: string;
  /** Tapping opens a business page rather than running a search. */
  opens?: boolean;
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
      <View style={styles.suggestionText}>
        <Text weight={bold ? 'semibold' : 'regular'} numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text tone="muted" style={styles.suggestionArrow}>
        {opens ? '›' : '↖'}
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
  // The bar draws its own frame — no browser focus ring inside it on web.
  input: { flex: 1, height: 40, fontSize: 15, ...NO_WEB_OUTLINE },
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
  // Multi-column results grid on wide screens.
  column: { gap: spacing.md },
  gridItem: { flex: 1 },
});
