/**
 * Supabase-backed PlacesRepository. "Current location" is real device GPS (like
 * the mock and Path A's design — GPS is a client concern); saved places (Home,
 * Work) come from the private `saved_places` table when the user has added any.
 */
import type { SavedPlace } from '@/domain/types';
import type { NewSavedPlaceInput, PlacesRepository } from '@/data/repositories';
import { getDeviceLocation } from '@/lib/location';
import { currentUserId, sb } from './shared';

/** Fallback coordinate (Indore) when GPS permission is denied / unavailable. */
const FALLBACK_POINT = { latitude: 22.7196, longitude: 75.8577 };

async function currentPlace(): Promise<SavedPlace> {
  const point = (await getDeviceLocation()) ?? FALLBACK_POINT;
  return { id: 'p_current', label: 'Current location', kind: 'current', point };
}

async function savedPlaces(): Promise<SavedPlace[]> {
  // The row id wins over any `id` inside `data`: the column is what a delete
  // keys on, and it's the one the database guarantees is unique.
  const { data, error } = await sb().from('saved_places').select('id, data');
  if (error) return []; // Guests have no saved places (RLS returns nothing).
  return (data ?? [])
    .map((r) => ({ ...(r.data as SavedPlace), id: r.id as string }))
    .filter((p) => p.kind !== 'current');
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

    /**
     * Save a place. `saved_places` RLS pins every row to `user_id = auth.uid()`,
     * so the id is passed explicitly rather than left to a default — a row
     * written without it is refused by the policy, not silently orphaned.
     *
     * Home and Work REPLACE the existing one of their kind (there is one home),
     * which is a delete-then-insert rather than an upsert: the row id is a uuid
     * default, so there is no natural key to conflict on.
     */
    async savePlace(input: NewSavedPlaceInput): Promise<SavedPlace> {
      const label = input.label.trim();
      if (!label) throw new Error('Give this place a name.');
      const userId = await currentUserId();
      if (!userId) throw new Error('Sign in to save a place.');

      if (input.kind === 'home' || input.kind === 'work') {
        const existing = await savedPlaces();
        const previous = existing.filter((p) => p.kind === input.kind).map((p) => p.id);
        if (previous.length) await sb().from('saved_places').delete().in('id', previous);
      }

      // The id comes from the table's `gen_random_uuid()` default and is read
      // straight back, so no uuid has to be manufactured on a device whose
      // runtime may or may not have `crypto.randomUUID`.
      const { data, error } = await sb()
        .from('saved_places')
        .insert({
          user_id: userId,
          data: { label, kind: input.kind, point: input.point, address: input.address },
        })
        .select('id')
        .single();
      if (error) throw error;

      return {
        id: data.id as string,
        label,
        kind: input.kind,
        point: input.point,
        address: input.address,
      };
    },

    async removePlace(id: string): Promise<void> {
      // No existence check: RLS already scopes the delete to this user's rows,
      // so a stranger's id matches nothing and an unknown one is a no-op.
      const { error } = await sb().from('saved_places').delete().eq('id', id);
      if (error) throw error;
    },
  };
}
