/**
 * Frontend CatalogRepository over the Express API (Path B). Mirrors the Supabase
 * implementation (src/data/supabase/catalog.ts): the growing collection of
 * dishes/services/products/tags, served by the backend catalog routes.
 */
import type { CatalogEntry, CatalogEntryKind } from '@/domain/types';
import type { CaptureEntryInput, CatalogRepository } from '@/data/repositories';
import { http, seg } from './client';

export function createApiCatalog(): CatalogRepository {
  return {
    listApproved: (kind?: CatalogEntryKind) =>
      http.get<CatalogEntry[]>('/catalog', { kind }),
    listAll: (kind?: CatalogEntryKind) =>
      http.get<CatalogEntry[]>('/catalog', { kind, scope: 'all' }),
    capture: (entries: CaptureEntryInput[]) =>
      http.post<void>('/catalog/capture', { entries }),
    addTag: (name: string) => http.post<CatalogEntry>('/catalog/tags', { name }),
    setApproved: (id: string, approved: boolean) =>
      http.patch<CatalogEntry>(`/catalog/${seg(id)}`, { approved }),
    remove: (id: string) => http.del<void>(`/catalog/${seg(id)}`),
  };
}
