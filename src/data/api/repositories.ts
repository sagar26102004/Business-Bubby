/**
 * Frontend implementations of the repository interfaces over the Express API.
 * Endpoints map 1:1 to interface methods and return the SAME domain objects the
 * interfaces specify, so these pass results straight through.
 */
import type {
  AppNotification,
  Bill,
  Booking,
  BookingStatus,
  Business,
  Call,
  ChatMessage,
  Employee,
  Membership,
  MembershipPayment,
  MonthlySpend,
  Order,
  PaymentStatus,
  ProductItem,
  ProductMessage,
  Review,
  TrackedItem,
  User,
  Vehicle,
} from '@/domain/types';
import type {
  AcceptEnrollInput,
  BillRepository,
  BizChatRepository,
  BizThreadSummary,
  BookingRepository,
  BusinessQuery,
  BusinessRepository,
  CallRepository,
  ChatAuthor,
  ChatRepository,
  ChatThreadSummary,
  CustomerRepository,
  CustomerSummary,
  CustomerThreadSummary,
  EmployeeRepository,
  EnrollRequestInput,
  LiveVehicle,
  LogbookRepository,
  MembershipRepository,
  NewBillInput,
  NewBizMessageInput,
  NewBookingInput,
  NewBusinessInput,
  NewEmployeeInput,
  NewLogEntryInput,
  NewMembershipInput,
  NewOrderInput,
  NewOrderLineInput,
  NewProductMessageInput,
  NewReviewInput,
  NewTrackedItemInput,
  NewUserInput,
  NewVehicleInput,
  NotificationRepository,
  OrderRepository,
  ProductThreadRepository,
  ReportPaymentInput,
  ReviewEligibility,
  ReviewRepository,
  TableSeat,
  TrackingRepository,
  UserRepository,
} from '@/data/repositories';
import type { LogEntry } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import {
  TEST_PASSWORD,
  assertDevTool,
  fallbackUser,
  niceAuthError,
  phoneToEmail,
  syntheticTestPhone,
} from '@/data/supabase/shared';
import { http, seg } from './client';

export function createApiBusinesses(): BusinessRepository {
  return {
    list: (query: BusinessQuery = {}) =>
      http.get<Business[]>('/businesses', {
        search: query.search,
        type: query.type,
        subcategoryId: query.subcategoryId,
        lat: query.near?.latitude,
        lng: query.near?.longitude,
        maxDistanceKm: query.maxDistanceKm,
        sortByDistance: query.sortByDistance,
      }),
    getById: (id) => http.get<Business | null>(`/businesses/${seg(id)}`),
    create: (input: NewBusinessInput) => http.post<Business>('/businesses', input),
    getStallForOwner: (ownerId) =>
      http.get<Business | null>(`/businesses/stall/owner/${seg(ownerId)}`),
    getProduct: (businessId, productId) =>
      http.get<ProductItem | null>(`/businesses/${seg(businessId)}/products/${seg(productId)}`),
    setProductSold: (businessId, productId, sold) =>
      http.post<ProductItem>(`/businesses/${seg(businessId)}/products/${seg(productId)}/sold`, {
        sold,
      }),
    removeProduct: async (businessId, productId) => {
      await http.del(`/businesses/${seg(businessId)}/products/${seg(productId)}`);
    },
    update: (id, patch) => http.patch<Business>(`/businesses/${seg(id)}`, patch),
    reassignOwner: (id, newOwnerId) =>
      http.post<Business>(`/businesses/${seg(id)}/reassign-owner`, { newOwnerId }),
  };
}

export function createApiEmployees(): EmployeeRepository {
  return {
    listByBusiness: (businessId) => http.get<Employee[]>(`/employees/business/${seg(businessId)}`),
    getById: (id) => http.get<Employee | null>(`/employees/${seg(id)}`),
    listBusinessesForUser: (userId) =>
      http.get<Business[]>(`/employees/user/${seg(userId)}/businesses`),
    update: (id, patch) => http.patch<Employee>(`/employees/${seg(id)}`, patch),
    add: (businessId, input: NewEmployeeInput) =>
      http.post<Employee>(`/employees/business/${seg(businessId)}`, input),
    remove: async (id) => {
      await http.del(`/employees/${seg(id)}`);
    },
  };
}

export function createApiUsers(): UserRepository {
  return {
    getById: (id) => http.get<User | null>(`/users/${seg(id)}`),
    list: () => http.get<User[]>('/users'),
    search: (term) => http.get<User[]>('/users/search', { q: term }),
    // Dev Tools' "Add a test account". Identity is Supabase in this backend too,
    // so we sign one up for real with the shared TEST_PASSWORD + a synthetic
    // phone — a first-class switchable test account. signUp establishes the new
    // user's session, so dev.tsx switches into it afterwards; the profile row is
    // created by the DB trigger and read back through the API.
    create: async (input: NewUserInput): Promise<User> => {
      // Creates a REAL account on the shared database — dev only.
      assertDevTool('Adding a test account');
      const phone = syntheticTestPhone();
      const { data, error } = await getSupabase().auth.signUp({
        email: phoneToEmail(phone),
        password: TEST_PASSWORD,
        options: { data: { name: input.name, phone } },
      });
      if (error) throw new Error(niceAuthError(error.message));
      const userId = data.user?.id;
      if (!userId) throw new Error('Account creation did not return a user. Please try again.');
      const user = await http.get<User | null>(`/users/${seg(userId)}`).catch(() => null);
      return user ?? fallbackUser(userId, input.name);
    },
    update: (id, patch) => http.patch<User>(`/users/${seg(id)}`, patch),
  };
}

export function createApiChat(): ChatRepository {
  return {
    listThread: (businessId, participantId) =>
      http.get<ChatMessage[]>(`/chat/business/${seg(businessId)}/thread/${seg(participantId)}`),
    send: (businessId, participantId, body, author: ChatAuthor, extra) =>
      http.post<ChatMessage[]>(`/chat/business/${seg(businessId)}/thread/${seg(participantId)}`, {
        body,
        author,
        extra,
      }),
    listBusinessThreads: (businessId) =>
      http.get<ChatThreadSummary[]>(`/chat/business/${seg(businessId)}/threads`),
    listCustomerThreads: (participantId) =>
      http.get<CustomerThreadSummary[]>(`/chat/customer/${seg(participantId)}/threads`),
  };
}

export function createApiNotifications(): NotificationRepository {
  return {
    listForUser: (recipientId) =>
      http.get<AppNotification[]>(`/notifications/user/${seg(recipientId)}`),
    unreadCount: (recipientId) =>
      http
        .get<{ count: number }>(`/notifications/user/${seg(recipientId)}/unread-count`)
        .then((r) => r.count),
    markRead: async (id) => {
      await http.post(`/notifications/${seg(id)}/read`);
    },
    markAllRead: async (recipientId) => {
      await http.post(`/notifications/user/${seg(recipientId)}/read-all`);
    },
  };
}

export function createApiBookings(): BookingRepository {
  return {
    create: (input: NewBookingInput) => http.post<Booking>('/bookings', input),
    listForBusiness: (businessId) => http.get<Booking[]>(`/bookings/business/${seg(businessId)}`),
    listForCustomer: (customerId) => http.get<Booking[]>(`/bookings/customer/${seg(customerId)}`),
    updateStatus: (id, status: BookingStatus) =>
      http.post<Booking>(`/bookings/${seg(id)}/status`, { status }),
  };
}

export function createApiOrders(): OrderRepository {
  return {
    create: (input: NewOrderInput) => http.post<Order>('/orders', input),
    getById: (id) => http.get<Order | null>(`/orders/${seg(id)}`),
    listForBusiness: (businessId) => http.get<Order[]>(`/orders/business/${seg(businessId)}`),
    listForCustomer: (customerId, businessId) =>
      http.get<Order[]>(`/orders/customer/${seg(customerId)}`, { businessId }),
    respond: (id, keptLineIds, respondedByName, message, counterPrices) =>
      http.post<Order>(`/orders/${seg(id)}/respond`, {
        keptLineIds,
        respondedByName,
        message,
        counterPrices,
      }),
    reject: (id, respondedByName, message) =>
      http.post<Order>(`/orders/${seg(id)}/reject`, { respondedByName, message }),
    decideProposal: (id, accept) => http.post<Order>(`/orders/${seg(id)}/proposal`, { accept }),
    appendLines: (id, lines: NewOrderLineInput[]) =>
      http.post<Order>(`/orders/${seg(id)}/append`, { lines }),
    moveToBilling: (id, issuedByName) =>
      http.post<Order>(`/orders/${seg(id)}/move-to-billing`, { issuedByName }),
    markDelivered: (id, byName) => http.post<Order>(`/orders/${seg(id)}/delivered`, { byName }),
    tableStatus: (businessId) => http.get<TableSeat[]>(`/orders/business/${seg(businessId)}/tables`),
  };
}

export function createApiBills(): BillRepository {
  return {
    create: (input: NewBillInput) => http.post<Bill>('/bills', input),
    getById: (id) => http.get<Bill | null>(`/bills/${seg(id)}`),
    listForBusiness: (businessId) => http.get<Bill[]>(`/bills/business/${seg(businessId)}`),
    listForCustomer: (customerId, businessId) =>
      http.get<Bill[]>(`/bills/customer/${seg(customerId)}`, { businessId }),
    sendToChat: async (billId, sentByName) => {
      await http.post(`/bills/${seg(billId)}/send-to-chat`, { sentByName });
    },
    setPaymentStatus: (billId, status: PaymentStatus, byName) =>
      http.post<Bill>(`/bills/${seg(billId)}/payment`, { status, byName }),
  };
}

export function createApiCustomers(): CustomerRepository {
  return {
    listForBusiness: (businessId) =>
      http.get<CustomerSummary[]>(`/customers/business/${seg(businessId)}`),
    setFavorite: async (businessId, customerKey, favorite) => {
      await http.post(`/customers/business/${seg(businessId)}/favorite`, { customerKey, favorite });
    },
  };
}

export function createApiReviews(): ReviewRepository {
  return {
    listForBusiness: (businessId) => http.get<Review[]>(`/reviews/business/${seg(businessId)}`),
    getMine: (businessId, customerId) =>
      http.get<Review | null>(`/reviews/business/${seg(businessId)}/mine/${seg(customerId)}`),
    checkEligibility: (businessId, customerId) =>
      http.get<ReviewEligibility>(`/reviews/business/${seg(businessId)}/eligibility/${seg(customerId)}`),
    submit: (input: NewReviewInput) => http.post<Review>('/reviews', input),
  };
}

export function createApiCalls(): CallRepository {
  return {
    start: (businessId, customer) => http.post<Call>('/calls/start', { businessId, customer }),
    getById: (callId) => http.get<Call | null>(`/calls/${seg(callId)}`),
    join: (callId, participantId) => http.post<Call>(`/calls/${seg(callId)}/join`, { participantId }),
    decline: (callId, participantId) =>
      http.post<Call>(`/calls/${seg(callId)}/decline`, { participantId }),
    leave: (callId, participantId) =>
      http.post<Call>(`/calls/${seg(callId)}/leave`, { participantId }),
    getIncomingForUser: (userId) => http.get<Call | null>(`/calls/incoming/${seg(userId)}`),
    listForBusiness: (businessId, sinceIso) =>
      http.get<Call[]>(
        `/calls/business/${seg(businessId)}${sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : ''}`,
      ),
    getAudioToken: (callId) =>
      http.post<{ token: string; url: string }>(`/calls/${seg(callId)}/token`, {}),
  };
}

export function createApiTracking(): TrackingRepository {
  return {
    listVehicles: (businessId) =>
      http.get<Vehicle[]>(`/tracking/business/${seg(businessId)}/vehicles`),
    addVehicle: (input: NewVehicleInput) =>
      http.post<Vehicle>(`/tracking/business/${seg(input.businessId)}/vehicles`, input),
    updateVehicle: (id, patch) => http.patch<Vehicle>(`/tracking/vehicles/${seg(id)}`, patch),
    removeVehicle: async (id) => {
      await http.del(`/tracking/vehicles/${seg(id)}`);
    },
    listItems: (businessId) => http.get<TrackedItem[]>(`/tracking/business/${seg(businessId)}/items`),
    listItemsForCustomer: (customerId, businessId) =>
      http.get<TrackedItem[]>(`/tracking/customer/${seg(customerId)}/items`, { businessId }),
    addItem: (input: NewTrackedItemInput) => http.post<TrackedItem>('/tracking/items', input),
    updateItem: (id, patch) => http.patch<TrackedItem>(`/tracking/items/${seg(id)}`, patch),
    removeItem: async (id) => {
      await http.del(`/tracking/items/${seg(id)}`);
    },
    setSharing: async (businessId, userId, active) => {
      await http.post(`/tracking/business/${seg(businessId)}/sharing`, { userId, active });
    },
    isSharing: (businessId, userId) =>
      http
        .get<{ sharing: boolean }>(`/tracking/business/${seg(businessId)}/sharing/${seg(userId)}`)
        .then((r) => r.sharing),
    getLiveVehicles: (businessId) =>
      http.get<LiveVehicle[]>(`/tracking/business/${seg(businessId)}/live`),
  };
}

export function createApiBizChat(): BizChatRepository {
  return {
    listThreadsForUser: (userId) =>
      http.get<BizThreadSummary[]>(`/biz-chat/user/${seg(userId)}/threads`),
    listMessages: (businessA, businessB) =>
      http.get(`/biz-chat/messages`, { a: businessA, b: businessB }),
    send: (input: NewBizMessageInput) => http.post('/biz-chat/send', input),
  };
}

export function createApiMemberships(): MembershipRepository {
  return {
    listForCustomer: (customerId) =>
      http.get<Membership[]>(`/memberships/customer/${seg(customerId)}`),
    monthlySpend: (customerId) =>
      http.get<MonthlySpend[]>(`/memberships/customer/${seg(customerId)}/monthly-spend`),
    listForBusiness: (businessId) =>
      http.get<Membership[]>(`/memberships/business/${seg(businessId)}`),
    listCancelledForBusiness: (businessId) =>
      http.get<Membership[]>(`/memberships/business/${seg(businessId)}/cancelled`),
    listRequests: (businessId) =>
      http.get<Membership[]>(`/memberships/business/${seg(businessId)}/requests`),
    getById: (id) => http.get<Membership | null>(`/memberships/${seg(id)}`),
    add: (input: NewMembershipInput) => http.post<Membership>('/memberships', input),
    request: (input: EnrollRequestInput) => http.post<Membership>('/memberships/request', input),
    accept: (id, input: AcceptEnrollInput) =>
      http.post<Membership>(`/memberships/${seg(id)}/accept`, input),
    reject: (id) => http.post<Membership>(`/memberships/${seg(id)}/reject`),
    cancel: (id) => http.post<Membership>(`/memberships/${seg(id)}/cancel`),
    reenroll: (id) => http.post<Membership>(`/memberships/${seg(id)}/reenroll`),
    setStartDate: (id, startedAt) =>
      http.post<Membership>(`/memberships/${seg(id)}/start-date`, { startedAt }),
    reassign: (id, toCustomerId, toCustomerName) =>
      http.post<Membership>(`/memberships/${seg(id)}/reassign`, { toCustomerId, toCustomerName }),
    detach: (id) => http.post<Membership>(`/memberships/${seg(id)}/detach`),
    renameEnrollee: (id, name) => http.post<Membership>(`/memberships/${seg(id)}/rename`, { name }),
    listPayments: (membershipId) =>
      http.get<MembershipPayment[]>(`/memberships/${seg(membershipId)}/payments`),
    reportPayment: (input: ReportPaymentInput) =>
      http.post<MembershipPayment>(`/memberships/${seg(input.membershipId)}/report-payment`, input),
    recordPayment: (input) =>
      http.post<MembershipPayment>(`/memberships/${seg(input.membershipId)}/record-payment`, input),
    approvePayment: (id, byName) =>
      http.post<MembershipPayment>(`/memberships/payments/${seg(id)}/approve`, { byName }),
    rejectPayment: (id, byName) =>
      http.post<MembershipPayment>(`/memberships/payments/${seg(id)}/reject`, { byName }),
  };
}

export function createApiProductThreads(): ProductThreadRepository {
  return {
    listForProduct: (businessId, productId) =>
      http.get<ProductMessage[]>(
        `/product-threads/business/${seg(businessId)}/product/${seg(productId)}`,
      ),
    listForBusiness: (businessId) =>
      http.get<ProductMessage[]>(`/product-threads/business/${seg(businessId)}`),
    post: (input: NewProductMessageInput) => http.post<ProductMessage>('/product-threads', input),
    setPinned: (businessId, productId, messageId, pinned) =>
      http.post<ProductMessage>(
        `/product-threads/business/${seg(businessId)}/product/${seg(productId)}/message/${seg(messageId)}/pin`,
        { pinned },
      ),
  };
}

export function createApiLogbook(): LogbookRepository {
  return {
    listForBusiness: (businessId) => http.get<LogEntry[]>(`/logbook/business/${seg(businessId)}`),
    addManual: (input: NewLogEntryInput) => http.post<LogEntry>('/logbook', input),
  };
}
