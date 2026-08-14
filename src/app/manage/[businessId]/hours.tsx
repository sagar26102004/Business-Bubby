/**
 * Opening hours. The picker writes the full week; `hours` is the one-line
 * summary the business page and search results read, so the two are always
 * saved together.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { summarizeHours, type OpeningHours } from '@/domain/hours';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OpeningHoursField } from '@/features/businesses/OpeningHoursField';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageHoursScreen() {
  return (
    <ManageGate
      title="Opening hours"
      intro="When you’re open. Customers see this on your page, and “Open now” filters run on it."
      need="owner"
      Form={HoursForm}
    />
  );
}

function HoursForm({ business, save, saving }: ManageFormProps) {
  const [openingHours, setOpeningHours] = useState<OpeningHours | undefined>(business.openingHours);

  return (
    <>
      <OpeningHoursField value={openingHours} onChange={setOpeningHours} />
      <Button
        title="Save"
        onPress={() => save({ openingHours, hours: summarizeHours(openingHours) })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
