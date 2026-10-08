/**
 * The "not active for this business" gate.
 *
 * Bulk-listed businesses (scripts/list-business) are OWNED by a platform admin
 * until the real owner takes them over, so nobody is behind their Call, Chat,
 * Order, Book or Enroll buttons. Every one of those buttons runs through
 * `guard()` first: on a platform-held listing it opens a small popup instead of
 * carrying on; everywhere else it just carries on.
 *
 * The admin ids are fetched ONCE per app session (`listPlatformAdminIds`,
 * migration 0024) and every listing is checked against them locally — a Home
 * feed of 100 cards costs one request, not 100. A failed fetch means "no
 * admins", so the gate can only ever fail OPEN, never lock a real business.
 *
 * The admin themself is never gated on a listing they hold, so they can still
 * test the flows.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Business } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import type { Repositories } from '@/data/repositories';
import { Button, Icon, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** What was tapped — the popup's heading reads "<service> isn't active yet". */
export type GatedService = 'Calling' | 'Chat' | 'Ordering' | 'Booking' | 'Enrolling';

let adminIds: Promise<Set<string>> | null = null;

/** The platform admins' ids, fetched once and shared by every screen. */
function platformAdminIds(repos: Repositories): Promise<Set<string>> {
  if (!adminIds) {
    adminIds = repos.users
      .listPlatformAdminIds()
      .then((ids) => new Set(ids))
      .catch(() => {
        adminIds = null; // try again next time rather than caching the failure
        return new Set<string>();
      });
  }
  return adminIds;
}

/**
 * `guard(business, service, go)` — runs `go` unless the listing is held by the
 * platform, in which case it opens the popup. Render `popup` once on the screen.
 */
export function useServiceGate(): {
  guard: (business: Pick<Business, 'name' | 'ownerId'>, service: GatedService, go: () => void) => void;
  popup: ReactNode;
} {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const [blocked, setBlocked] = useState<{ name: string; service: GatedService } | null>(null);

  const guard = useCallback(
    (business: Pick<Business, 'name' | 'ownerId'>, service: GatedService, go: () => void) => {
      void platformAdminIds(repos).then((ids) => {
        const held = ids.has(business.ownerId) && currentUser?.id !== business.ownerId;
        if (held) setBlocked({ name: business.name, service });
        else go();
      });
    },
    [repos, currentUser?.id],
  );

  const popup = (
    <InactiveServicePopup
      service={blocked?.service}
      businessName={blocked?.name}
      onClose={() => setBlocked(null)}
    />
  );

  return { guard, popup };
}

function InactiveServicePopup({
  service,
  businessName,
  onClose,
}: {
  service?: GatedService;
  businessName?: string;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={!!service} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.popup, { backgroundColor: colors.surface }]}>
          <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
            <Icon name="info" size={22} color={colors.brandText} />
          </View>
          <Text variant="subheading" weight="bold" style={styles.center}>
            {service} isn't active yet
          </Text>
          <Text tone="muted" style={styles.center}>
            This service is not active for {businessName}. The business hasn't set up its account
            on One Place yet, so there's no one to answer here.
          </Text>
          <Button title="OK" onPress={onClose} style={styles.ok} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  popup: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  center: { textAlign: 'center' },
  ok: { alignSelf: 'stretch', marginTop: spacing.md },
});
