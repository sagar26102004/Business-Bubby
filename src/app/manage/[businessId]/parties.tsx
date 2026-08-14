/**
 * Party packages — the bundles a customer picks when they plan a function
 * with you. Guest limits and inclusions go in the name, because a package is
 * one priced line to the customer.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { PartyPackage } from '@/domain/types';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManagePartiesScreen() {
  return (
    <ManageGate
      title="Party packages"
      intro="Birthday, kitty party, family function… customers pick one when they plan a party with you. Put guest limits and inclusions in the name, e.g. “Birthday Buffet (min 15)”."
      need="offerings"
      what="party packages"
      Form={PartiesForm}
    />
  );
}

function PartiesForm({ business, save, saving }: ManageFormProps) {
  const [partyPackages, setPartyPackages] = useState<PartyPackage[]>(business.partyPackages ?? []);

  return (
    <>
      <OfferingsEditor
        value={partyPackages}
        onChange={setPartyPackages}
        namePlaceholder="Package (e.g. Birthday Buffet, min 15)"
        addLabel="Add package"
      />
      <Button
        title="Save"
        onPress={() =>
          save({ partyPackages: partyPackages.length > 0 ? partyPackages : undefined })
        }
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
