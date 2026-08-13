/**
 * The door on every platform-admin screen. The real enforcement is in the
 * database (RLS + `platform_admins`, see domain/superAdmin.ts) — this just
 * keeps the screens out of the way of everyone else, and says why.
 */
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth } from '@/data/DataProvider';
import { Button, LoadingView, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export function AdminGate({ children }: { children: ReactNode }) {
  const { currentUser, authLoading } = useAuth();
  const router = useRouter();

  if (authLoading) return <LoadingView />;

  if (!isSuperAdminUser(currentUser)) {
    return (
      <View style={styles.denied}>
        <Text style={styles.icon}>🛡️</Text>
        <Text variant="heading" weight="bold" style={styles.title}>
          Admins only
        </Text>
        <Text tone="muted" style={styles.sub}>
          This is the platform console. Sign in with a super-admin account to open it.
        </Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={styles.btn} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  denied: { alignItems: 'center', paddingTop: spacing.xxl },
  icon: { fontSize: 44 },
  title: { marginTop: spacing.md, textAlign: 'center' },
  sub: { marginTop: spacing.sm, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: spacing.lg },
});
