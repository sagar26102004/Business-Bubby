/**
 * Paste a whole menu / product list / service list in one go.
 *
 * Tapping out sixty dishes through the folder editor is the single most tedious
 * part of registering a business, and most owners already HAVE the list — in a
 * Word file, a WhatsApp message, a printed card someone typed up. This turns
 * that into a paste.
 *
 * ── The format ───────────────────────────────────────────────────────────────
 * Nesting is the whole idea: braces inside braces are folders inside folders,
 * and the innermost name is the thing itself.
 *
 *   Beverages: { Cold: { Shake: { Banana: 120, Mango: 130 },
 *                        Mojito: { Virgin Mojito: 150 } } }
 *
 * gives Beverages › Cold › Shake › Banana ₹120 — the same tree the editor
 * builds by hand, filed exactly the same way (top level = the section, every
 * level below = the nested subcategory path, leaf = the item).
 *
 * It reads strict JSON, and it also reads the shorthand people actually type:
 * unquoted names ("Virgin Mojito" needs no quotes), newlines instead of commas,
 * trailing commas, a name with no value at all (`{ Banana, Mango }` = two items
 * with no price yet), and a list in brackets (`Snacks: [Fries, Samosa]`).
 *
 * A value that is money becomes the price (`120`, `₹120`, `Rs 1,250`,
 * `₹99/plate`); any other plain text becomes the description. When that guess
 * isn't good enough, spell it out — an object of KNOWN keys is an item, not a
 * folder:
 *
 *   "Banana Shake": { price: 120, description: "Thick, no ice", veg: true }
 *
 * ── Why hand-written and not JSON.parse ──────────────────────────────────────
 * `JSON.parse` rejects every one of the conveniences above, and its errors
 * ("Unexpected token } in JSON at position 214") are useless to a shop owner.
 * This parser accepts the shorthand and reports "Line 7: …" instead.
 */
import type { MenuItem, ProductItem, RentalBasis, RentalItem, ServiceItem } from '@/domain/types';
import { findFoodSection } from '@/domain/foodMenu';
import { findProductCategory } from '@/domain/goods';
import { RENTAL_SECTIONS, SERVICE_SECTIONS, findSection } from '@/domain/offeringSections';
import { joinSubcategoryPath } from '@/domain/subcategoryPath';
import { formatMoney, parsePrice } from '@/lib/money';

/** Anything deeper than this is a paste gone wrong, not a catalog. */
const MAX_DEPTH = 8;
/** Enough for the longest real menu; a runaway paste stops here. */
const MAX_ITEMS = 1000;

/** One row the import produced, before it becomes a MenuItem/ProductItem/… */
export interface ImportedOffering {
  name: string;
  /** Already formatted — "₹120". */
  price?: string;
  description?: string;
  /** The top-level section it was filed under. */
  category?: string;
  /** Folder segments below the category: `["Cold", "Shake"]`. */
  path: string[];
  isVeg?: boolean;
  imageUrl?: string;
  brand?: string;
  basis?: string;
}

/** What a parse produced: the rows, plus the shape of the tree for the preview. */
export interface ImportSummary {
  rows: ImportedOffering[];
  /** Distinct top-level sections. */
  sections: string[];
  /** Deepest folder nesting found, for the "looks right?" line. */
  depth: number;
}

/** A parse that failed, with the line to look at. */
export class ImportError extends Error {}

/* ────────────────────────────── tokenizer ────────────────────────────────── */

type TokenType = '{' | '}' | '[' | ']' | ':' | ',' | 'newline' | 'text' | 'end';

interface Token {
  type: TokenType;
  /** For `text`: the word itself, already trimmed and unquoted. */
  value: string;
  /** Whether a `text` token arrived in quotes — quoted text is never a number. */
  quoted: boolean;
  line: number;
}

const STRUCTURAL = new Set(['{', '}', '[', ']', ':', ',']);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (type: TokenType, value = '', quoted = false) =>
    tokens.push({ type, value, quoted, line });

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      push('newline');
      line += 1;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (STRUCTURAL.has(ch)) {
      push(ch as TokenType);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '“' || ch === '‘') {
      // Smart quotes come along for the ride: text pasted out of Word is full
      // of them, and refusing it would send the owner back to the keyboard.
      const closers =
        ch === '“' ? '”' : ch === '‘' ? '’' : ch;
      let out = '';
      i += 1;
      while (i < source.length && source[i] !== closers) {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1];
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (source[i] === '\n') line += 1;
        out += source[i];
        i += 1;
      }
      if (i >= source.length) throw new ImportError(`Line ${line}: a quote is never closed.`);
      i += 1; // closing quote
      push('text', out.trim(), true);
      continue;
    }

    // A bare word runs to the next structural character or end of line, so
    // "Virgin Mojito" stays one name without anybody quoting it.
    let out = '';
    while (i < source.length && source[i] !== '\n' && !STRUCTURAL.has(source[i])) {
      out += source[i];
      i += 1;
    }
    const trimmed = out.trim();
    if (trimmed) push('text', trimmed, false);
  }
  push('end');
  return tokens;
}

/* ─────────────────────────────── parser ──────────────────────────────────── */

/**
 * A node of the pasted tree: either a folder (has `children`) or an item.
 * Exported so the preview can show the tree before anything is committed.
 */
export interface ImportNode {
  name: string;
  children?: ImportNode[];
  /** Item details, when this is a leaf. */
  price?: string;
  description?: string;
  isVeg?: boolean;
  imageUrl?: string;
  brand?: string;
  basis?: string;
}

/** The item detail a known key sets. */
type ItemField = 'price' | 'description' | 'imageUrl' | 'brand' | 'basis' | 'veg';

/** Keys that mean "this object describes ONE item", not a folder of items. */
const ITEM_KEYS: Record<string, ItemField> = {
  price: 'price',
  cost: 'price',
  rate: 'price',
  amount: 'price',
  mrp: 'price',
  description: 'description',
  desc: 'description',
  details: 'description',
  about: 'description',
  veg: 'veg',
  isveg: 'veg',
  photo: 'imageUrl',
  image: 'imageUrl',
  imageurl: 'imageUrl',
  img: 'imageUrl',
  brand: 'brand',
  make: 'brand',
  basis: 'basis',
  per: 'basis',
};

const normalizeKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Money, or prose? `120`, `₹120`, `Rs 1,250`, `₹99/plate` are prices; anything
 * else with words in it is a description. Kept deliberately strict — guessing
 * that "Serves 2" is a price would be worse than not guessing at all.
 */
function looksLikePrice(text: string): boolean {
  return /^\s*(?:₹|rs\.?|inr|\$)?\s*\d[\d,]*(?:\.\d+)?\s*(?:\/\s*[a-z ]{1,12})?\s*$/i.test(text);
}

/** "120" → "₹120"; "₹99/plate" is kept as the seller wrote it. */
function toPriceLabel(text: string): string | undefined {
  const bare = /^\s*(?:₹|rs\.?|inr|\$)?\s*[\d,]+(?:\.\d+)?\s*$/i.test(text);
  if (!bare) return text.trim() || undefined;
  const amount = parsePrice(text);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

/** True for the words people write when they mean "nothing here". */
const isBlank = (text: string) => /^(null|nil|none|-|—|n\/a)$/i.test(text.trim());

function parseBoolean(text: string): boolean | undefined {
  // `veg: 1` reaches here as "₹1", because the value parser saw a number and
  // called it a price — strip the symbol back off before reading it.
  const word = text.replace(/[₹$]/g, '').trim();
  if (/^(true|yes|y|veg|1)$/i.test(word)) return true;
  if (/^(false|no|n|non-?veg|0)$/i.test(word)) return false;
  return undefined;
}

class Parser {
  private at = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.at];
  }

  /** Newlines and commas are only ever separators — both are optional. */
  private skipBreaks() {
    while (this.peek().type === 'newline' || this.peek().type === ',') this.at += 1;
  }

  private take(): Token {
    return this.tokens[this.at++];
  }

  private expect(type: TokenType, what: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ImportError(`Line ${token.line}: expected ${what}.`);
    }
    return this.take();
  }

  /** The whole paste: an outer `{…}` if they wrote one, otherwise a bare list. */
  parseDocument(): ImportNode[] {
    this.skipBreaks();
    if (this.peek().type === '{') {
      this.take();
      const nodes = this.parseEntries('}', 0);
      this.expect('}', 'a closing }');
      this.skipBreaks();
      if (this.peek().type !== 'end') {
        throw new ImportError(`Line ${this.peek().line}: unexpected text after the last }.`);
      }
      return nodes;
    }
    const nodes = this.parseEntries('end', 0);
    this.expect('end', 'the end of the list');
    return nodes;
  }

  /** `Name: value, Name: value` up to the closing token. */
  private parseEntries(closer: TokenType, depth: number): ImportNode[] {
    const nodes: ImportNode[] = [];
    this.skipBreaks();
    while (this.peek().type !== closer && this.peek().type !== 'end') {
      nodes.push(this.parseEntry(depth));
      this.skipBreaks();
    }
    return nodes;
  }

  /** One `Name` or `Name: value`. A name on its own is an item with no price. */
  private parseEntry(depth: number): ImportNode {
    const key = this.peek();
    if (key.type !== 'text') {
      throw new ImportError(
        `Line ${key.line}: expected a name here, found "${key.type === 'end' ? 'the end' : key.type}".`,
      );
    }
    this.take();
    const name = key.value;
    if (!name) throw new ImportError(`Line ${key.line}: a name can't be empty.`);

    // No colon: `{ Banana, Mango }` — two items, priced later.
    if (this.peek().type !== ':') return { name };

    this.take(); // the colon
    // A colon at the end of a line still introduces the value that follows.
    while (this.peek().type === 'newline') this.at += 1;
    return { name, ...this.parseValue(name, depth) };
  }

  /** What sits after the colon, turned into folder children or item details. */
  private parseValue(name: string, depth: number): Omit<ImportNode, 'name'> {
    const token = this.peek();

    if (token.type === '{') {
      if (depth + 1 > MAX_DEPTH) {
        throw new ImportError(
          `Line ${token.line}: "${name}" nests more than ${MAX_DEPTH} levels deep — that's deeper than any catalog needs.`,
        );
      }
      this.take();
      const children = this.parseEntries('}', depth + 1);
      this.expect('}', `a closing } for "${name}"`);
      return this.asItemOrFolder(children);
    }

    if (token.type === '[') {
      this.take();
      const children: ImportNode[] = [];
      this.skipBreaks();
      while (this.peek().type !== ']' && this.peek().type !== 'end') {
        if (this.peek().type === '{') {
          // `[{ Banana: 120 }]` — an object in a list contributes its entries.
          this.take();
          children.push(...this.parseEntries('}', depth + 1));
          this.expect('}', 'a closing }');
        } else {
          children.push(this.parseEntry(depth + 1));
        }
        this.skipBreaks();
      }
      this.expect(']', `a closing ] for "${name}"`);
      return { children };
    }

    if (token.type === 'text') {
      this.take();
      if (isBlank(token.value)) return {};
      if (!token.quoted && looksLikePrice(token.value)) {
        return { price: toPriceLabel(token.value) };
      }
      return { description: token.value };
    }

    // `Name:` with nothing after it — an item, no details.
    return {};
  }

  /**
   * An object of KNOWN keys (price, description, veg…) describes one item;
   * anything else is a folder of things.
   */
  private asItemOrFolder(children: ImportNode[]): Omit<ImportNode, 'name'> {
    if (children.length === 0) return {};
    const known = children.filter((c) => normalizeKey(c.name) in ITEM_KEYS);
    if (known.length !== children.length) return { children };

    const item: Omit<ImportNode, 'name'> = {};
    for (const child of children) {
      const field = ITEM_KEYS[normalizeKey(child.name)];
      // The child's own value landed in whichever slot the value parser chose,
      // so read it back from either — `price: 120` parses as a price,
      // `description: Thick` parses as a description.
      const raw = child.price ?? child.description ?? '';
      if (field === 'veg') item.isVeg = parseBoolean(raw);
      else if (field === 'price') item.price = raw ? toPriceLabel(raw) : undefined;
      else if (raw) item[field] = raw;
    }
    return item;
  }
}

/* ─────────────────────────────── flatten ─────────────────────────────────── */

const isFolder = (node: ImportNode) => Array.isArray(node.children) && node.children.length > 0;

/**
 * Walk the tree into flat rows: the top level becomes the section, every level
 * below becomes the nested folder path, and the leaves become the items.
 */
function flatten(nodes: ImportNode[]): ImportedOffering[] {
  const rows: ImportedOffering[] = [];

  const walk = (node: ImportNode, category: string | undefined, path: string[]) => {
    if (rows.length >= MAX_ITEMS) return;
    if (isFolder(node)) {
      // At the top level the folder names the section; below it, it's a folder.
      const nextCategory = category ?? node.name;
      const nextPath = category === undefined ? path : [...path, node.name];
      for (const child of node.children!) walk(child, nextCategory, nextPath);
      return;
    }
    rows.push({
      name: node.name,
      price: node.price,
      description: node.description,
      category,
      path,
      isVeg: node.isVeg,
      imageUrl: node.imageUrl,
      brand: node.brand,
      basis: node.basis,
    });
  };

  for (const node of nodes) walk(node, undefined, []);
  return rows;
}

/** How deep the folders go, for the "3 sections · 2 levels deep" preview line. */
function treeDepth(nodes: ImportNode[], depth = 0): number {
  let deepest = depth;
  for (const node of nodes) {
    if (isFolder(node)) deepest = Math.max(deepest, treeDepth(node.children!, depth + 1));
  }
  return deepest;
}

/**
 * Parse a pasted catalog. Throws `ImportError` with a line number when the text
 * doesn't hold together.
 */
export function parseOfferings(source: string): ImportSummary {
  if (!source.trim()) throw new ImportError('Nothing to read — paste your list first.');
  const nodes = new Parser(tokenize(source)).parseDocument();
  const rows = flatten(nodes);
  if (rows.length === 0) {
    throw new ImportError('No items found — every name here is an empty folder.');
  }
  if (rows.length >= MAX_ITEMS) {
    throw new ImportError(
      `That's over ${MAX_ITEMS} items. Split it up and paste it in a couple of goes.`,
    );
  }
  const sections = Array.from(
    new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c))),
  );
  return { rows, sections, depth: treeDepth(nodes) };
}

/* ───────────────────────── rows → domain items ───────────────────────────── */

/**
 * Snap a pasted section name onto the library's own spelling — someone typing
 * "beverages" means the Beverages section, and filing it under a second,
 * lowercase one would split the menu in two and hide it from the editor's
 * section list. Anything the library doesn't know is kept exactly as written.
 */
const canonical = (name: string | undefined, lookup: (n?: string) => { name: string } | undefined) =>
  (name ? lookup(name)?.name : undefined) ?? name;

export function toMenuItem(row: ImportedOffering): MenuItem {
  return {
    name: row.name,
    price: row.price,
    description: row.description,
    category: canonical(row.category, findFoodSection),
    subcategory: joinSubcategoryPath(row.path),
    imageUrl: row.imageUrl,
    isVeg: row.isVeg,
  };
}

/**
 * Products file shelf › kind › brand, so the FIRST folder below the shelf is
 * the kind and the second is the brand — the same three levels `GoodsEditor`
 * walks. Anything deeper stays on the subcategory path.
 */
export function toProductItem(row: ImportedOffering): ProductItem {
  const [kind, brand, ...rest] = row.path;
  return {
    name: row.name,
    price: row.price,
    description: row.description,
    category: canonical(row.category, findProductCategory),
    subcategory: joinSubcategoryPath([kind, ...rest].filter(Boolean)),
    brand: row.brand ?? brand,
    images: row.imageUrl ? [row.imageUrl] : undefined,
  };
}

export function toServiceItem(row: ImportedOffering): ServiceItem {
  return {
    name: row.name,
    price: row.price,
    description: row.description,
    category: canonical(row.category, (n) => findSection(SERVICE_SECTIONS, n)),
    subcategory: joinSubcategoryPath(row.path),
    imageUrl: row.imageUrl,
  };
}

export function toRentalItem(row: ImportedOffering, fallback?: RentalBasis): RentalItem {
  const basis = /month/i.test(row.basis ?? '')
    ? 'monthly'
    : /day|daily/i.test(row.basis ?? '')
      ? 'daily'
      : fallback;
  return {
    name: row.name,
    price: row.price,
    description: row.description,
    category: canonical(row.category, (n) => findSection(RENTAL_SECTIONS, n)),
    subcategory: joinSubcategoryPath(row.path),
    imageUrl: row.imageUrl,
    basis,
  };
}
