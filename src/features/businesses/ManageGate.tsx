/**
 * The shell every Manage sub-screen shares.
 *
 * Manage used to be ONE giant form holding the listing's name, its photo, its
 * tags, its whole menu, its team routing and its modules — everything an owner
 * can change about a listing, in a single scroll with a single Save at the
 * bottom. It is now a hub of tiles (`app/manage/[businessId].tsx`), one per
 * job, and each tile opens a screen that does exactly that job.
 *
 * Twelve such screens would mean twelve copies of the same four things: load
 * the business, decide whether this viewer may edit it, write one slice of it,
 * go back. They live here instead, so a sub-screen is just its own fields plus
 * a Save button.
 *
 * TWO audiences, as before: the OWNER edits everything, while a team member
 * granted the "Menu & pricing" service (domain/access.ts) reaches the catalog
 * screens only — `need` is what separates them, and the hub hides the tiles a
 * member can't open so they never meet a refusal.
 */
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Business, Employee } from '@/domain/types';
import { canAccessService } from '@/domain/access';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { SuperAdminBanner } from './SuperAdminBanner';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { invalidate, keyOf } from '@/lib/queryCache';
import { EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

/** Cache key the hub and every sub-screen share, so a save refreshes the hub. */
export const manageKey = (businessId: string) => ['manage', businessId] as const;

export interface ManageFormProps {
  business: Business;
  employees: Employee[];
  isOwner: boolean;
  /** Write one slice of the listing and return to the hub. */
  save: (patch: Partial<Business>) => Promise<void>;
  saving: boolean;
}

export interface ManageGateProps {
  /**
   * Header title, e.g. "Opening hours". A function when the wording depends on
   * the listing — a stall lists "Items", a shop lists "Products". Note the
   * static title in `_layout.tsx` is what shows while the business loads.
   */
  title: string | ((business: Business) => string);
  /** One line under the title saying what this screen changes. */
  intro?: string | ((business: Business) => string);
  /**
   * Who may open it: `owner` for the listing's own settings (identity, team,
   * modules), `offerings` for the catalog — which a member granted
   * "Menu & pricing" edits too.
   */
  need: 'owner' | 'offerings';
  /** What this screen edits, for the super-admin banner ("tags"). */
  what?: string;
  Form: React.ComponentType<ManageFormProps>;
}

export function ManageGate({ title: rawTitle, intro: rawIntro, need, what, Form }: ManageGateProps) {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(
    async () => {
      const business = await repos.businesses.getById(businessId);
      if (!business) return null;
      const employees = await repos.employees.listByBusiness(business.id);
      return { business, employees };
    },
    [businessId],
    { key: manageKey(businessId) },
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const title = typeof rawTitle === 'function' ? rawTitle(data.business) : rawTitle;
  const intro = typeof rawIntro === 'function' ? rawIntro(data.business) : rawIntro;
  const meEmployee = data.employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isOwner = !!currentUser && currentUser.id === data.business.ownerId;
  const allowed =
    need === 'owner'
      ? isOwner
      : isOwner || canAccessService(data.business, meEmployee, currentUser, 'offerings');

  if (!allowed) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyView
          title="No access"
          subtitle={
            need === 'owner'
              ? 'Only the owner can change this.'
              : 'Only the owner, or a team member granted “Menu & pricing”, can edit this.'
          }
        />
      </Screen>
    );
  }

  const save = async (patch: Partial<Business>) => {
    setSaving(true);
    try {
      await repos.businesses.update(data.business.id, patch);
      // The hub reads its tile summaries off the same key — drop it so the
      // counts the owner just changed are right when they land back on it.
      invalidate(keyOf(manageKey(businessId)));
      Alert.alert('Saved', 'Your business page has been updated.');
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title }} />
      {!isOwner && isSuperAdminUser(currentUser) ? (
        <SuperAdminBanner businessName={data.business.name} what={what ?? title.toLowerCase()} />
      ) : null}
      {intro ? (
        <Text tone="muted" style={styles.intro}>
          {intro}
        </Text>
      ) : null}
      <Form
        business={data.business}
        employees={data.employees}
        isOwner={isOwner}
        save={save}
        saving={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.lg },
});
