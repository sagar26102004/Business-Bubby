/** Vehicle-kind labels — the subset of ../../../src/domain/catalog.ts the
 * backend needs (getVehicleKind, used only to default a vehicle's display
 * name). */
import type { VehicleKind } from '@/domain/types';

const VEHICLE_KINDS: { id: VehicleKind; name: string }[] = [
  { id: 'bus', name: 'Bus' },
  { id: 'van', name: 'Van' },
  { id: 'truck', name: 'Truck' },
  { id: 'car', name: 'Car' },
  { id: 'bike', name: 'Bike' },
  { id: 'other', name: 'Vehicle' },
];

export function getVehicleKind(id: VehicleKind) {
  return VEHICLE_KINDS.find((k) => k.id === id) ?? VEHICLE_KINDS[VEHICLE_KINDS.length - 1];
}
