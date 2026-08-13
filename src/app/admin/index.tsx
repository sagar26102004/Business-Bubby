/**
 * /admin — the platform console as its own screen (reached from Account, Dev
 * tools, or a deep link). Super-admins also get exactly this on the business
 * side of the app: see `app/(tabs)/my-business.tsx`, which mounts the same
 * `AdminConsole` instead of a list of shops.
 */
import { Screen } from '@/components/ui';
import { AdminConsole } from '@/features/admin/AdminConsole';
import { AdminGate } from '@/features/admin/AdminGate';

export default function AdminScreen() {
  return (
    <Screen scroll>
      <AdminGate>
        <AdminConsole />
      </AdminGate>
    </Screen>
  );
}
