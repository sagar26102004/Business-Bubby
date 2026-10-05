/**
 * Request to enrol / subscribe. The customer-facing counterpart to the
 * workspace Members section: tapping "🎟️ Enroll" / "🔁 Subscribe" on a
 * membership business (gym, classes, tiffin, bus) lands here.
 *
 * The list it offers is the business's PLANS — its renewing services, kept
 * apart from the one-off ones precisely so that this screen and the order desk
 * stop competing over the same list (`domain/offerings.ts` → `planOfferings`,
 * which still reads a legacy membership listing's `services` as its plans).
 *
 * It supports enrolling more than one person in one go: the customer picks a
 * plan (or types one), taps "＋ Add", and names who it's for — a parent can
 * add the same swimming class twice, one per child. Each staged entry becomes
 * its OWN `pending` request the business accepts (setting the plan + price) or
 * declines in Members. Names are optional — a blank one falls back to
 * "Member 1", "Member 2"… so the business can still tell the requests apart.
 * It is NOT the order flow.
 *
 * A business can also ask for MORE than a name — a photo, a mobile number, an
 * address, anything the owner put on its joining form (`Business.enrollForm`,
 * built in Manage › Joining form). The form is drawn once per staged person, so
 * each child answers for themselves, and each request carries its own answers
 * through to the business's Members screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { PlanItem } from '@/domain/types';
import { useDismiss } from '@/lib/navigation';
import { commerceVocab, planBasisSticker } from '@/domain/catalog';
import { planOfferings } from '@/domain/offerings';
import {
  answerableFields,
  enrollFormFields,
  missingRequired,
  nameField,
  toAnswers,
} from '@/domain/enrollForm';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice } from '@/lib/money';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Text } from '@/components/ui';
import { EnrollFormFill } from '@/features/memberships/EnrollFormFill';
import { spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

/** One person being signed up: which plan, and who it's for. */
interface Enrollee {
  key: string;
  /** The chosen service / typed plan; undefined = a general request. */
  planName?: string;
  /** The chosen plan's monthly price, so the business can accept in one tap. */
  price?: number;
  /** Who the plan is for — blank falls back to a default label on submit. */
  name: string;
  /** This person's answers to the business's joining form, by field id. */
  answers: Record<string, string>;
}

let entryCounter = 0;
const nextKey = () => `e${++entryCounter}`;

/**
 * How a LISTED plan becomes a staged entry.
 *
 * A `Membership` is priced per month (`pricePerMonth`), and the whole
 * billing-cycle maths downstream is monthly — so only a monthly plan's price
 * can be handed over as a one-tap accept. A quarterly or yearly one carries
 * its period in the NAME instead ("Annual membership · per year") and leaves
 * the figure to the business, rather than filing ₹12,000 as a monthly fee.
 */
function stageFrom(plan: PlanItem): { planName: string; price?: number } {
  const monthly = !plan.basis || plan.basis === 'monthly';
  return {
    planName: monthly ? plan.name : `${plan.name} · ${planBasisSticker(plan.basis)}`,
    price: monthly ? parsePrice(plan.price) : undefined,
  };
}

export default function EnrollScreen() {
  // `plan` arrives when the customer tapped one row's ENROLL on the plans
  // catalog rather than the general button — that plan starts staged.
  const { businessId, plan: pickedPlan } = useLocalSearchParams<{
    businessId: string;
    plan?: string;
  }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/business/${businessId}`);
  const colors = useColors();
  const { currentUser } = useAuth();

  // The people being enrolled.
  const [entries, setEntries] = useState<Enrollee[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // What's missing, per staged entry — shown on the card itself so the customer
  // sees which person is incomplete, not just that something is.
  const [entryError, setEntryError] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Running tally of requests sent this visit — powers the stay-on-page banner
  // so a parent can keep adding one child after another without leaving.
  const [sentCount, setSentCount] = useState(0);

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  // Stage the plan they tapped, once — re-staging on every render would put a
  // removed entry straight back.
  const staged = useRef(false);
  useEffect(() => {
    if (staged.current || !business) return;
    if (pickedPlan) {
      staged.current = true;
      const match = planOfferings(business).find((p) => p.name === pickedPlan);
      if (!match) return;
      const { planName, price } = stageFrom(match);
      setEntries((list) => [...list, { key: nextKey(), planName, price, name: '', answers: {} }]);
      return;
    }
    // A business that lists no plans has nothing to pick, so the only thing on
    // this screen IS the person being enrolled — stage them up front, otherwise
    // a joining form would have no card to be drawn on.
    if (planOfferings(business).length === 0) {
      staged.current = true;
      setEntries((list) =>
        list.length > 0 ? list : [{ key: nextKey(), name: '', answers: {} }],
      );
    }
  }, [pickedPlan, business]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;

  if (!currentUser) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Enrol' }} />
        <EmptyView
          title="Sign in to enrol"
          subtitle="You need a One Place account so the plan can reach your Subscriptions."
        />
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  const vocab = commerceVocab(business);
  const verb = vocab.verb; // "Enroll" / "Subscribe"
  const plans = planOfferings(business);

  // The business's joining form. `formName` is the reserved name question: when
  // the owner put it on the form it relabels the one name box below (and can
  // make it compulsory) rather than adding a second one — see NAME_FIELD_ID.
  const formFields = enrollFormFields(business);
  const form = business.enrollForm;
  const formName = nameField(formFields);

  const addEntry = (planName?: string, price?: number) =>
    setEntries((list) => [...list, { key: nextKey(), planName, price, name: '', answers: {} }]);
  // Typing into a person's card clears THEIR "still needed" line — leaving it up
  // while they fix it reads as though the fix didn't register.
  const clearError = (key: string) => {
    setFormError(null);
    setEntryError((errs) => (errs[key] ? { ...errs, [key]: null } : errs));
  };
  const setName = (key: string, name: string) => {
    clearError(key);
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, name } : e)));
  };
  const setAnswer = (key: string, fieldId: string, value: string) => {
    clearError(key);
    setEntries((list) =>
      list.map((e) => (e.key === key ? { ...e, answers: { ...e.answers, [fieldId]: value } } : e)),
    );
  };
  const remove = (key: string) => {
    setEntries((list) => list.filter((e) => e.key !== key));
    setEntryError((errs) => ({ ...errs, [key]: null }));
  };

  const submit = async () => {
    // Nothing staged? Fall back to a single general request, so the button is
    // never a dead end (matches the old one-tap behaviour) — unless the business
    // asks something compulsory, which there would be nowhere to answer.
    const needsForm = formFields.some((f) => f.required);
    if (entries.length === 0 && needsForm) {
      setFormError(
        plans.length > 0
          ? `Add a plan above first — ${business.name} asks a few things before you join.`
          : 'Fill in the details above first.',
      );
      return;
    }
    const list: Enrollee[] =
      entries.length > 0
        ? entries
        : [{ key: 'solo', planName: undefined, price: undefined, name: '', answers: {} }];

    // Everything compulsory, per person, before anything is sent — a half-sent
    // batch would leave the business holding requests it can't act on.
    const errors: Record<string, string | null> = {};
    for (const e of entries) {
      const missing = missingRequired(formFields, e.answers);
      if (formName?.required && !e.name.trim()) missing.unshift(formName.label);
      errors[e.key] = missing.length > 0 ? `Still needed: ${missing.join(', ')}` : null;
    }
    setEntryError(errors);
    if (Object.values(errors).some(Boolean)) {
      setFormError('Fill in the marked details before sending.');
      return;
    }
    setFormError(null);

    setSubmitting(true);
    try {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        // Default nomenclature for a blank name — but only when the customer is
        // naming SEVERAL people; one request with no name stays about themselves.
        const enrolleeName =
          list.length > 1 ? e.name.trim() || `Member ${i + 1}` : e.name.trim() || undefined;
        await repos.memberships.request({
          businessId: business.id,
          customerId: currentUser.id,
          customerName: currentUser.name,
          requestedPlan: e.planName,
          requestedPrice: e.price,
          enrolleeName,
          formAnswers: toAnswers(formFields, e.answers),
        });
      }
      const n = list.length;
      // Stay on the page so more people can be added — just reset the form and
      // bump the sent tally, which the banner reflects.
      setSentCount((c) => c + n);
      setEntries([]);
      setEntryError({});
    } catch (err) {
      showAlert('Could not send', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: verb,
          headerRight:
            sentCount > 0
              ? () => (
                  <Text
                    tone="accent"
                    weight="semibold"
                    style={styles.headerDone}
                    onPress={dismiss}
                  >
                    Done
                  </Text>
                )
              : undefined,
        }}
      />

      <Text variant="title" weight="bold" style={styles.subtitle}>
        {verb} at {business.name}
      </Text>

      {sentCount > 0 ? (
        <View style={[styles.sentBanner, { backgroundColor: colors.successSoft, borderColor: colors.success }]}>
          <Text weight="semibold" tone="success">
            ✓ {sentCount} request{sentCount === 1 ? '' : 's'} sent
          </Text>
          <Text variant="caption" tone="muted" style={styles.sentHint}>
            {business.name} will set the plan{sentCount === 1 ? '' : 's'} and confirm — you'll be
            notified. Add another below, or tap Done to leave.
          </Text>
        </View>
      ) : null}

      {plans.length > 0 ? (
        <>
          <Text variant="label" weight="semibold" style={styles.label}>
            What would you like to join?
          </Text>
          {plans.map((s) => (
            <Card key={s.name} style={styles.serviceRow}>
              <View style={styles.serviceInfo}>
                <Text weight="medium">{s.name}</Text>
                {s.price ? (
                  <Text variant="caption" tone="brand">
                    {s.price} · {planBasisSticker(s.basis)}
                  </Text>
                ) : (
                  <Text variant="caption" tone="muted">
                    {planBasisSticker(s.basis)}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => {
                  const { planName, price } = stageFrom(s);
                  addEntry(planName, price);
                }}
                hitSlop={8}
                style={[styles.addBtn, { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}
                accessibilityRole="button"
                accessibilityLabel={`Add ${s.name}`}
              >
                <Text weight="bold" tone="brand" style={styles.addBtnText}>
                  ＋ Add
                </Text>
              </Pressable>
            </Card>
          ))}
        </>
      ) : null}

      {entries.length > 0 ? (
        <>
          <Text variant="label" weight="semibold" style={styles.label}>
            {answerableFields(formFields).length > 0 ? 'Their details' : "Who's it for?"}{' '}
            ({entries.length})
          </Text>
          {/* The owner's own line above the questions — "bring the original ID",
              "fees are due on the 5th". Shown once, not per person. */}
          {form?.intro ? (
            <Text variant="caption" tone="muted" style={styles.intro}>
              {form.intro}
            </Text>
          ) : null}
          {entries.map((e, i) => (
            <Card key={e.key} style={styles.enrolleeCard}>
              <View style={styles.enrolleeTop}>
                <Text weight="semibold" style={styles.enrolleePlan}>
                  {e.planName ?? 'General plan'}
                  {e.price != null ? ` · ${formatMoney(e.price)}/mo` : ''}
                </Text>
                <Text tone="danger" weight="semibold" onPress={() => remove(e.key)}>
                  ✕
                </Text>
              </View>
              <Input
                label={formName ? `${formName.label}${formName.required ? ' *' : ''}` : undefined}
                placeholder={
                  formName?.required
                    ? formName.label
                    : `Name (optional) — defaults to Member ${i + 1}`
                }
                value={e.name}
                onChangeText={(t) => setName(e.key, t)}
              />
              {form ? (
                <EnrollFormFill
                  form={form}
                  answers={e.answers}
                  onChange={(fieldId, value) => setAnswer(e.key, fieldId, value)}
                />
              ) : null}
              {entryError[e.key] ? (
                <Text variant="caption" tone="danger">
                  {entryError[e.key]}
                </Text>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {formError ? (
        <Text variant="caption" tone="danger" style={styles.formError}>
          {formError}
        </Text>
      ) : null}

      <Button
        title={
          entries.length > 1
            ? `Request ${verb.toLowerCase()} for ${entries.length}`
            : `Request to ${verb.toLowerCase()}`
        }
        onPress={submit}
        loading={submitting}
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  headerDone: { paddingHorizontal: spacing.md, fontSize: 16 },
  sentBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sentHint: { marginTop: spacing.xs },
  label: { marginBottom: spacing.sm, marginTop: spacing.md },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  serviceInfo: { flex: 1 },
  addBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  addBtnText: { fontSize: 14 },
  intro: { marginBottom: spacing.sm },
  formError: { marginTop: spacing.md },
  enrolleeCard: { marginBottom: spacing.sm },
  enrolleeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  enrolleePlan: { flex: 1 },
  submit: { marginTop: spacing.lg },
});
