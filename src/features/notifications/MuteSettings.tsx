/**
 * "Manage notifications" — one toggle per alert family, either scoped to a
 * single business (opened from its workspace) or applied everywhere (opened
 * from the Alerts tab).
 *
 * Muting only silences the ALERT. The orders, calls and messages themselves
 * keep arriving and stay visible in the workspace — which is exactly why a
 * cafe owner can safely turn order pings off during a rush.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import {
  NOTIFICATION_CATEGORIES,
  isCategoryMuted,
  toggleMute,
  type NotificationCategory,
} from '@/domain/notifications';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Card, EmptyView, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

interface MuteSettingsProps {
  /** Scope the toggles to one business; omit for "everywhere". */
  businessId?: string;
  /** Shown under the heading, e.g. the business name. */
  scopeLabel?: string;
  /** Only offer these families (a stall owner has no appointments). */
  categories?: NotificationCategory[];
}

export function MuteSettings({ businessId, scopeLabel, categories }: MuteSettingsProps) {
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser, setCurrentUser, isGuest } = useAuth();

  // Local mirror so a toggle flips instantly, with the save behind it.
  const [mutes, setMutes] = useState<string[]>(currentUser?.mutedNotifications ?? []);
  const [busy, setBusy] = useState<NotificationCategory | null>(null);
  useEffect(() => {
    setMutes(currentUser?.mutedNotifications ?? []);
  }, [currentUser?.mutedNotifications]);

  if (!currentUser || isGuest) {
    return (
      <EmptyView
        title="Sign in first"
        subtitle="Notification settings are saved to your account."
      />
    );
  }

  const list = categories
    ? NOTIFICATION_CATEGORIES.filter((c) => categories.includes(c.id))
    : NOTIFICATION_CATEGORIES;

  const setMuted = async (category: NotificationCategory, muted: boolean) => {
    const next = toggleMute(mutes, category, businessId, muted);
    const previous = mutes;
    setMutes(next); // optimistic
    setBusy(category);
    try {
      const updated = await repos.users.update(currentUser.id, { mutedNotifications: next });
      setCurrentUser(updated);
    } catch {
      setMutes(previous);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <Text variant="caption" tone="muted" style={styles.intro}>
        Turn a family off and it stops reaching your Alerts tab and the badge
        {scopeLabel ? ` for ${scopeLabel}` : ''}. Nothing is lost — orders, calls and messages are
        all still in the workspace whenever you want to look.
      </Text>

      {list.map((cat) => {
        // A family silenced everywhere stays visibly off on a business screen,
        // and can't be half-unmuted there — say so instead of lying.
        const mutedEverywhere = businessId ? isCategoryMuted(mutes, cat.id) : false;
        const muted = isCategoryMuted(mutes, cat.id, businessId);
        return (
          <Card key={cat.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.icon}>{cat.icon}</Text>
              <View style={styles.info}>
                <Text weight="semibold">{cat.label}</Text>
                <Text variant="caption" tone="muted">
                  {mutedEverywhere ? 'Muted everywhere — turn it back on from the Alerts tab.' : cat.description}
                </Text>
              </View>
              <Switch
                value={!muted}
                onValueChange={(on) => setMuted(cat.id, !on)}
                disabled={busy === cat.id || mutedEverywhere}
                trackColor={{ true: colors.brand }}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { fontSize: 22 },
  info: { flex: 1 },
});
