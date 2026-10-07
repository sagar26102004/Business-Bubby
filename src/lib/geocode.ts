/**
 * Place search — type an address or area, get map points back.
 *
 * Nominatim (OpenStreetMap's geocoder), the same service the fleet RouteBuilder
 * already uses: no API key, no billing. Its usage policy asks for at most ~1
 * request a second and an identifying client, so callers DEBOUNCE, and native
 * sends a User-Agent (browsers forbid setting one and send their own).
 *
 * Results are biased toward `near` (the user's location) without being limited
 * to it, so "MG Road" finds the one in your city first but "Pune" still works
 * from Indore. Never throws — a failed search is just no results.
 */
import { Platform } from 'react-native';
import type { GeoPoint } from '@/domain/types';

export interface PlaceResult {
  /** The full one-line name, for the results list. */
  label: string;
  point: GeoPoint;
  /** Street/area part of the address, when the geocoder knows it. */
  addressLine?: string;
  city?: string;
  region?: string;
  country?: string;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
/** Half-width of the box results are biased toward, in degrees (~50 km). */
const BIAS_DEG = 0.5;

type NominatimAddress = Record<string, string | undefined>;
type NominatimHit = { display_name?: string; lat?: string; lon?: string; address?: NominatimAddress };

export async function searchPlaces(query: string, near?: GeoPoint): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '6',
    'accept-language': 'en',
  });
  if (near) {
    const { latitude: lat, longitude: lng } = near;
    // left,top,right,bottom; bounded=0 → a preference, not a filter.
    params.set('viewbox', [lng - BIAS_DEG, lat + BIAS_DEG, lng + BIAS_DEG, lat - BIAS_DEG].join(','));
    params.set('bounded', '0');
  }

  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: Platform.OS === 'web' ? undefined : { 'User-Agent': 'Localo/1.0 (business listing)' },
    });
    if (!res.ok) return [];
    const hits = (await res.json()) as NominatimHit[];
    return (hits ?? [])
      .map((h): PlaceResult | null => {
        const latitude = Number(h.lat);
        const longitude = Number(h.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const a = h.address ?? {};
        const street = [a.house_number, a.road].filter(Boolean).join(' ');
        const area = a.neighbourhood ?? a.suburb ?? a.quarter;
        return {
          label: h.display_name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          point: { latitude, longitude },
          addressLine: [street, area].filter(Boolean).join(', ') || undefined,
          city: a.city ?? a.town ?? a.village ?? a.county,
          region: a.state,
          country: a.country,
        };
      })
      .filter((r): r is PlaceResult => r !== null);
  } catch {
    return [];
  }
}
