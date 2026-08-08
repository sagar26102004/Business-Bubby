-- Localo — stop a customer rewriting the order the business bills them from.
--
-- THE HOLE THIS CLOSES
-- `orders_update` authorises with `customer_id = auth.uid() or is_business_member(...)`
-- in both USING and WITH CHECK. It says WHO may write, never WHAT they may
-- change — and the whole order (lines, prices, status, billId) is one
-- client-written `data` document. So:
--
--   1. FREE GOODS. Place a real order; the business sees real prices and
--      accepts it (dine-in tabs and accepted proposals stay open by design).
--      Then rewrite the stored prices to zero:
--
--        patch /rest/v1/orders?id=eq.<order>  {"data": {...,"lines":[{...,"price":"₹0"}]}}
--
--      When the business taps "Move to billing", `acceptOrder` maps
--      `order.lines` into `issueBill`, which totals them. The bill is ₹0. The
--      business never re-checks, because it already approved the order.
--
--   2. SKIPPING APPROVAL. Set `data.status` to 'accepted' (or insert an order
--      already accepted, with a `billId`) and it lands in the business's
--      confirmed/open-tab list having never been reviewed.
--
--   3. Forging `respondedByName`, `responseMessage` and `billId` outright.
--
-- THE FIX
-- A customer has exactly TWO legitimate mutations on an order — accept or
-- decline an open proposal, and add a round to an open tab. Both are narrow
-- state transitions, so both become SECURITY DEFINER functions that validate
-- the transition and touch only the fields they own. Direct UPDATE by the
-- customer goes away entirely.
--
-- INSERT stays a normal policy (creating an order is ordinary), but a trigger
-- pins the fields a customer must not choose: status is always 'requested',
-- there is never a billId, and line prices are re-derived from the business's
-- own catalog where the item can be found.
--
-- Requires 0002. Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The authoritative price of one line, read from the business's own lists
-- ---------------------------------------------------------------------------
-- The order document links to the catalog by NAME (OrderLine carries no item
-- id), so that is what we match on. Returns NULL when the business doesn't list
-- it — a one-off or a bargained stall item — and the caller keeps what was sent,
-- which is safe because the business still approves every order before billing.
create or replace function public.catalog_price(bid uuid, line jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select item -> 'price'
    from public.businesses b,
         lateral jsonb_array_elements(
           coalesce(b.data -> 'menu',     '[]'::jsonb) ||
           coalesce(b.data -> 'products', '[]'::jsonb) ||
           coalesce(b.data -> 'services', '[]'::jsonb) ||
           coalesce(b.data -> 'rentals',  '[]'::jsonb) ||
           coalesce(b.data -> 'partyPackages', '[]'::jsonb)
         ) as item
   where b.id = bid
     and lower(trim(item ->> 'name')) = lower(trim(line ->> 'name'))
     and item -> 'price' is not null
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. What a customer may put in a NEW order
-- ---------------------------------------------------------------------------
create or replace function public.sanitize_customer_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  line  jsonb;
  lines jsonb := '[]'::jsonb;
begin
  -- No JWT = the trusted server path (Prisma/service role), which does its own
  -- authorisation. A business member writing an order (walk-ins, phone orders)
  -- is the business itself, so their prices are authoritative too.
  if actor is null or public.is_business_member(new.business_id, actor) then
    return new;
  end if;

  -- The customer never chooses the order's standing.
  new.data = jsonb_set(new.data, '{status}', '"requested"', true)
             - 'billId' - 'respondedByName' - 'responseMessage';

  -- …nor whose order it is, nor which business it lands on.
  new.data = jsonb_set(new.data, '{customerId}', to_jsonb(coalesce(new.customer_id, actor)::text), true);
  new.data = jsonb_set(new.data, '{businessId}', to_jsonb(new.business_id::text), true);

  -- Rebuild every line from what the customer is allowed to decide: what it is,
  -- how many, and (bargaining, by design) what they'd like to pay. The unit
  -- price comes from the business's own catalog when the item is listed there;
  -- `counterPrice` is the seller's reply and can never arrive from this side.
  for line in select * from jsonb_array_elements(coalesce(new.data -> 'lines', '[]'::jsonb))
  loop
    lines = lines || jsonb_build_object(
      'id',       coalesce(line -> 'id', to_jsonb(gen_random_uuid()::text)),
      'kind',     line -> 'kind',
      'name',     line -> 'name',
      'price',    coalesce(public.catalog_price(new.business_id, line), line -> 'price'),
      'offerPrice', line -> 'offerPrice',
      'quantity', line -> 'quantity',
      'included', 'true'::jsonb
    );
  end loop;
  new.data = jsonb_set(new.data, '{lines}', lines, true);

  return new;
end;
$$;

drop trigger if exists orders_sanitize_customer on orders;
create trigger orders_sanitize_customer
  before insert on orders
  for each row execute function public.sanitize_customer_order();

-- ---------------------------------------------------------------------------
-- 3. Customers lose direct UPDATE; members keep it
-- ---------------------------------------------------------------------------
drop policy if exists orders_update on orders;
create policy orders_update on orders for update
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. The two transitions a customer legitimately makes
-- ---------------------------------------------------------------------------
-- Accept or decline an open proposal. Touches `status` and nothing else — the
-- lines and prices are whatever the BUSINESS proposed.
create or replace function public.decide_order_proposal(order_id uuid, accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_data jsonb;
  cid      uuid;
begin
  select data, customer_id into row_data, cid
    from public.orders where id = order_id for update;
  if row_data is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if auth.uid() is null or cid is distinct from auth.uid() then
    raise exception 'Only the customer can respond to this proposal.' using errcode = '42501';
  end if;
  if row_data ->> 'status' <> 'proposed' then
    raise exception 'There is no open proposal on this order.';
  end if;

  row_data = jsonb_set(
    row_data, '{status}',
    to_jsonb(case when accept then 'accepted' else 'declined' end)
  );
  update public.orders set data = row_data where id = order_id;
  return row_data;
end;
$$;

-- Add a round to an open tab. Appends sanitised lines and sends the order back
-- to 'requested' so the business re-confirms — it can never bill silently.
create or replace function public.append_order_lines(order_id uuid, new_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_data jsonb;
  cid      uuid;
  bid      uuid;
  line     jsonb;
  added    jsonb := '[]'::jsonb;
begin
  select data, customer_id, business_id into row_data, cid, bid
    from public.orders where id = order_id for update;
  if row_data is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if auth.uid() is null or cid is distinct from auth.uid() then
    raise exception 'Only the customer can add to this order.' using errcode = '42501';
  end if;
  if row_data ? 'billId' then
    raise exception 'This order was already billed — place a new order instead.';
  end if;
  if row_data ->> 'status' not in ('requested', 'accepted') then
    raise exception 'This order is not open anymore — place a new order instead.';
  end if;
  if coalesce(jsonb_array_length(new_lines), 0) = 0 then
    raise exception 'Pick at least one item to add.';
  end if;

  for line in select * from jsonb_array_elements(new_lines)
  loop
    added = added || jsonb_build_object(
      'id',       to_jsonb(gen_random_uuid()::text),
      'kind',     line -> 'kind',
      'name',     line -> 'name',
      'price',    coalesce(public.catalog_price(bid, line), line -> 'price'),
      'offerPrice', line -> 'offerPrice',
      'quantity', line -> 'quantity',
      'included', 'true'::jsonb
    );
  end loop;

  row_data = jsonb_set(row_data, '{lines}',
                       coalesce(row_data -> 'lines', '[]'::jsonb) || added, true);
  row_data = jsonb_set(row_data, '{status}', '"requested"', true) - 'responseMessage';

  update public.orders set data = row_data where id = order_id;
  return row_data;
end;
$$;

-- Signed-in callers only; both functions check the caller owns the order.
revoke all on function public.decide_order_proposal(uuid, boolean) from public, anon;
revoke all on function public.append_order_lines(uuid, jsonb)      from public, anon;
grant execute on function public.decide_order_proposal(uuid, boolean) to authenticated;
grant execute on function public.append_order_lines(uuid, jsonb)      to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY — as the CUSTOMER on one of your own orders, all of these must fail
-- ---------------------------------------------------------------------------
--   update orders set data = jsonb_set(data,'{status}','"accepted"') where id = '<mine>';
--     -> 0 rows (no UPDATE policy applies to you any more)
--   insert an order with "status":"accepted" and a "billId"
--     -> stored as 'requested', billId dropped
--   select public.append_order_lines('<someone else''s order>', '[]'::jsonb);
--     -> Only the customer can add to this order.
--
-- And these must still WORK:
--   the customer accepting a proposal; adding a round to an open dine-in tab;
--   the business responding, countering, and moving a tab to billing.
