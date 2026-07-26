/**
 * Catalog service — the app's GROWING collection of dishes, services, products
 * and business tags. Ports src/data/supabase/catalog.ts over Prisma (document
 * model: `data` jsonb is the full CatalogEntry; `kind` + `key` are scoping
 * columns with a unique(kind, key)).
 *
 * Every listing quietly contributes offerings the code catalog doesn't ship
 * (`capture`, best-effort — never fails the create/update that triggered it); a
 * super-admin curates from the admin screen (`addTag`/`setApproved`/`remove`).
 * Entries go live the instant captured (`approved` defaults true).
 */
import type { Business, CatalogEntry, CatalogEntryKind } from '@/domain/types';
import type { CaptureEntryInput } from '@/domain/contracts';
import { catalogKey, isCodeCatalogName } from '@/domain/catalogEntries';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { rowsData, toJson } from '@/lib/data';
import { notFound } from '@/http/errors';

const nowIso = () => new Date().toISOString();

const byPopularity = (a: CatalogEntry, b: CatalogEntry) =>
  b.count - a.count || a.name.localeCompare(b.name);

async function fetchAll(): Promise<CatalogEntry[]> {
  return rowsData<CatalogEntry>(await prisma.catalogEntry.findMany());
}

/**
 * Record offerings not already in the code catalog, bumping the count on ones
 * already seen. Best-effort — never throws (capturing is a side effect of
 * listing and must not fail the create/update that triggered it).
 */
async function applyCapture(inputs: CaptureEntryInput[], addedBy?: string): Promise<void> {
  try {
    // Collapse duplicates within this batch (e.g. a menu listing "Tea" twice).
    const unique = new Map<string, { kind: CatalogEntryKind; name: string; key: string; inc: number }>();
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
    const existingRows = rowsData<CatalogEntry>(
      await prisma.catalogEntry.findMany({ where: { key: { in: keys } } }),
    );
    const existing = new Map<string, CatalogEntry>();
    for (const e of existingRows) existing.set(`${e.kind}:${e.key}`, e);

    for (const [id, u] of unique) {
      const prior = existing.get(id);
      if (prior) {
        const next: CatalogEntry = { ...prior, count: prior.count + u.inc, updatedAt: nowIso() };
        await prisma.catalogEntry.update({ where: { id: prior.id }, data: { data: toJson(next) } });
        continue;
      }
      if (isCodeCatalogName(u.kind, u.name)) continue; // already shipped in code
      const entryId = newUuid();
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
      await prisma.catalogEntry.create({
        data: { id: entryId, kind: u.kind, key: u.key, data: toJson(entry) },
      });
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

export const catalogService = {
  async listApproved(kind?: CatalogEntryKind): Promise<CatalogEntry[]> {
    const all = await fetchAll();
    return all.filter((e) => e.approved && (kind ? e.kind === kind : true)).sort(byPopularity);
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
    const priorRow = await prisma.catalogEntry.findFirst({ where: { kind: 'tag', key } });
    if (priorRow) {
      // Re-adding a hidden/known tag makes it live + admin-blessed again.
      const prior = priorRow.data as unknown as CatalogEntry;
      const next: CatalogEntry = { ...prior, approved: true, adminAdded: true, updatedAt: nowIso() };
      await prisma.catalogEntry.update({ where: { id: prior.id }, data: { data: toJson(next) } });
      return next;
    }
    const id = newUuid();
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
    await prisma.catalogEntry.create({ data: { id, kind: 'tag', key, data: toJson(entry) } });
    return entry;
  },

  async setApproved(id: string, approved: boolean): Promise<CatalogEntry> {
    const row = await prisma.catalogEntry.findUnique({ where: { id } });
    if (!row) throw notFound(`Catalog entry ${id} not found`);
    const next: CatalogEntry = { ...(row.data as unknown as CatalogEntry), approved, updatedAt: nowIso() };
    await prisma.catalogEntry.update({ where: { id }, data: { data: toJson(next) } });
    return next;
  },

  async remove(id: string): Promise<void> {
    await prisma.catalogEntry.delete({ where: { id } });
  },
};
