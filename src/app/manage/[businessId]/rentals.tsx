/**
 * Things for rent. A rental listing always has this; so does any other
 * business that rents something out on the side (a shop with equipment).
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { RentalItem } from '@/domain/types';
import { RENTAL_SECTIONS } from '@/domain/offeringSections';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageRentalsScreen() {
  return (
    <ManageGate
      title="For rent"
      intro="What you rent out, and what it goes for. Set the rate per day or per month in Availability."
      need="offerings"
      what="rentals"
      Form={RentalsForm}
    />
  );
}

function RentalsForm({ business, save, saving }: ManageFormProps) {
  const [rentals, setRentals] = useState<RentalItem[]>(business.rentals ?? []);

  return (
    <>
      <OfferingsEditor
        value={rentals}
        onChange={setRentals}
        namePlaceholder="e.g. 2BHK flat, Activa 6G, DSLR kit"
        addLabel="Add rental"
        sections={RENTAL_SECTIONS}
        sectionsLabel="What kind of thing is it?"
        withDescription
        descriptionPlaceholder="Condition, deposit, what's included (optional)"
      />
      <Button
        title="Save"
        onPress={() => save({ rentals: rentals.length > 0 ? rentals : undefined })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
