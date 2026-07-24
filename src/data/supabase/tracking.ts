/**
 * Supabase-backed TrackingRepository (vehicles, tracked items, location shares).
 *
 * Vehicle movement is simulated lazily on read, exactly like the mock (there is
 * no real driver-GPS feed yet). The simulated advance is persisted best-effort:
 * a member or the driver may write the share; a customer merely watching can't
 * (RLS), so for them the position is advanced in memory for display only.
 */
import type {
  Business,
  Employee,
  GeoPoint,
  LocationShare,
  TrackedItem,
  Vehicle,
} from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import type {
  LiveVehicle,
  NewTrackedItemInput,
  NewVehicleInput,
  TrackingRepository,
} from '@/data/repositories';
import { haversineKm } from '@/lib/geo';
import { sb, uuid, nowIso } from './shared';

const FALLBACK_POINT: GeoPoint = { latitude: 22.7196, longitude: 75.8577 };
const SIM_SPEED_KMH = 120;
const SIM_MAX_STEP_KM = 0.5;
const SIM_RANGE_KM = 4;

const canonicalReg = (reg?: string): string => (reg ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

function bearingDeg(from: GeoPoint, to: GeoPoint): number {
  const dLat = to.latitude - from.latitude;
  const dLng = (to.longitude - from.longitude) * Math.cos((from.latitude * Math.PI) / 180);
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

/** Advance one active share based on elapsed time. Returns the moved share. */
function advance(share: LocationShare, anchor: GeoPoint): LocationShare {
  const now = Date.now();
  const elapsedH = (now - new Date(share.updatedAt).getTime()) / 3_600_000;
  if (elapsedH <= 0) return share;
  const stepKm = Math.min(elapsedH * SIM_SPEED_KMH, SIM_MAX_STEP_KM);
  const heading =
    haversineKm(anchor, share.point) > SIM_RANGE_KM
      ? bearingDeg(share.point, anchor)
      : ((share.heading ?? 0) + (Math.random() - 0.5) * 50 + 360) % 360;
  const rad = (heading * Math.PI) / 180;
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((share.point.latitude * Math.PI) / 180);
  return {
    ...share,
    heading,
    point: {
      latitude: share.point.latitude + (Math.cos(rad) * stepKm) / kmPerDegLat,
      longitude: share.point.longitude + (Math.sin(rad) * stepKm) / kmPerDegLng,
    },
    updatedAt: new Date(now).toISOString(),
  };
}

async function loadVehicle(id: string): Promise<Vehicle> {
  const { data, error } = await sb().from('vehicles').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Vehicle ${id} not found`);
  return data.data as Vehicle;
}

export function createSupabaseTracking(): TrackingRepository {
  return {
    async listVehicles(businessId: string): Promise<Vehicle[]> {
      const { data, error } = await sb().from('vehicles').select('data').eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Vehicle);
    },

    async addVehicle(input: NewVehicleInput): Promise<Vehicle> {
      const reg = input.registrationNumber?.trim();
      if (reg) {
        const canonical = canonicalReg(reg);
        const existing = await this.listVehicles(input.businessId);
        if (existing.some((v) => canonicalReg(v.registrationNumber) === canonical)) {
          throw new Error(`A vehicle with number ${reg} is already in this fleet.`);
        }
      }
      const name = input.name?.trim() || reg || getVehicleKind(input.kind).name;
      const vehicle: Vehicle = {
        id: uuid(),
        businessId: input.businessId,
        name,
        registrationNumber: reg || undefined,
        kind: input.kind,
        driverEmployeeId: input.driverEmployeeId,
        createdAt: nowIso(),
      };
      const { error } = await sb()
        .from('vehicles')
        .insert({ id: vehicle.id, business_id: input.businessId, data: vehicle });
      if (error) throw error;
      return vehicle;
    },

    async updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle> {
      const current = await loadVehicle(id);
      const next = { ...current, ...patch };
      const { error } = await sb().from('vehicles').update({ data: next }).eq('id', id);
      if (error) throw error;
      return next;
    },

    async removeVehicle(id: string): Promise<void> {
      const vehicle = await loadVehicle(id);
      const { error } = await sb().from('vehicles').delete().eq('id', id);
      if (error) throw error;
      // Items that rode on it fall back to "not assigned yet".
      const { data } = await sb()
        .from('tracked_items')
        .select('data')
        .eq('business_id', vehicle.businessId)
        .eq('vehicle_id', id);
      await Promise.all(
        (data ?? []).map((r) => {
          const item = { ...(r.data as TrackedItem), vehicleId: undefined };
          return sb().from('tracked_items').update({ data: item, vehicle_id: null }).eq('id', item.id);
        }),
      );
    },

    async listItems(businessId: string): Promise<TrackedItem[]> {
      const { data, error } = await sb().from('tracked_items').select('data').eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as TrackedItem);
    },

    async listItemsForCustomer(customerId: string, businessId?: string): Promise<TrackedItem[]> {
      let q = sb().from('tracked_items').select('data').eq('customer_id', customerId);
      if (businessId) q = q.eq('business_id', businessId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => r.data as TrackedItem);
    },

    async addItem(input: NewTrackedItemInput): Promise<TrackedItem> {
      const item: TrackedItem = {
        id: uuid(),
        businessId: input.businessId,
        kind: input.kind,
        label: input.label.trim(),
        customerId: input.customerId,
        customerName: input.customerName,
        vehicleId: input.vehicleId,
        membershipId: input.membershipId,
        note: input.note,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('tracked_items').insert({
        id: item.id,
        business_id: input.businessId,
        customer_id: input.customerId,
        vehicle_id: input.vehicleId ?? null,
        data: item,
      });
      if (error) throw error;
      return item;
    },

    async updateItem(id: string, patch: Partial<TrackedItem>): Promise<TrackedItem> {
      const { data, error } = await sb().from('tracked_items').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Tracked item ${id} not found`);
      const next = { ...(data.data as TrackedItem), ...patch };
      const { error: uErr } = await sb()
        .from('tracked_items')
        .update({ data: next, vehicle_id: next.vehicleId ?? null })
        .eq('id', id);
      if (uErr) throw uErr;
      return next;
    },

    async removeItem(id: string): Promise<void> {
      const { error } = await sb().from('tracked_items').delete().eq('id', id);
      if (error) throw error;
    },

    async setSharing(businessId: string, userId: string, active: boolean): Promise<void> {
      const { data } = await sb()
        .from('location_shares')
        .select('data')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .maybeSingle();
      let share = data?.data as LocationShare | undefined;
      if (!share) {
        const { data: bizRow } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
        const anchor = (bizRow?.data as Business | undefined)?.location?.point ?? FALLBACK_POINT;
        share = {
          businessId,
          userId,
          active: false,
          point: { ...anchor },
          heading: Math.random() * 360,
          updatedAt: nowIso(),
        };
      }
      const next: LocationShare = { ...share, active, updatedAt: nowIso() };
      const { error } = await sb()
        .from('location_shares')
        .upsert({ business_id: businessId, user_id: userId, data: next });
      if (error) throw error;
    },

    async isSharing(businessId: string, userId: string): Promise<boolean> {
      const { data } = await sb()
        .from('location_shares')
        .select('data')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .maybeSingle();
      return !!(data?.data as LocationShare | undefined)?.active;
    },

    async getLiveVehicles(businessId: string): Promise<LiveVehicle[]> {
      const [{ data: vRows }, { data: eRows }, { data: sRows }, { data: bizRow }] = await Promise.all([
        sb().from('vehicles').select('data').eq('business_id', businessId),
        sb().from('employees').select('data').eq('business_id', businessId),
        sb().from('location_shares').select('data').eq('business_id', businessId),
        sb().from('businesses').select('data').eq('id', businessId).maybeSingle(),
      ]);
      const employees = (eRows ?? []).map((r) => r.data as Employee);
      const shares = (sRows ?? []).map((r) => r.data as LocationShare);
      const anchor = (bizRow?.data as Business | undefined)?.location?.point ?? FALLBACK_POINT;

      const out: LiveVehicle[] = [];
      for (const row of vRows ?? []) {
        const v = row.data as Vehicle;
        const driver = v.driverEmployeeId ? employees.find((e) => e.id === v.driverEmployeeId) : undefined;
        let share = driver?.userId
          ? shares.find((s) => s.userId === driver!.userId && s.active)
          : undefined;
        if (share) {
          const moved = advance(share, anchor);
          // Persist best-effort — succeeds for a member/driver, is a no-op (RLS)
          // for a customer merely watching.
          if (moved !== share) {
            await sb()
              .from('location_shares')
              .update({ data: moved })
              .eq('business_id', businessId)
              .eq('user_id', share.userId)
              .then(undefined, () => undefined);
          }
          share = moved;
        }
        out.push({
          vehicle: v,
          driverName: driver?.displayName,
          sharing: !!share,
          point: share ? { ...share.point } : undefined,
          updatedAt: share?.updatedAt,
        });
      }
      return out;
    },
  };
}
