/**
 * LISTING ACTIVE — is the owner actually on the app?
 *
 * Most listings were put up FOR a business (the bulk publisher, the
 * super-admin, the demo set) before its owner had ever opened One Place, so a
 * customer calling or chatting may reach nobody. Those carry
 * `listingActive: false` until someone signs in to the owning account, when
 * the `auth.users` trigger in migration 0028 flips it to true. A listing with
 * no flag at all was registered by its own owner, so it counts as active.
 */
import type { Business } from './types';

export function isListingActive(b: Pick<Business, 'listingActive'>): boolean {
  return b.listingActive !== false;
}
