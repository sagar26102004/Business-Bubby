/**
 * The API repository set (Path B) — every repository talks to the Node/Express
 * backend, selected in DataProvider when `EXPO_PUBLIC_BACKEND=api`.
 *
 * `places` stays client-side (device GPS + saved places), exactly as Path A
 * leaves it: it's a device concern, not a server resource. Everything else is
 * served by the API.
 */
import type { Repositories } from '@/data/repositories';
import { createMockRepositories } from '@/data/mock/mockRepositories';
import { createApiAuth } from './auth';
import { createApiCatalog } from './catalog';
import {
  createApiBills,
  createApiBizChat,
  createApiBookings,
  createApiBusinesses,
  createApiCalls,
  createApiChat,
  createApiCustomers,
  createApiEmployees,
  createApiLogbook,
  createApiMemberships,
  createApiNotifications,
  createApiOrders,
  createApiProductThreads,
  createApiPush,
  createApiReviews,
  createApiTracking,
  createApiUsers,
} from './repositories';

export function createApiRepositories(): Repositories {
  const mock = createMockRepositories();
  return {
    businesses: createApiBusinesses(),
    catalog: createApiCatalog(),
    employees: createApiEmployees(),
    users: createApiUsers(),
    auth: createApiAuth(),
    places: mock.places, // device GPS + saved places — client-side, like Path A
    chat: createApiChat(),
    notifications: createApiNotifications(),
    bookings: createApiBookings(),
    orders: createApiOrders(),
    bills: createApiBills(),
    calls: createApiCalls(),
    customers: createApiCustomers(),
    tracking: createApiTracking(),
    reviews: createApiReviews(),
    memberships: createApiMemberships(),
    bizChat: createApiBizChat(),
    productThreads: createApiProductThreads(),
    logbook: createApiLogbook(),
    push: createApiPush(),
    // ⚠️ NOT YET SERVED BY THE API. Ads landed on the Supabase side first (the
    // standing Supabase-first rule in CLAUDE.md); the Express twin is queued as
    // [SYNC-001] in backend/SYNC_QUEUE.md. Until it lands, Path B keeps the ad
    // slot working against in-memory campaigns rather than 404ing the Home
    // screen — so ads are per-session here, and won't match Path A.
    ads: mock.ads,
  };
}
