/**
 * The API repository set (Path B) — every repository talks to the Node/Express
 * backend, selected in DataProvider when `EXPO_PUBLIC_BACKEND=api`.
 *
 * `places` stays client-side (device GPS + saved places), exactly as Path A
 * leaves it: it's a device concern, not a server resource — so it borrows Path
 * A's implementation, which persists to `saved_places`. Everything else is
 * served by the API.
 */
import type { Repositories } from '@/data/repositories';
import { createSupabasePlaces } from '@/data/supabase/places';
import { createApiAuth } from './auth';
import { createApiCatalog } from './catalog';
import {
  createApiAds,
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
  return {
    businesses: createApiBusinesses(),
    catalog: createApiCatalog(),
    employees: createApiEmployees(),
    users: createApiUsers(),
    auth: createApiAuth(),
    // Device GPS + saved places, client-side exactly as Path A leaves them.
    // Pointed at the SUPABASE implementation rather than the mock's: saved
    // places live in `saved_places`, whose owner-scoped RLS needs no API
    // involvement, and Path B already carries a Supabase session for auth and
    // uploads. On the mock they were in-memory and died on every reload, which
    // is a real difference a user would see (add Home, reload, Home is gone).
    places: createSupabasePlaces(),
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
    ads: createApiAds(),
  };
}
