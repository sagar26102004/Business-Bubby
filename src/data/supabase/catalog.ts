/**
 * Supabase-backed CatalogRepository over the `catalog_entries` table (public
 * read; see migration 0005). This is how the app's collection of dishes,
 * services, products and tags GROWS at runtime — listings quietly contribute
 * the offerings the code catalog doesn't ship (`capture`), and a super-admin
 * curates it from the admin screen.
 *
 * Document model: `data jsonb` is the full CatalogEntry; `kind` + `key` are
 * scoping columns with a unique(kind, key) constraint so there's one row per
 * offering. Entries go live the instant they're captured (`approved` defaults
 * true); the super-admin hides bad ones after the fact.
 */
import type { Business, CatalogEntry, CatalogEntryKind } from '@/domain/types';
import { catalogKey, isCodeCatalogName } from '@/domain/catalogEntries';
import type { CaptureEntryInput, CatalogRepository } from '@/data/repositories';
import { sb, uuid, nowIso } from './shared';

const byPopularity = (a: CatalogEntry, b: CatalogEntry) =>
  b.count - a.count || a.name.localeCompare(b.name);

async function fetchAll(): Promise<CatalogEntry[]> {
  const { data, error } = await sb().from('catalog_entries').select('data');
  if (error) throw error;
  return (data ?? []).map((r) => r.data as CatalogEntry);
}

/**
 * Record offerings not already in the code catalog or the store, bumping the
 * count on ones already seen. Best-effort — never throws (capturing is a side
 * effect of listing and must not fail the create/update that triggered it).
 */
async function applyCapture(inputs: CaptureEntryInput[], addedBy?: string): Promise<void> {
  try {
    // Collapse duplicates within this batch (e.g. a menu listing "Tea" twice).
    const unique = new Map<string, CaptureEntryInput & { key: string; inc: number }>();
    for (const input of inputs) {
      const name = input.name?.trim();
      if (!name) continue;
      const key = catalogKey(name);
      const id = `${input.kind}:${key}`;
      const found = unique.get(id);
      if (found) found.inc += 1;
      else unique.set(id, { kind: input.kind, name, key, inc: 1 });
    }
    if (unique.size === 0) return;

    const keys = [...unique.values()].map((u) => u.key);
    const { data: existingRows } = await sb()
      .from('catalog_entries')
      .select('data')
      .in('key', keys);
    const existing = new Map<string, CatalogEntry>();
    for (const row of existingRows ?? []) {
      const e = row.data as CatalogEntry;
      existing.set(`${e.kind}:${e.key}`, e);
    }

    for (const [id, u] of unique) {
      const prior = existing.get(id);
      if (prior) {
        const next: CatalogEntry = { ...prior, count: prior.count + u.inc, updatedAt: nowIso() };
        await sb().from('catalog_entries').update({ data: next }).eq('id', prior.id);
        continue;
      }
      if (isCodeCatalogName(u.kind, u.name)) continue; // already shipped in code
      const entryId = uuid();
      const entry: CatalogEntry = {
        id: entryId,
        kind: u.kind,
        name: u.name,
        key: u.key,
        approved: true,
        count: u.inc,
        addedBy,
        createdAt: nowIso(),
      };
      await sb()
        .from('catalog_entries')
        .insert({ id: entryId, kind: u.kind, key: u.key, data: entry });
    }
  } catch {
    /* ignore — capturing must never fail the caller */
  }
}

/** Best-effort capture of a listing's tags + offerings. Never throws. */
export async function captureBusinessOfferings(b: Business): Promise<void> {
  const inputs: CaptureEntryInput[] = [];
  for (const t of b.tags ?? []) inputs.push({ kind: 'tag', name: t });
  for (const m of b.menu ?? []) inputs.push({ kind: 'dish', name: m.name });
  for (const s of b.services ?? []) inputs.push({ kind: 'service', name: s.name });
  for (const p of b.products ?? []) inputs.push({ kind: 'product', name: p.name });
  await applyCapture(inputs, b.ownerId);
}

export function createSupabaseCatalog(): CatalogRepository {
  return {
    async listApproved(kind?: CatalogEntryKind): Promise<CatalogEntry[]> {
      const all = await fetchAll();
      return all
        .filter((e) => e.approved && (kind ? e.kind === kind : true))
        .sort(byPopularity);
    },

    async listAll(kind?: CatalogEntryKind): Promise<CatalogEntry[]> {
      const all = await fetchAll();
      return all.filter((e) => (kind ? e.kind === kind : true)).sort(byPopularity);
    },

    capture(inputs: CaptureEntryInput[], addedBy?: string): Promise<void> {
      return applyCapture(inputs, addedBy);
    },

    async addTag(name: string): Promise<CatalogEntry> {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean) throw new Error('Type a tag name first.');
      const key = catalogKey(clean);
      const { data: rows, error: selErr } = await sb()
        .from('catalog_entries')
        .select('data')
        .eq('kind', 'tag')
        .eq('key', key);
      if (selErr) throw selErr;
      const prior = rows?.map((r) => r.data as CatalogEntry).find((e) => e.kind === 'tag');
      if (prior) {
        // Re-adding a hidden/known tag makes it live + admin-blessed again.
        const next: CatalogEntry = { ...prior, approved: true, adminAdded: true, updatedAt: nowIso() };
        const { error } = await sb().from('catalog_entries').update({ data: next }).eq('id', prior.id);
        if (error) throw error;
        return next;
      }
      const id = uuid();
      const entry: CatalogEntry = {
        id,
        kind: 'tag',
        name: clean,
        key,
        approved: true,
        adminAdded: true,
        count: 0,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('catalog_entries').insert({ id, kind: 'tag', key, data: entry });
      if (error) throw error;
      return entry;
    },

    async setApproved(id: string, approved: boolean): Promise<CatalogEntry> {
      const { data, error: selErr } = await sb()
        .from('catalog_entries')
        .select('data')
        .eq('id', id)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!data) throw new Error(`Catalog entry ${id} not found`);
      const next: CatalogEntry = { ...(data.data as CatalogEntry), approved, updatedAt: nowIso() };
      const { error } = await sb().from('catalog_entries').update({ data: next }).eq('id', id);
      if (error) throw error;
      return next;
    },

    async remove(id: string): Promise<void> {
      const { error } = await sb().from('catalog_entries').delete().eq('id', id);
      if (error) throw error;
    },
  };
}
