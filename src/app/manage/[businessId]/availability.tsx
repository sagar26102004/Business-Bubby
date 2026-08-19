/**
 * Rental availability — flip Available/Rented instead of re-listing, plus
 * whether the rate is a daily or a monthly one.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RentalBasis, RentalStatus } from '@/domain/types';
import { RENTAL_BASES } from '@/domain/catalog';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageAvailabilityScreen() {
  return (
    <ManageGate
      title="Availability"
      need="owner"
      Form={AvailabilityForm}
    />
  );
}

function AvailabilityForm({ business, save, saving }: ManageFormProps) {
  const [rentalStatus, setRentalStatus] = useState<RentalStatus>(business.rentalStatus ?? 'available');
  const [rentalBasis, setRentalBasis] = useState<RentalBasis | undefined>(business.rentalBasis);

  return (
    <>
      <View style={styles.row}>
        {(
          [
            { id: 'available', label: '🟢 Available' },
            { id: 'rented', label: '🔴 Rented' },
          ] as { id: RentalStatus; label: string }[]
        ).map((s) => (
          <Tag
            key={s.id}
            label={s.label}
            selected={rentalStatus === s.id}
            onPress={() => setRentalStatus(s.id)}
          />
        ))}
      </View>

      <Text variant="label" weight="semibold" style={styles.label}>
        Rented out per day or per month?
      </Text>
      <View style={styles.row}>
        {RENTAL_BASES.map((b) => (
          <Tag
            key={b.id}
            label={b.label}
            icon={b.icon}
            selected={rentalBasis === b.id}
            onPress={() => setRentalBasis(b.id)}
          />
        ))}
      </View>

      <Button
        title="Save"
        onPress={() => save({ rentalStatus, rentalBasis })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  save: { marginTop: spacing.xl },
});
