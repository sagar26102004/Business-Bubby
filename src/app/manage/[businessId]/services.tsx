/**
 * Services offered — filed under the prebuilt sections in
 * `domain/offeringSections.ts` so a long list stays browsable on the page.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ServiceItem } from '@/domain/types';
import { SERVICE_SECTIONS } from '@/domain/offeringSections';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageServicesScreen() {
  return (
    <ManageGate
      title="Services"
      intro="Every job you take on, with what it costs. File each under a section so customers can browse instead of scroll."
      need="offerings"
      what="services"
      Form={ServicesForm}
    />
  );
}

function ServicesForm({ business, save, saving }: ManageFormProps) {
  const [services, setServices] = useState<ServiceItem[]>(business.services ?? []);

  return (
    <>
      <OfferingsEditor
        value={services}
        onChange={setServices}
        namePlaceholder="Service (e.g. Wheel alignment)"
        addLabel="Add service"
        sections={SERVICE_SECTIONS}
        sectionsLabel="What kind of service is it?"
        withDescription
        descriptionPlaceholder="What's included (optional)"
      />
      <Button
        title="Save"
        onPress={() => save({ services: services.length > 0 ? services : undefined })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
