/**
 * Taking a listing down — the owner's own delete, and the platform console's.
 *
 * ⚠️ ONE PLACE ON PURPOSE. This is the app's most destructive action after
 * closing an account: `BusinessRepository.remove` cascades, so the page, the
 * team, every order, bill, booking, membership, review, chat, call and ad
 * campaign go with it — including the customers' copies. The warning copy and
 * the type-the-name rule therefore live HERE, not in each screen, so the two
 * places that offer it can never end up warning about different things.
 *
 * Who may: the OWNER, and only their own listing — enforced by the repository,
 * by RLS (`businesses_delete`, migration 0002) and again here. A super-admin
 * who needs a stranger's listing gone hands it to themselves with
 * `reassignOwner` first; deleting someone else's shop is not a platform power.
 *
 * Two exports because the two callers need different shells:
 *   • `DeleteListingPanel` — the confirmation itself, always visible. The admin
 *     console renders it inside a row it has already expanded.
 *   • `DeleteListing` — the whole danger zone, collapsed behind a button. What
 *     Manage puts at the bottom of the screen.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Business } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Button, Input, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

/** A stall is a person's own pitch, not a shop — call it what they call it. */
const nounFor = (business: Business): string =>
  business.type === 'item' ? 'stall' : 'listing';

export interface DeleteListingPanelProps {
  business: Business;
  /** Called after the listing is gone — navigate away, or reload a list. */
  onDeleted: () => void;
}

export function DeleteListingPanel({ business, onDeleted }: DeleteListingPanelProps) {
  const { currentUser } = useAuth();
  const repos = useRepositories();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noun = nounFor(business);
  // Case- and space-insensitive: the point is to make the person read the name
  // and mean it, not to test their typing.
  const confirmed = typed.trim().toLowerCase() === business.name.trim().toLowerCase();

  const remove = async () => {
    if (!currentUser || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await repos.businesses.remove(business.id, currentUser.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not remove that ${noun}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text variant="caption" tone="danger">
        This deletes the page and everything on it — your team, every order, bill and booking, your
        members and reviews, all customer chats, the call log and any ad campaign. Your customers
        lose their copies too. It can’t be undone.
      </Text>
      <Input
        label={`Type “${business.name}” to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        title={`Delete this ${noun}`}
        variant="secondary"
        onPress={remove}
        loading={busy}
        disabled={!confirmed}
      />
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export interface DeleteListingProps {
  business: Business;
  onDeleted: () => void;
}

/**
 * The collapsed danger zone. Closed it is one quiet line — a screen people open
 * to edit their opening hours should not have a delete button sitting under
 * their thumb — and opening it is itself the first of the two deliberate steps.
 */
export function DeleteListing({ business, onDeleted }: DeleteListingProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const noun = nounFor(business);

  return (
    <View style={[styles.zone, { borderTopColor: colors.border }]}>
      <Text variant="label" weight="semibold" style={{ color: colors.danger }}>
        Danger zone
      </Text>
      <Text variant="caption" tone="muted" style={styles.sub}>
        {open
          ? `Taking the ${noun} down removes it from One Place for good.`
          : `Closed for good? You can take this ${noun} down. Everything on it goes with it.`}
      </Text>

      {open ? (
        <>
          <DeleteListingPanel business={business} onDeleted={onDeleted} />
          <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
        </>
      ) : (
        <Button
          title={`Take this ${noun} down`}
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm, marginTop: spacing.md },
  zone: {
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sub: { marginTop: spacing.xs, marginBottom: spacing.md },
});
