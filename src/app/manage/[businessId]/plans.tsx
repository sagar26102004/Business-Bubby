/**
 * Plans & memberships — the RENEWING half of what a business does for people
 * (a gym membership, a class batch, a tiffin or bus plan), filed under the
 * prebuilt sections in `domain/offeringSections.ts`.
 *
 * The twin of the Services screen, deliberately: same editor, same folders,
 * same photos. The only differences are the library and the period chips, and
 * they exist because a plan is ENROLLED in (`app/enroll` → a pending
 * Membership) while a service is REQUESTED (the orders desk).
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { PlanItem } from '@/domain/types';
import { PLAN_BASES } from '@/domain/catalog';
import { PLAN_SECTIONS } from '@/domain/offeringSections';
import { hasModule } from '@/domain/modules';
import { planOfferings, usesServicesAsPlans } from '@/domain/offerings';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingFolderEditor } from '@/features/businesses/OfferingFolderEditor';
import { Button, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManagePlansScreen() {
  return <ManageGate title="Plans & memberships" need="offerings" what="plans" Form={PlansForm} />;
}

function PlansForm({ business, save, saving }: ManageFormProps) {
  // A membership business listed before plans had a list of their own kept
  // them in `services`; `planOfferings` reads those, so opening this screen
  // shows what the page already shows. Saving files them where they belong.
  const [plans, setPlans] = useState<PlanItem[]>(planOfferings(business));
  // True only for a joinable business whose `services` ARE its plans — never
  // for an electrician who simply hasn't listed a plan yet, whose services
  // must not be touched.
  const movedFromServices = usesServicesAsPlans(business);

  // A plan nobody can join is a dead end: enrolling lands in the Members
  // section, which only exists while the memberships tool is on.
  const canJoin = hasModule(business, 'memberships');

  return (
    <>
      {!canJoin ? (
        <Text variant="caption" tone="muted" style={styles.note}>
          Turn on “Members” in Workspace tools to let customers enrol — until then these
          plans are listed on your page without a join button.
        </Text>
      ) : null}
      {movedFromServices ? (
        <Text variant="caption" tone="muted" style={styles.note}>
          These were listed under Services. Saving moves them here, where customers enrol in
          them — your Services list is left for one-off work.
        </Text>
      ) : null}
      <OfferingFolderEditor
        value={plans}
        onChange={setPlans}
        sections={PLAN_SECTIONS}
        noun="plan"
        hint="Tap what people can join — a membership, a batch, a monthly delivery."
        newSectionPlaceholder="Section name — e.g. Swimming, Library"
        customIcon="🎟️"
        withDescription
        descriptionPlaceholder="What’s included (optional)"
        basisOptions={PLAN_BASES}
        basisDefault="monthly"
        basisLabel="Renews…"
      />
      <Button
        title="Save"
        onPress={() =>
          save({
            plans: plans.length > 0 ? plans : undefined,
            // The legacy list is emptied as it's moved, so the same plans can
            // never show up twice — once to enrol in, once to request.
            ...(movedFromServices && plans.length > 0 ? { services: undefined } : {}),
          })
        }
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  note: { marginBottom: spacing.md },
  save: { marginTop: spacing.lg },
});
