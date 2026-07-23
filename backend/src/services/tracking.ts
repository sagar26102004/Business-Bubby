/** Live tracking — ports MockTrackingRepository (fleet, items, simulated GPS). */
import type { Business, Employee, GeoPoint, LocationShare, TrackedItem, Vehicle } from '@/domain/types';
import type { LiveVehicle, NewTrackedItemInput, NewVehicleInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull, jsonEquals } from '@/lib/data';
import { haversineKm } from '@/lib/geo';
import { getVehicleKind } from '@/lib/vehicles';
import { notFound } from '@/http/errors';

const SIM_SPEED_KMH = 120;
const SIM_MAX_STEP_KM = 0.5;
const SIM_RANGE_KM = 4;
/** Fallback anchor when a business has no coordinate — Indore (matches seed). */
const FALLBACK_POINT: GeoPoint = { latitude: 22.7196, longitude: 75.8577 };

const canonicalReg = (reg?: string): string => (reg ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

function bearingDeg(from: GeoPoint, to: GeoPoint): number {
  const dLat = to.latitude - from.latitude;
  const dLng = (to.longitude - from.longitude) * Math.cos((from.latitude * Math.PI) / 180);
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

async function businessAnchor(businessId: string): Promise<GeoPoint> {
  const row = await prisma.business.findUnique({ where: { id: businessId } });
  return (row && asData<Business>(row).location.point) || FALLBACK_POINT;
}

async function saveShare(share: LocationShare): Promise<void> {
  await prisma.locationShare.update({
    where: { businessId_userId: { businessId: share.businessId, userId: share.userId } },
    data: { data: toJson(share), updatedAt: new Date(share.updatedAt) },
  });
}

/** Advance a business's active shares based on elapsed time (simulated GPS). */
async function advanceShares(businessId: string): Promise<void> {
  const rows = await prisma.locationShare.findMany({ where: { businessId } });
  const anchor = await businessAnchor(businessId);
  const now = Date.now();
  for (const row of rows) {
    const share = asData<LocationShare>(row);
    if (!share.active) continue;
    const elapsedH = (now - new Date(share.updatedAt).getTime()) / 3_600_000;
    if (elapsedH <= 0) continue;
    const stepKm = Math.min(elapsedH * SIM_SPEED_KMH, SIM_MAX_STEP_KM);
    share.heading =
      haversineKm(anchor, share.point) > SIM_RANGE_KM
        ? bearingDeg(share.point, anchor)
        : (share.heading + (Math.random() - 0.5) * 50 + 360) % 360;
    const rad = (share.heading * Math.PI) / 180;
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((share.point.latitude * Math.PI) / 180);
    share.point = {
      latitude: share.point.latitude + (Math.cos(rad) * stepKm) / kmPerDegLat,
      longitude: share.point.longitude + (Math.sin(rad) * stepKm) / kmPerDegLng,
    };
    share.updatedAt = new Date(now).toISOString();
    await saveShare(share);
  }
}

export const trackingService = {
  async listVehicles(businessId: string): Promise<Vehicle[]> {
    return rowsData<Vehicle>(await prisma.vehicle.findMany({ where: { businessId } }));
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
      id: newUuid(),
      businessId: input.businessId,
      name,
      registrationNumber: reg || undefined,
      kind: input.kind,
      driverEmployeeId: input.driverEmployeeId,
      createdAt: new Date().toISOString(),
    };
    await prisma.vehicle.create({
      data: { id: vehicle.id, businessId: vehicle.businessId, data: toJson(vehicle) },
    });
    return vehicle;
  },

  async updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle> {
    const row = await prisma.vehicle.findUnique({ where: { id } });
    if (!row) throw notFound(`Vehicle ${id} not found`);
    const vehicle = { ...asData<Vehicle>(row), ...patch, id };
    await prisma.vehicle.update({ where: { id }, data: { data: toJson(vehicle) } });
    return vehicle;
  },

  async removeVehicle(id: string): Promise<void> {
    const exists = await prisma.vehicle.findUnique({ where: { id } });
    if (!exists) return;
    await prisma.vehicle.delete({ where: { id } });
    // Items that rode on it fall back to "not assigned yet".
    const items = await prisma.trackedItem.findMany({ where: { vehicleId: id } });
    for (const row of items) {
      const item = asData<TrackedItem>(row);
      item.vehicleId = undefined;
      await prisma.trackedItem.update({
        where: { id: item.id },
        data: { vehicleId: null, data: toJson(item) },
      });
    }
  },

  async listItems(businessId: string): Promise<TrackedItem[]> {
    return rowsData<TrackedItem>(await prisma.trackedItem.findMany({ where: { businessId } }));
  },

  async listItemsForCustomer(customerId: string, businessId?: string): Promise<TrackedItem[]> {
    const rows = await prisma.trackedItem.findMany({
      where: {
        AND: [
          { data: jsonEquals('customerId', customerId) },
          ...(businessId ? [{ businessId }] : []),
        ],
      },
    });
    return rowsData<TrackedItem>(rows);
  },

  async addItem(input: NewTrackedItemInput): Promise<TrackedItem> {
    const item: TrackedItem = {
      id: newUuid(),
      businessId: input.businessId,
      kind: input.kind,
      label: input.label.trim(),
      customerId: input.customerId,
      customerName: input.customerName,
      vehicleId: input.vehicleId,
      membershipId: input.membershipId,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    await prisma.trackedItem.create({
      data: {
        id: item.id,
        businessId: item.businessId,
        customerId: uuidOrNull(item.customerId),
        vehicleId: uuidOrNull(item.vehicleId),
        data: toJson(item),
      },
    });
    return item;
  },

  async updateItem(id: string, patch: Partial<TrackedItem>): Promise<TrackedItem> {
    const row = await prisma.trackedItem.findUnique({ where: { id } });
    if (!row) throw notFound(`Tracked item ${id} not found`);
    const item = { ...asData<TrackedItem>(row), ...patch, id };
    await prisma.trackedItem.update({
      where: { id },
      data: {
        customerId: uuidOrNull(item.customerId),
        vehicleId: uuidOrNull(item.vehicleId),
        data: toJson(item),
      },
    });
    return item;
  },

  async removeItem(id: string): Promise<void> {
    const exists = await prisma.trackedItem.findUnique({ where: { id } });
    if (exists) await prisma.trackedItem.delete({ where: { id } });
  },

  async setSharing(businessId: string, userId: string, active: boolean): Promise<void> {
    const anchor = await businessAnchor(businessId);
    const existing = await prisma.locationShare.findUnique({
      where: { businessId_userId: { businessId, userId } },
    });
    const share: LocationShare = existing
      ? { ...asData<LocationShare>(existing), active, updatedAt: new Date().toISOString() }
      : {
          businessId,
          userId,
          active,
          point: { ...anchor },
          heading: Math.random() * 360,
          updatedAt: new Date().toISOString(),
        };
    await prisma.locationShare.upsert({
      where: { businessId_userId: { businessId, userId } },
      create: { businessId, userId, data: toJson(share), updatedAt: new Date(share.updatedAt) },
      update: { data: toJson(share), updatedAt: new Date(share.updatedAt) },
    });
  },

  async isSharing(businessId: string, userId: string): Promise<boolean> {
    const row = await prisma.locationShare.findUnique({
      where: { businessId_userId: { businessId, userId } },
    });
    return row ? asData<LocationShare>(row).active : false;
  },

  async getLiveVehicles(businessId: string): Promise<LiveVehicle[]> {
    await advanceShares(businessId);
    const [vehicles, employees, shareRows] = await Promise.all([
      this.listVehicles(businessId),
      prisma.employee.findMany({ where: { businessId } }),
      prisma.locationShare.findMany({ where: { businessId } }),
    ]);
    const emps = rowsData<Employee>(employees);
    const shares = rowsData<LocationShare>(shareRows);
    return vehicles.map((v): LiveVehicle => {
      const driver = v.driverEmployeeId ? emps.find((e) => e.id === v.driverEmployeeId) : undefined;
      const share = driver?.userId
        ? shares.find((s) => s.userId === driver.userId && s.active)
        : undefined;
      return {
        vehicle: v,
        driverName: driver?.displayName,
        sharing: !!share,
        point: share ? { ...share.point } : undefined,
        updatedAt: share?.updatedAt,
      };
    });
  },
};
