/**
 * Workspace tab (One Place redesign) — the business side of the app, one tap
 * from the bottom bar. It opens straight onto the WORKSPACE HUB of the
 * business you last worked in, with a "‹Business› ▾" switcher in the header for
 * anyone who owns or works at more than one. The pick is remembered on this
 * device.
 *
 *  - Guests: a sign-in prompt.
 *  - Nobody's business yet: an empty state that leads to registration.
 *  - A platform super-admin: their "business" is the app itself, so this tab
 *    shows the PLATFORM CONSOLE (`features/admin/AdminConsole.tsx`) instead.
 *
 * Supplier (B2B) chats and "list another business" sit in the header.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import type { Business } from '@/domain/types';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Button, Card, Icon, IconTile, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { AdminConsole } from '@/features/admin/AdminConsole';
import { WorkspaceHub } from '@/features/workspace/WorkspaceHub';
import { radius, spacing, useColors } from '@/theme/theme';
import { isListedPublicly } from '@/lib/onHold';

const LAST_BUSINESS_KEY = 'localo.workspace.lastBusinessId';

async function readLastBusiness(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_BUSINESS_KEY);
  } catch {
    return null;
  }
}
async function writeLastBusiness(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_BUSINESS_KEY, id);
  } catch {
    // A convenience only — the first business is a fine fallback.
  }
}

export default function WorkspaceTab() {
  const { currentUser, isGuest } = useAuth();
  const repos = useRepositories();
  const router = useRouter();

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A super-admin runs the platform, not a shop — don't load a list they'll never see.
  const isAdmin = isSuperAdminUser(currentUser);

  const load = useCallback(() => {
    if (!currentUser || isAdmin) {
      setBusinesses([]);
      return;
    }
    Promise.all([
      repos.businesses.list(),
      repos.employees.listBusinessesForUser(currentUser.id),
    ])
      .then(([all, memberOf]) => {
        const mine = all.filter((b) => b.ownerId === currentUser.id);
        const byId = new Map(mine.map((b) => [b.id, b]));
        memberOf.forEach((b) => byId.set(b.id, b));
        // ON HOLD (redesign 2026-10): stall — a personal stall has no workspace here.
        setBusinesses(Array.from(byId.values()).filter(isListedPublicly));
      })
      .catch(() => setBusinesses([]));
  }, [repos, currentUser, isAdmin]);

  // Refresh whenever the tab regains focus (e.g. after registering one).
  useFocusEffect(useCallback(() => load(), [load]));

  // Pick the remembered business once the list is in, else the first one.
  useEffect(() => {
    if (!businesses || businesses.length === 0) return;
    if (selectedId && businesses.some((b) => b.id === selectedId)) return;
    let active = true;
    void readLastBusiness().then((last) => {
      if (!active) return;
      const pick = businesses.find((b) => b.id === last) ?? businesses[0];
      setSelectedId(pick.id);
    });
    return () => {
      active = false;
    };
  }, [businesses, selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    void writeLastBusiness(id);
  };

  const noHeader = <Tabs.Screen options={{ headerShown: false }} />;

  if (isGuest) {
    return (
      <Screen scroll>
        {noHeader}
        <WorkspaceHeader title="Workspace" subtitle="Run your business on One Place" />
        <EmptyWorkspace
          title="Run a business? List it on One Place."
          body="Sign in to register a business, manage your team, take orders and answer customer chats."
          cta="Sign in / Sign up"
          onPress={() => router.push('/sign-in')}
        />
      </Screen>
    );
  }

  if (isAdmin) {
    return (
      <Screen scroll>
        {noHeader}
        <WorkspaceHeader title="Platform console" subtitle="One Place · super-admin" />
        <AdminConsole />
      </Screen>
    );
  }

  if (businesses === null) return <LoadingView />;

  if (businesses.length === 0) {
    return (
      <Screen scroll>
        {noHeader}
        <WorkspaceHeader title="Workspace" subtitle="Your business, in one place" />
        <EmptyWorkspace
          title="You don’t have a business here yet"
          body="List a shop, a service or something you rent out — it takes a few minutes, and everything can be changed later."
          cta="List your business"
          onPress={() => router.push('/register')}
        />
      </Screen>
    );
  }

  const selected = businesses.find((b) => b.id === selectedId) ?? businesses[0];

  return (
    <>
      {noHeader}
      <WorkspaceHub
        key={selected.id}
        businessId={selected.id}
        header={
          <WorkspaceHeader
            title={selected.name}
            subtitle={
              selected.ownerId === currentUser?.id ? 'Workspace · Owner' : 'Workspace · Team member'
            }
            businesses={businesses}
            selectedId={selected.id}
            onSelect={select}
            onB2B={() => router.push('/b2b')}
            onAdd={() => router.push('/register')}
            onOpenPage={() => router.push(`/business/${selected.id}`)}
          />
        }
      />
    </>
  );
}

/**
 * The linen header sheet: business name with a ▾ switcher, its role line, and
 * header actions (supplier chats, list another business). Bleeds to the edges
 * of the Screen's padding.
 */
function WorkspaceHeader({
  title,
  subtitle,
  businesses,
  selectedId,
  onSelect,
  onB2B,
  onAdd,
  onOpenPage,
}: {
  title: string;
  subtitle: string;
  businesses?: Business[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onB2B?: () => void;
  onAdd?: () => void;
  onOpenPage?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const canSwitch = !!businesses && businesses.length > 1;

  return (
    <View
      style={[
        styles.sheet,
        {
          paddingTop: insets.top + spacing.md,
          backgroundColor: colors.headerTint,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.headRow}>
        <IconTile icon="store" size={40} solid />
        <Pressable
          style={styles.flex}
          disabled={!canSwitch}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole={canSwitch ? 'button' : undefined}
          accessibilityLabel={canSwitch ? `Switch business, current ${title}` : undefined}
        >
          <View style={styles.titleRow}>
            <Text variant="subheading" weight="bold" numberOfLines={1} style={styles.shrink}>
              {title}
            </Text>
            {canSwitch ? (
              <Icon name="chevronDown" size={18} color={colors.text} />
            ) : null}
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </Pressable>
        {onOpenPage ? (
          <HeaderIcon icon="store" label="View your public page" onPress={onOpenPage} />
        ) : null}
        {onB2B ? <HeaderIcon icon="chat" label="Supplier chats" onPress={onB2B} /> : null}
        {onAdd ? <HeaderIcon icon="plus" label="List another business" onPress={onAdd} /> : null}
      </View>

      {open && businesses ? (
        <Card padded={false} style={styles.menu}>
          {businesses.map((b, i) => {
            const on = b.id === selectedId;
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  setOpen(false);
                  onSelect?.(b.id);
                }}
                style={({ pressed }) => [
                  styles.menuRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text weight={on ? 'bold' : 'medium'} style={styles.flex} numberOfLines={1}>
                  {b.name}
                </Text>
                {on ? <Tag label="Current" tone="status" size="sm" /> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

function HeaderIcon({
  icon,
  label,
  onPress,
}: {
  icon: 'chat' | 'plus' | 'store';
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.headIcon,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icon name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

function EmptyWorkspace({
  title,
  body,
  cta,
  onPress,
}: {
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
}) {
  return (
    <Card style={styles.empty}>
      <IconTile icon="store" size={64} />
      <Text variant="subheading" weight="bold" style={styles.center}>
        {title}
      </Text>
      <Text tone="muted" style={styles.center}>
        {body}
      </Text>
      <Button title={cta} onPress={onPress} style={styles.cta} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  // Bleed the header sheet to the screen edges (Screen adds lg padding on all
  // sides, including top — cancel it so the sheet starts at the very top).
  sheet: {
    marginTop: -spacing.lg,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: { marginTop: spacing.md },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  center: { textAlign: 'center' },
  cta: { alignSelf: 'stretch', marginTop: spacing.sm },
});
