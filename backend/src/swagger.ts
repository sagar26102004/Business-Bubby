/**
 * OpenAPI 3 document, served at /docs via swagger-ui-express.
 *
 * Every route is documented from a compact manifest (method · path · summary),
 * kept next to the routers so it stays in step. Bodies/responses are
 * `application/json` carrying the domain objects from src/domain/types.ts — the
 * same shapes the app's repository interfaces specify — so they aren't spelled
 * out field-by-field here. All routes except the public directory reads require
 * `Authorization: Bearer <supabase-jwt>` (the `bearerAuth` security scheme).
 */
type M = 'get' | 'post' | 'patch' | 'delete';
type RouteDef = [M, string, string]; // [method, path, summary]

const ROUTES: Record<string, RouteDef[]> = {
  Businesses: [
    ['get', '/businesses', 'List/search businesses (public; supports near/distance)'],
    ['get', '/businesses/stall/owner/{ownerId}', "Get an owner's personal stall"],
    ['get', '/businesses/{id}', 'Get one business'],
    ['get', '/businesses/{id}/products/{productId}', 'Get one stall product'],
    ['post', '/businesses', 'Create a listing (or fold an item into the stall)'],
    ['patch', '/businesses/{id}', 'Update a business (member only)'],
    ['post', '/businesses/{id}/products/{productId}/sold', 'Mark a stall item sold/unsold (owner)'],
    ['delete', '/businesses/{id}/products/{productId}', 'Remove a stall item (owner)'],
  ],
  Catalog: [
    ['get', '/catalog', 'Growing collection (?kind=&scope=approved|all) — approved is public suggestions, all is super-admin'],
    ['post', '/catalog/capture', 'Record offerings into the collection (best-effort)'],
    ['post', '/catalog/tags', 'Add a business tag by hand (super-admin)'],
    ['patch', '/catalog/{id}', 'Hide/restore an entry (super-admin)'],
    ['delete', '/catalog/{id}', 'Delete an entry (super-admin)'],
  ],
  Employees: [
    ['get', '/employees/business/{businessId}', "List a business's team"],
    ['get', '/employees/user/{userId}/businesses', 'Businesses a user works at'],
    ['get', '/employees/{id}', 'Get one employee'],
    ['post', '/employees/business/{businessId}', 'Add a team member (member only)'],
    ['patch', '/employees/{id}', 'Update an employee (member only)'],
    ['delete', '/employees/{id}', 'Remove a team member (member only)'],
  ],
  Users: [
    ['get', '/users', 'List users (public directory)'],
    ['get', '/users/search', 'Search users by name (?q=)'],
    ['get', '/users/{id}', 'Get one user profile'],
    ['patch', '/users/{id}', 'Update your own profile'],
  ],
  Notifications: [
    ['get', '/notifications/user/{recipientId}', 'Your notifications'],
    ['get', '/notifications/user/{recipientId}/unread-count', 'Unread count'],
    ['post', '/notifications/{id}/read', 'Mark one read'],
    ['post', '/notifications/user/{recipientId}/read-all', 'Mark all read'],
  ],
  Chat: [
    ['get', '/chat/business/{businessId}/thread/{participantId}', 'A B2C conversation'],
    ['post', '/chat/business/{businessId}/thread/{participantId}', 'Send a chat message'],
    ['get', '/chat/business/{businessId}/threads', "A business's inbox (member)"],
    ['get', '/chat/customer/{participantId}/threads', 'A customer’s conversations'],
  ],
  Bookings: [
    ['post', '/bookings', 'Request an appointment'],
    ['get', '/bookings/business/{businessId}', 'Bookings for a business (member)'],
    ['get', '/bookings/customer/{customerId}', 'Your bookings'],
    ['post', '/bookings/{id}/status', 'Accept/decline/complete a booking'],
  ],
  Orders: [
    ['post', '/orders', 'Place an order'],
    ['get', '/orders/business/{businessId}', 'Orders for a business (member)'],
    ['get', '/orders/business/{businessId}/tables', 'Dine-in table occupancy (member)'],
    ['get', '/orders/customer/{customerId}', 'Your orders (?businessId=)'],
    ['get', '/orders/{id}', 'Get one order'],
    ['post', '/orders/{id}/respond', 'Accept / propose (member)'],
    ['post', '/orders/{id}/reject', 'Reject the whole order (member)'],
    ['post', '/orders/{id}/proposal', 'Accept/decline a proposal (customer)'],
    ['post', '/orders/{id}/append', 'Add a round to an open tab'],
    ['post', '/orders/{id}/move-to-billing', 'Close an open tab → bill (member)'],
    ['post', '/orders/{id}/delivered', 'Mark handed over (member)'],
  ],
  Bills: [
    ['post', '/bills', 'Issue a bill (member)'],
    ['get', '/bills/business/{businessId}', 'Bills a business issued (member)'],
    ['get', '/bills/customer/{customerId}', 'Bills you received (?businessId=)'],
    ['get', '/bills/{id}', 'Get one bill'],
    ['post', '/bills/{id}/send-to-chat', 'Post the bill into chat (member)'],
    ['post', '/bills/{id}/payment', 'Set paid/unpaid (member)'],
  ],
  Customers: [
    ['get', '/customers/business/{businessId}', 'Aggregated customer list (member)'],
    ['post', '/customers/business/{businessId}/favorite', 'Star/unstar a customer (owner)'],
  ],
  Reviews: [
    ['get', '/reviews/business/{businessId}', "A business's reviews (public)"],
    ['get', '/reviews/business/{businessId}/mine/{customerId}', 'Your review'],
    ['get', '/reviews/business/{businessId}/eligibility/{customerId}', 'Can you rate?'],
    ['post', '/reviews', 'Create/update your review'],
  ],
  Calls: [
    ['post', '/calls/start', 'Start a voice call'],
    ['get', '/calls/incoming/{userId}', 'Incoming call for a handler'],
    ['get', '/calls/{id}', 'Get call state'],
    ['post', '/calls/{id}/join', 'Join/answer'],
    ['post', '/calls/{id}/decline', 'Decline'],
    ['post', '/calls/{id}/leave', 'Hang up'],
  ],
  Tracking: [
    ['get', '/tracking/business/{businessId}/vehicles', 'Fleet (member)'],
    ['post', '/tracking/business/{businessId}/vehicles', 'Add a vehicle (member)'],
    ['patch', '/tracking/vehicles/{id}', 'Update a vehicle (member)'],
    ['delete', '/tracking/vehicles/{id}', 'Remove a vehicle (member)'],
    ['get', '/tracking/business/{businessId}/items', 'Tracked items (member)'],
    ['get', '/tracking/customer/{customerId}/items', 'Your tracked items (?businessId=)'],
    ['post', '/tracking/items', 'Register a tracked item (member)'],
    ['patch', '/tracking/items/{id}', 'Update a tracked item (member)'],
    ['delete', '/tracking/items/{id}', 'Remove a tracked item (member)'],
    ['post', '/tracking/business/{businessId}/sharing', 'Toggle live-location sharing'],
    ['get', '/tracking/business/{businessId}/sharing/{userId}', 'Is a driver sharing?'],
    ['get', '/tracking/business/{businessId}/live', 'Live vehicle positions'],
  ],
  'B2B chat': [
    ['get', '/biz-chat/user/{userId}/threads', 'Your B2B threads'],
    ['get', '/biz-chat/messages', 'A B2B thread (?a=&b=)'],
    ['post', '/biz-chat/send', 'Send a B2B message'],
  ],
  Memberships: [
    ['get', '/memberships/customer/{customerId}', 'Your active plans'],
    ['get', '/memberships/customer/{customerId}/monthly-spend', 'Month-by-month spend'],
    ['get', '/memberships/business/{businessId}', 'Active members (member)'],
    ['get', '/memberships/business/{businessId}/cancelled', 'Cancelled plans (member)'],
    ['get', '/memberships/business/{businessId}/requests', 'Pending requests (member)'],
    ['get', '/memberships/{id}', 'Get one membership'],
    ['get', '/memberships/{id}/payments', 'Payment history'],
    ['post', '/memberships', 'Enrol a customer (member)'],
    ['post', '/memberships/request', 'Request to enrol (customer)'],
    ['post', '/memberships/{id}/accept', 'Accept a request (member)'],
    ['post', '/memberships/{id}/reject', 'Decline a request (member)'],
    ['post', '/memberships/{id}/cancel', 'Cancel a plan (member)'],
    ['post', '/memberships/{id}/reenroll', 'Re-enrol (member)'],
    ['post', '/memberships/{id}/start-date', 'Change the start date (member)'],
    ['post', '/memberships/{id}/reassign', 'Move to another account (member)'],
    ['post', '/memberships/{id}/detach', 'Detach into a standalone member (member)'],
    ['post', '/memberships/{id}/rename', 'Rename the enrollee (member)'],
    ['post', '/memberships/{id}/record-payment', 'Record a payment at the counter (member)'],
    ['post', '/memberships/{id}/report-payment', 'Self-report a payment (customer)'],
    ['post', '/memberships/payments/{paymentId}/approve', 'Approve a reported payment (member)'],
    ['post', '/memberships/payments/{paymentId}/reject', 'Reject a reported payment (member)'],
  ],
  'Product threads': [
    ['get', '/product-threads/business/{businessId}/product/{productId}', "A product's public thread"],
    ['get', '/product-threads/business/{businessId}', "All of a stall's threads"],
    ['post', '/product-threads', 'Post a question/offer/reply'],
    ['post', '/product-threads/business/{businessId}/product/{productId}/message/{messageId}/pin', 'Pin/unpin (owner)'],
  ],
  Logbook: [
    ['get', '/logbook/business/{businessId}', 'The record book (member)'],
    ['post', '/logbook', 'Add a manual record (member)'],
  ],
};

function buildPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [tag, routes] of Object.entries(ROUTES)) {
    for (const [method, path, summary] of routes) {
      const openapiPath = path;
      paths[openapiPath] = paths[openapiPath] ?? {};
      const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      paths[openapiPath][method] = {
        tags: [tag],
        summary,
        ...(params.length ? { parameters: params } : {}),
        ...(method === 'post' || method === 'patch'
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            }
          : {}),
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: {} } } },
          '400': { description: 'Business-rule violation' },
          '401': { description: 'Not signed in' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Not found' },
        },
      };
    }
  }
  return paths;
}

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Localo API',
    version: '1.0.0',
    description:
      'Path B backend for Localo. Endpoints map 1:1 to the repository interfaces in the app ' +
      '(src/data/repositories.ts) and return the domain objects from src/domain/types.ts. ' +
      'Authenticate with a Supabase access token: `Authorization: Bearer <jwt>`.',
  },
  servers: [{ url: '/api', description: 'API root' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: Object.keys(ROUTES).map((name) => ({ name })),
  paths: buildPaths(),
};
