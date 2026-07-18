/**
 * Privacy-aware helpers for rendering a business location to customers.
 *
 * The rule the product cares about: when a business runs from home (or a seller
 * lists from home) and has chosen to hide the precise location, customers must
 * never see the street address or coordinates — only the general area.
 */
import type { BusinessLocation } from '@/domain/types';

/** True when the exact address/coordinates may be shown to customers. */
export function canShowPreciseLocation(location: BusinessLocation): boolean {
  return !location.hidePreciseLocation;
}

/** A single-line, privacy-respecting label for lists and headers. */
export function locationSummary(location: BusinessLocation): string {
  const area = [location.city, location.region].filter(Boolean).join(', ');

  if (!canShowPreciseLocation(location)) {
    if (location.kind === 'service_area') return area ? `Serves ${area}` : 'Local area';
    return area ? `${area} (approx.)` : 'Location hidden';
  }

  if (location.kind === 'service_area') {
    return location.label ?? (area ? `Serves ${area}` : 'Service area');
  }

  return location.addressLine
    ? [location.addressLine, area].filter(Boolean).join(', ')
    : area || location.label || 'Location';
}

/** Whether we have coordinates we're allowed to plot on a map. */
export function hasShowableCoordinates(location: BusinessLocation): boolean {
  return canShowPreciseLocation(location) && !!location.point;
}
