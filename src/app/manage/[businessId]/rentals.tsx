/**
 * Things for rent. A rental listing always has this; so does any other
 * business that rents something out on the side (a shop with equipment).
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { RentalItem } from '@/domain/types';
import { RENTAL_BASES } from '@/domain/catalog';
import { RENTAL_SECTIONS, upgradeRentalFiling } from '@/domain/offeringSections';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingFolderEditor } from '@/features/businesses/OfferingFolderEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageRentalsScreen() {
  return (
    <ManageGate
      title="For rent"
      need="offerings"
      what="rentals"
      Form={RentalsForm}
    />
  );
}

function RentalsForm({ business, save, saving }: ManageFormProps) {
  // Anything filed against the old library is re-filed as it loads, so the
  // folders here match the business page — and saving makes it permanent.
  const [rentals, setRentals] = useState<RentalItem[]>(() =>
    (business.rentals ?? []).map(upgradeRentalFiling),
  );

  return (
    <>
      <OfferingFolderEditor
        value={rentals}
        onChange={setRentals}
        sections={RENTAL_SECTIONS}
        noun="rental"
        hint="Tap what you rent out — flats, PG beds, shops, vehicles. Skip the rest."
        newSectionPlaceholder="Section name — e.g. Parking space"
        customIcon="🔑"
        folderLabel="What kind of thing? (optional)"
        folderExample="Studio, Rooftop shop"
        withDescription
        descriptionPlaceholder="Condition, deposit, what’s included (optional)"
        // Per day or per month is decided PER THING: a flat is monthly while
        // the same lister's scooter is daily.
        basisOptions={RENTAL_BASES}
        basisDefault={business.rentalBasis ?? 'monthly'}
        basisLabel="Rented out per…"
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
