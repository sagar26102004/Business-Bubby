/**
 * Business workspace for one business, reached from a deep link, a
 * notification or the Workspace tab's business list. The hub itself lives in
 * `features/workspace/WorkspaceHub.tsx` and is shared with the Workspace tab.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { WorkspaceHub } from '@/features/workspace/WorkspaceHub';

export default function WorkspaceScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Workspace' }} />
      <WorkspaceHub businessId={businessId} />
    </>
  );
}
