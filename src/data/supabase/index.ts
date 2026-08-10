/**
 * The Supabase repository set — the WHOLE app on the live Supabase Postgres
 * (Path A). Every repository talks straight to Supabase (Auth + auto REST +
 * RLS); there is NO mock delegation left.
 *
 * Two behaviours are adapted to fit RLS (a customer acting directly can't write
 * business-owned rows):
 *   - ratingAvg/ratingCount are computed live from the `reviews` table on read
 *     (businesses.ts), never written onto the business.
 *   - a customer accepting a price proposal leaves the order as a confirmed open
 *     tab; the business issues the bill via "Move to billing" (orders.ts).
 *
 * `places` is real device GPS (a client concern, like the mock).
 */
import type { Repositories } from '@/data/repositories';
import { createSupabaseAuth } from './auth';
import { createSupabaseUsers } from './users';
import { createSupabaseBusinesses } from './businesses';
import { createSupabaseCatalog } from './catalog';
import { createSupabaseEmployees } from './employees';
import { createSupabasePlaces } from './places';
import { createSupabaseChat } from './chat';
import { createSupabaseNotifications } from './notifications';
import { createSupabaseBookings } from './bookings';
import { createSupabaseOrders } from './orders';
import { createSupabaseBills } from './bills';
import { createSupabaseCalls } from './calls';
import { createSupabaseCustomers } from './customers';
import { createSupabaseTracking } from './tracking';
import { createSupabaseReviews } from './reviews';
import { createSupabaseMemberships } from './memberships';
import { createSupabaseBizChat } from './bizChat';
import { createSupabaseProductThreads } from './productThreads';
import { createSupabaseLogbook } from './logbook';
import { createSupabasePush } from './push';
import { createSupabaseAds } from './ads';

export function createSupabaseRepositories(): Repositories {
  return {
    auth: createSupabaseAuth(),
    users: createSupabaseUsers(),
    businesses: createSupabaseBusinesses(),
    catalog: createSupabaseCatalog(),
    employees: createSupabaseEmployees(),
    places: createSupabasePlaces(),
    chat: createSupabaseChat(),
    notifications: createSupabaseNotifications(),
    bookings: createSupabaseBookings(),
    orders: createSupabaseOrders(),
    bills: createSupabaseBills(),
    calls: createSupabaseCalls(),
    customers: createSupabaseCustomers(),
    tracking: createSupabaseTracking(),
    reviews: createSupabaseReviews(),
    memberships: createSupabaseMemberships(),
    bizChat: createSupabaseBizChat(),
    productThreads: createSupabaseProductThreads(),
    logbook: createSupabaseLogbook(),
    push: createSupabasePush(),
    ads: createSupabaseAds(),
  };
}
