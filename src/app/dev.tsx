/**
 * Dev Tools — a manual testing harness (not part of the product).
 *
 * Switch identity, spin up test accounts and businesses, reset the demo data,
 * and jump straight to key screens. On web you can also reach this at /dev.
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { GeoPoint, ListingType } from '@/domain/types';
import type { NewBusinessInput } from '@/data/repositories';
import { LISTING_TYPES } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, Input, Screen, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** A randomized business near a point, for quickly populating the app. */
function randomBusiness(near: GeoPoint): NewBusinessInput {
  const type = rand(LISTING_TYPES);
  const sub = rand(type.subcategories);
  return {
    name: `${sub.name} ${type.singular} #${Math.floor(Math.random() * 900 + 100)}`,
    tagline: 'Generated for testing',
    type: type.id as ListingType,
    subcategoryId: sub.id,
    priceLabel: rand(['$', '$$', 'from $20', '$15/day', '']) || undefined,
    location: {
      kind: 'office',
      isHome: false,
      hidePreciseLocation: false,
      city: 'Riverton',
      region: 'CA',
      point: {
        latitude: near.latitude + (Math.random() - 0.5) * 0.06,
        longitude: near.longitude + (Math.random() - 0.5) * 0.06,
      },
    },
    employees: [],
  };
}

export default function DevToolsScreen() {
  const router = useRouter();
  const { currentUser, isGuest, signInAs, signOut, resetData } = useAuth();
  const repos = useRepositories();

  const [newName, setNewName] = useState('');
  const [working, setWorking] = useState(false);

  const { data: users, reload: reloadUsers } = useAsync(() => repos.users.list(), []);
  const { data: businesses, reload: reloadBiz } = useAsync(
    () => repos.businesses.list(),
    [currentUser?.id],
  );

  const addAccount = async () => {
    const name = newName.trim();
    if (name.length < 2) return;
    setWorking(true);
    try {
      const user = await repos.users.create({ name });
      setNewName('');
      // On real backends, creating an account signs you in as them (that's how
      // the account is provisioned); sync app state so the switch takes effect.
      // On the mock this is a harmless re-select of the same user.
      await signInAs(user.id);
      reloadUsers();
      Alert.alert('Account added', `Created "${user.name}" and switched to them.`);
    } finally {
      setWorking(false);
    }
  };

  const requireUser = (): string | null => {
    if (!currentUser) {
      Alert.alert('Sign in first', 'Pick an account under Identity above to own the business.');
      return null;
    }
    return currentUser.id;
  };

  const addBusiness = async () => {
    const ownerId = requireUser();
    if (!ownerId) return;
    setWorking(true);
    try {
      const center = await repos.places.getCurrentPlace();
      const created = await repos.businesses.create(randomBusiness(center.point), ownerId);
      reloadBiz();
      Alert.alert('Business added', `"${created.name}" created near you, owned by ${currentUser?.name}.`);
    } finally {
      setWorking(false);
    }
  };

  const addManyBusinesses = async () => {
    const ownerId = requireUser();
    if (!ownerId) return;
    setWorking(true);
    try {
      const center = await repos.places.getCurrentPlace();
      for (let i = 0; i < 5; i++) {
        await repos.businesses.create(randomBusiness(center.point), ownerId);
      }
      reloadBiz();
      Alert.alert('Added', '5 random businesses created near you.');
    } finally {
      setWorking(false);
    }
  };

  const doReset = () => {
    resetData();
    reloadUsers();
    reloadBiz();
    Alert.alert('Reset', 'Demo data restored and signed out.');
    router.replace('/');
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '🧪 Dev tools' }} />

      {/* Identity */}
      <Section title="Identity">
        <Card style={styles.card}>
          <Text weight="semibold">
            {isGuest ? 'Browsing as guest' : `Signed in as ${currentUser?.name}`}
          </Text>
          <Text variant="caption" tone="muted">
            {isGuest ? 'Home/Work and publishing are gated.' : `id: ${currentUser?.id}`}
          </Text>
        </Card>

        <Text variant="caption" tone="muted" style={styles.hint}>
          Switch identity to test owner-only screens, private profiles, and chat as different people.
        </Text>
        <View style={styles.pillRow}>
          <Tag label="🚪 Guest (sign out)" selected={isGuest} onPress={() => signOut()} />
          {(users ?? []).map((u) => (
            <Tag
              key={u.id}
              label={`${u.name}${u.isProfilePublic ? '' : ' 🔒'}`}
              selected={currentUser?.id === u.id}
              onPress={() => signInAs(u.id)}
            />
          ))}
        </View>
      </Section>

      {/* Add account */}
      <Section title="Add a test account">
        <Input
          label="Name"
          placeholder="e.g. Priya Sharma"
          value={newName}
          onChangeText={setNewName}
        />
        <Button
          title="➕ Create account"
          variant="secondary"
          onPress={addAccount}
          loading={working}
          disabled={newName.trim().length < 2}
        />
      </Section>

      {/* Add businesses */}
      <Section title="Add test businesses">
        <Text variant="caption" tone="muted" style={styles.hint}>
          {businesses?.length ?? '…'} businesses loaded. New ones are placed near your current
          location and owned by whoever you're signed in as (or the demo user as a guest).
        </Text>
        <Button title="➕ Add a random business" variant="secondary" onPress={addBusiness} loading={working} />
        <Button
          title="➕➕ Add 5 random businesses"
          variant="secondary"
          onPress={addManyBusinesses}
          loading={working}
          style={styles.stack}
        />
        <Button
          title="📝 Open full register form"
          variant="ghost"
          onPress={() => router.push('/register')}
          style={styles.stack}
        />
      </Section>

      {/* Data */}
      <Section title="Data">
        <Button title="♻️ Reset all demo data" variant="secondary" onPress={doReset} />
      </Section>

      {/* Jump to screens */}
      <Section title="Jump to a screen">
        <View style={styles.pillRow}>
          <Tag label="🗺️ Map" onPress={() => router.push('/map')} />
          <Tag label="💬 Chats & alerts" onPress={() => router.push('/chats')} />
          <Tag label="🔐 Sign in" onPress={() => router.push('/sign-in')} />
        </View>
        <Text variant="caption" tone="muted" style={styles.jumpHint}>
          Open any business (then reach its chat, workspace, inbox & manage from there):
        </Text>
        <View style={styles.pillRow}>
          {(businesses ?? []).map((b) => (
            <Tag key={b.id} label={`🏢 ${b.name}`} onPress={() => router.push(`/business/${b.id}`)} />
          ))}
        </View>
      </Section>

      {/* Chat testing */}
      <Section title="Test chat end-to-end">
        <Text variant="caption" tone="muted" style={styles.hint}>
          Chat is now two-sided (no bot). Send as a customer, then read & reply from the
          business inbox.
        </Text>
        <Card style={styles.card}>
          <Text weight="semibold">1 · Send as a customer</Text>
          <Text variant="caption" tone="muted" style={styles.scenarioBody}>
            Sign in as any account (or stay Guest) → open a business → 💬 Chat → drop a message. It’s
            one simple conversation with the business.
          </Text>
        </Card>
        <Card style={styles.card}>
          <Text weight="semibold">2 · Reply as a team member</Text>
          <Text variant="caption" tone="muted" style={styles.scenarioBody}>
            Sign in as the owner or an employee with chat access → open the business → 🏢 Workspace →
            📥 Inbox → open the conversation → reply. It’s attributed “‹you› from ‹business›”.
          </Text>
        </Card>
        <Card style={styles.card}>
          <Text weight="semibold">3 · Customer gets notified</Text>
          <Text variant="caption" tone="muted" style={styles.scenarioBody}>
            Switch back to the customer → the 🔔 Alerts tab shows a badge → open it → tap the
            notification → it jumps into the chat with the reply labelled by who answered.
          </Text>
        </Card>
      </Section>

      {/* Scenarios */}
      <Section title="Try these scenarios">
        {SCENARIOS.map((s, i) => (
          <Card key={i} style={styles.card}>
            <Text weight="semibold">{s.title}</Text>
            <Text variant="caption" tone="muted" style={styles.scenarioBody}>
              {s.steps}
            </Text>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const SCENARIOS = [
  {
    title: 'Guest gating',
    steps: 'As Guest → Browse → open the location dropdown → tap "Home" or "Work" → you should hit Sign in.',
  },
  {
    title: 'Dine-in or takeaway order',
    steps:
      'Sign in as Sagar → open Cafe Neighborhood or Shreemaya → 🛒 Order → pick from the menu → choose Dine in / Take away → send. Then sign in as Priya Nair / Ashok Malhotra and review it from the workspace.',
  },
  {
    title: 'Bargain at the stall',
    steps:
      'Open Mira’s Handcrafts → 🛒 Buy an item → type your offer price → send. Sign in as Mira Sharma to accept the offer or counter it from the order.',
  },
  {
    title: 'Owner manages routing',
    steps: 'Sign in as Rohan Mehta → open Cafe Neighborhood → ⚙️ Manage → toggle who attends calls / receives chat → Save.',
  },
  {
    title: 'Chat with a business',
    steps: 'Open Shreemaya → 💬 Chat → send a message; a team member replies as themselves from the Inbox.',
  },
  {
    title: 'Add + find your own listing',
    steps: 'Create a test account → sign in as them → Add a random business → find it in the Browse list and on the Map.',
  },
  {
    title: 'Track a child on the school bus',
    steps:
      'Sign in as Sagar → open Arvind School Bus → 📍 Track my child → the school bus (Aarav’s ride) moves live — Ramesh is sharing. Other parents (Pooja/Neha/Rakesh) see only their own child’s van.',
  },
  {
    title: 'Share your location as a driver',
    steps:
      'Sign in as Ramesh Kumar → Arvind School Bus → 🏢 Workspace → toggle “📡 Share my live location” off/on, then watch the live map. Arvind manages the fleet in 🚌 Fleet & tracking.',
  },
  {
    title: 'Rental status & distances',
    steps:
      'Browse → Rentals → Shraddha Rentals shows a green Available pill and distances from you/Home/Work. Sign in as Shraddha Patil → ⚙️ Manage → flip to 🔴 Rented and watch the card change.',
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.xl },
  sectionTitle: { marginBottom: spacing.md },
  card: { marginBottom: spacing.sm },
  hint: { marginBottom: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  jumpHint: { marginTop: spacing.md, marginBottom: spacing.sm },
  stack: { marginTop: spacing.sm },
  scenarioBody: { marginTop: spacing.xs },
});
