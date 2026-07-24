/**
 * Supabase-backed PlacesRepository. "Current location" is real device GPS (like
 * the mock and Path A's design — GPS is a client concern); saved places (Home,
 * Work) come from the private `saved_places` table when the user has added any.
 */
import type { SavedPlace } from '@/domain/types';
import type { PlacesRepository } from '@/data/repositories';
import { getDeviceLocation } from '@/lib/location';
import { sb } from './shared';

/** Fallback coordinate (Indore) when GPS permission is denied / unavailable. */
const FALLBACK_POINT = { latitude: 22.7196, longitude: 75.8577 };

async function currentPlace(): Promise<SavedPlace> {
  const point = (await getDeviceLocation()) ?? FALLBACK_POINT;
  return { id: 'p_current', label: 'Current location', kind: 'current', point };
}

async function savedPlaces(): Promise<SavedPlace[]> {
  const { data, error } = await sb().from('saved_places').select('data');
  if (error) return []; // Guests have no saved places (RLS returns nothing).
  return (data ?? []).map((r) => r.data as SavedPlace).filter((p) => p.kind !== 'current');
}

export function createSupabasePlaces(): PlacesRepository {
  return {
    async getCurrentPlace(): Promise<SavedPlace> {
      return currentPlace();
    },
    async listPlaces(): Promise<SavedPlace[]> {
      const [current, saved] = await Promise.all([currentPlace(), savedPlaces()]);
      return [current, ...saved];
    },
  };
}
