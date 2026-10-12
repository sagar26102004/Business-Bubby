/**
 * SEARCH — what a query means and how results are ranked.
 *
 * People search three ways, often mixed: a business's NAME ("Sharma Sweets"),
 * a KIND of business ("cafe", "plumber") and something it SELLS ("banana
 * shake"). Every business is turned into TERMS, each with a kind:
 *
 *   name    — the business name                              weight 10
 *   type    — its tags, provider type, subcategory           weight  7
 *   item    — every dish / product / service / plan / rental weight  5
 *   section — the folders those items are filed in, brands   weight  3
 *   about   — tagline, description                           weight  1
 *
 * Each query word is matched on its own, the business keeping its best hit per
 * word: weight × quality, where quality is exact 1 · a whole word 0.9 · starts
 * with 0.8 · a word starts with 0.7 · contains 0.5 · a typo 0.45 (edit
 * distance 1, or 2 in words of 7+ letters, same first letter). A single term
 * holding several of the words — or the whole query — earns a phrase bonus.
 *
 * Results are ordered by `compareSearchResults`: most query words matched,
 * then the kind of the strongest hit (`tier`), then whole-word over partial
 * (`strength`), then NEAREST — because among equally good answers, the one
 * down the road is the one a local customer wants.
 *
 * The Supabase backend runs this in SQL (migration 0027: `search_terms`,
 * `search_businesses`, `search_suggest`); `scoreBusinesses`/`suggestTerms`
 * below are the same rules in TypeScript, used by the mock. Change the
 * weights in BOTH places.
 */
import type { Business } from './types';
import { INTENT_CATEGORIES, intentMatches, type IntentCategory } from './intents';

export type SearchTermKind = 'name' | 'type' | 'item' | 'section' | 'about';

/** An item of the business that matched, shown on its card ("Banana Shake ₹120"). */
export interface SearchHitItem {
  name: string;
  price?: string;
}

export interface SearchResult {
  business: Business;
  /** How many of the query's words this business matched. */
  words: number;
  /** Strongest hit: 4 name (every word) · 3 name/type · 2 item · 1 section · 0 about. */
  tier: number;
  /** 2 every word matched a whole word · 1 only word starts · 0 looser. */
  strength: number;
  score: number;
  /** Matching items, best first (at most 3). */
  hits: SearchHitItem[];
}

export interface SearchSuggestion {
  term: string;
  kind: SearchTermKind;
  /** How many businesses carry this term. */
  businesses: number;
  /** Set when the term is ONE business's name — tapping can open its page. */
  businessId?: string;
}

const WEIGHT: Record<SearchTermKind, number> = { name: 10, type: 7, item: 5, section: 3, about: 1 };
const TIER: Record<SearchTermKind, number> = { name: 3, type: 3, item: 2, section: 1, about: 0 };

/** The query's words: lower-case, punctuation dropped, 2+ letters, unique. */
export function queryWords(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return [...new Set(words)];
}

/** The whole query, normalised for phrase matching. */
const wholeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Order two results: words, tier, strength, then nearest, then score. */
export function compareSearchResults(a: SearchResult, b: SearchResult): number {
  return (
    b.words - a.words ||
    b.tier - a.tier ||
    b.strength - a.strength ||
    (a.business.distanceKm ?? Infinity) - (b.business.distanceKm ?? Infinity) ||
    b.score - a.score
  );
}

/**
 * The browse category a query names, if any — "food", "Home services" — so a
 * search for one returns its whole bundle of tags (domain/intents.ts) and not
 * only businesses that happen to have the word in them. A partial word counts
 * once it's 3 letters ("hea" → Health).
 */
export function intentForQuery(q: string): IntentCategory | undefined {
  const w = wholeQuery(q);
  if (w.length < 3) return undefined;
  return (
    INTENT_CATEGORIES.find((c) => c.label.toLowerCase() === w) ??
    INTENT_CATEGORIES.find((c) => c.label.toLowerCase().startsWith(w))
  );
}

/**
 * Fold in every business of the category the query names, ranked as a full
 * TYPE match. Businesses already found keep their own (better-informed) row.
 */
export function withIntentMatches(
  results: SearchResult[],
  cards: Business[],
  q: string,
): SearchResult[] {
  const intent = intentForQuery(q);
  if (!intent) return results;
  const seen = new Set(results.map((r) => r.business.id));
  const words = Math.max(1, queryWords(q).length);
  const extra = cards
    .filter((b) => !seen.has(b.id) && intentMatches(b, intent))
    .map((business) => ({ business, words, tier: 3, strength: 2, score: WEIGHT.type, hits: [] }));
  return [...results, ...extra];
}

// ── The TypeScript twin of migration 0027 (used by the mock backend) ──────

interface Term {
  kind: SearchTermKind;
  term: string;
  lower: string;
  price?: string;
}

/** Every searchable term of a business — the `search_terms` rows. */
export function searchTerms(b: Business): Term[] {
  const out = new Map<string, Term>();
  const add = (kind: SearchTermKind, raw?: string, price?: string) => {
    const term = raw?.trim();
    if (!term || term.length < 2 || term.length > 120) return;
    const key = `${kind}|${term.toLowerCase()}`;
    const had = out.get(key);
    if (!had || (!had.price && price)) out.set(key, { kind, term, lower: term.toLowerCase(), price });
  };
  add('name', b.name);
  add('type', b.providerType);
  (b.tags ?? []).forEach((t) => add('type', t));
  add('type', b.subcategoryId?.replace(/-/g, ' '));
  add('about', b.tagline);
  add('about', b.description);
  const items: { name: string; price?: string; category?: string; subcategory?: string; brand?: string }[] = [
    ...(b.menu ?? []),
    ...(b.products ?? []),
    ...(b.services ?? []),
    ...(b.plans ?? []),
    ...(b.rentals ?? []),
  ];
  for (const it of items) {
    add('item', it.name, it.price || undefined);
    add('section', it.category);
    add('section', it.brand);
    (it.subcategory ?? '').split(' › ').forEach((s) => add('section', s));
  }
  return [...out.values()];
}

/** Classic edit distance (insert / delete / substitute). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** How well one query word matches one term (0 = not at all). */
function quality(term: string, word: string): number {
  if (term === word) return 1;
  const w = escapeRe(word);
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, 'u').test(term)) return 0.9;
  if (term.startsWith(word)) return 0.8;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${w}`, 'u').test(term)) return 0.7;
  if (term.includes(word)) return 0.5;
  if (word.length >= 4) {
    const allowed = word.length >= 7 ? 2 : 1;
    const typo = term
      .split(/[^\p{L}\p{N}]+/u)
      .some((t) => t.length >= 3 && t[0] === word[0] && levenshtein(t.slice(0, 64), word) <= allowed);
    if (typo) return 0.45;
  }
  return 0;
}

/** Rank businesses for a query — the mock's `search_businesses`. */
export function scoreBusinesses(all: Business[], q: string, max = 100): SearchResult[] {
  const words = queryWords(q);
  if (words.length === 0) return [];
  const whole = wholeQuery(q);
  const typeQuery = all.some((b) => searchTerms(b).some((t) => t.kind === 'type' && t.lower === whole));

  const results: SearchResult[] = [];
  for (const business of all) {
    const terms = searchTerms(business);
    const best = new Map<string, { kind: SearchTermKind; pts: number; q: number }>();
    const itemPts = new Map<string, { pts: number; price?: string }>();
    let bonus = 0;
    for (const t of terms) {
      let matched = 0;
      for (const w of words) {
        const qv = quality(t.lower, w);
        if (qv === 0) continue;
        matched++;
        const pts = WEIGHT[t.kind] * qv;
        const cur = best.get(w);
        if (!cur || pts > cur.pts) best.set(w, { kind: t.kind, pts, q: qv });
        if (t.kind === 'item') {
          const hit = itemPts.get(t.term) ?? { pts: 0, price: t.price };
          hit.pts += pts;
          itemPts.set(t.term, hit);
        }
      }
      if (matched > 1) {
        const phrase =
          words.length > 1
            ? t.lower === whole
              ? 1
              : t.lower.startsWith(whole)
                ? 0.6
                : t.lower.includes(whole)
                  ? 0.4
                  : 0
            : 0;
        bonus = Math.max(bonus, WEIGHT[t.kind] * ((matched - 1) * 0.5 + phrase));
      }
    }
    if (best.size === 0) continue;
    const hits = [...best.values()];
    const allName = hits.every((h) => h.kind === 'name');
    const minQ = Math.min(...hits.map((h) => h.q));
    results.push({
      business,
      words: best.size,
      tier: allName && best.size === words.length && !typeQuery ? 4 : Math.max(...hits.map((h) => TIER[h.kind])),
      strength: minQ >= 0.9 ? 2 : minQ >= 0.7 ? 1 : 0,
      score: hits.reduce((s, h) => s + h.pts, 0) + bonus,
      hits: [...itemPts.entries()]
        .sort((a, b) => b[1].pts - a[1].pts || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([name, h]) => ({ name, price: h.price })),
    });
  }
  return results.sort((a, b) => b.words - a.words || b.score - a.score).slice(0, max);
}

/** As-you-type suggestions — the mock's `search_suggest`. */
export function suggestTerms(all: Business[], q: string, max = 8): SearchSuggestion[] {
  const n = wholeQuery(q);
  if (n.length < 2) return [];
  const order: Record<SearchTermKind, number> = { type: 0, name: 1, item: 2, section: 3, about: 4 };
  const groups = new Map<string, { term: string; kind: SearchTermKind; ids: Set<string>; how: number }>();
  for (const b of all) {
    for (const t of searchTerms(b)) {
      if (t.kind === 'about') continue;
      const how = t.lower.startsWith(n)
        ? 0
        : t.lower.includes(` ${n}`)
          ? 1
          : t.lower.includes(n)
            ? 2
            : !n.includes(' ') && quality(t.lower, n) === 0.45
              ? 3
              : -1;
      if (how < 0) continue;
      const g = groups.get(t.lower) ?? { term: t.term, kind: t.kind, ids: new Set<string>(), how };
      if (order[t.kind] < order[g.kind]) g.kind = t.kind;
      g.how = Math.min(g.how, how);
      g.ids.add(b.id);
      groups.set(t.lower, g);
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.how - b.how ||
        order[a.kind] - order[b.kind] ||
        b.ids.size - a.ids.size ||
        a.term.length - b.term.length ||
        a.term.localeCompare(b.term),
    )
    .slice(0, max)
    .map((g) => ({
      term: g.term,
      kind: g.kind,
      businesses: g.ids.size,
      businessId: g.kind === 'name' && g.ids.size === 1 ? [...g.ids][0] : undefined,
    }));
}

/**
 * The browse category the text is the start of, as a suggestion ("foo" →
 * Food). Listed first: it stands for a whole shelf of tags.
 */
export function intentSuggestion(q: string, cards: Business[]): SearchSuggestion | undefined {
  const intent = intentForQuery(q);
  if (!intent) return undefined;
  const count = cards.filter((b) => intentMatches(b, intent)).length;
  return count > 0 ? { term: intent.label, kind: 'type', businesses: count } : undefined;
}
