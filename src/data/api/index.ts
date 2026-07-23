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
  createApiReviews,
  createApiTracking,
  createApiUsers,
} from './repositories';

export function createApiRepositories(): Repositories {
  const mock = createMockRepositories();
  return {
    businesses: createApiBusinesses(),
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
  };
}
