/**
 * Access & permissions now lives on Workspace › Team & access (team.tsx). This
 * route stays so old links and bookmarks still land in the right place.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function WorkspaceAccessRedirect() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  return <Redirect href={`/workspace/${businessId}/team`} />;
}
