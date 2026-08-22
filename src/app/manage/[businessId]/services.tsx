/**
 * Services offered — filed under the prebuilt sections in
 * `domain/offeringSections.ts` so a long list stays browsable on the page.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ServiceItem } from '@/domain/types';
import { SERVICE_SECTIONS, serviceJobs } from '@/domain/offeringSections';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingFolderEditor } from '@/features/businesses/OfferingFolderEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageServicesScreen() {
  return (
    <ManageGate
      title="Services"
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
      <OfferingFolderEditor
        value={services}
        onChange={setServices}
        sections={SERVICE_SECTIONS}
        noun="service"
        hint="Tap a section to add the work you do. Skip the ones you don’t."
        newSectionPlaceholder="Section name — e.g. Borewell, Solar"
        customIcon="🛠️"
        jobsFor={(section, kind) => serviceJobs(section.id, kind)}
        withDescription
        descriptionPlaceholder="What’s included (optional)"
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
