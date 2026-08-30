/**
 * B2B thread — the conversation between TWO businesses
 * (?me=<my business id>&other=<their business id>). Any member of either
 * side reads and replies as their business; bubbles are attributed
 * "<member> · <business>". Members-only, like the workspace.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { BizChatMessage } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { CHAT_REFRESH_MS, useAsync } from '@/lib/useAsync';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { EmptyView, ErrorView, LoadingView, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function B2BChatScreen() {
  const { me, other } = useLocalSearchParams<{ me: string; other: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [thread, setThread] = useState<BizChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<BizChatMessage>>(null);

  // The composer lifting shrinks the list — follow it down so the last message
  // stays in view instead of sliding under the keyboard.
  useEffect(() => {
    if (keyboard > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [keyboard]);

  const { data, loading, error, reload } = useAsync(async () => {
    const [mine, theirs, employees] = await Promise.all([
      repos.businesses.getById(me),
      repos.businesses.getById(other),
      repos.employees.listByBusiness(me),
    ]);
    const isMember =
      !!currentUser &&
      !!mine &&
      (mine.ownerId === currentUser.id ||
        employees.some((e) => e.userId === currentUser.id));
    return { mine, theirs, isMember };
  }, [me, other, currentUser?.id]);

  // Re-read the conversation every few seconds while it's on screen, so the
  // other business's replies arrive without leaving and coming back.
  const threadKey = `${me}:${other}`;
  const { data: fetched } = useAsync(
    () => repos.bizChat.listMessages(me, other),
    [repos, me, other],
    { enabled: !!me && !!other, refreshMs: CHAT_REFRESH_MS },
  );

  // A poll that raced the message I just sent must not swallow it again: within
  // one conversation, only take the fetched thread once it has caught up with
  // what's already on screen. A different conversation always replaces it.
  const shownKey = useRef(threadKey);
  useEffect(() => {
    if (!fetched) return;
    setThread((prev) => (shownKey.current === threadKey && fetched.length < prev.length ? prev : fetched));
    shownKey.current = threadKey;
  }, [fetched, threadKey]);

  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (loading || !data) return <LoadingView />;
  if (!data.mine || !data.theirs) return <EmptyView title="Business not found" />;
  if (!data.isMember) {
    return (
      <EmptyView
        title="Members only"
        subtitle={`Only ${data.mine.name}'s team can chat as it.`}
      />
    );
  }

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    setSending(true);
    try {
      const updated = await repos.bizChat.send({
        fromBusinessId: me,
        toBusinessId: other,
        authorName: currentUser?.name ?? 'Member',
        body,
      });
      setThread(updated);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.flex, { paddingBottom: keyboard }]}>
      <Stack.Screen options={{ title: `🏢 ${data.theirs.name}` }} />
      <FlatList
        ref={listRef}
        data={thread}
        keyExtractor={(m) => m.id}
        style={[styles.flex, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text tone="muted" style={styles.emptyText}>
            Say hello — you're writing as {data.mine.name}.
          </Text>
        }
        renderItem={({ item }) => {
          const mineMsg = item.fromBusinessId === me;
          return (
            <View style={[styles.bubbleRow, mineMsg ? styles.rowMine : styles.rowTheirs]}>
              <View
                style={[
                  styles.bubble,
                  {
                    backgroundColor: mineMsg ? colors.brand : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text variant="caption" weight="semibold" tone={mineMsg ? 'inverse' : 'brand'}>
                  {item.authorName} · {item.fromBusinessName}
                </Text>
                <Text tone={mineMsg ? 'inverse' : 'default'}>{item.body}</Text>
              </View>
            </View>
          );
        }}
      />
      <View
        style={[
          styles.inputRow,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            // Clear of the gesture bar when the keyboard is down; the keyboard
            // inset already covers that strip when it is up.
            paddingBottom: spacing.md + (keyboard > 0 ? 0 : insets.bottom),
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message as ${data.mine.name}…`}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
          onSubmitEditing={send}
          multiline
        />
        <Pressable onPress={send} style={[styles.sendBtn, { backgroundColor: colors.brand }]}>
          <Text weight="bold" tone="inverse">
            ➤
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  emptyText: { textAlign: 'center', marginTop: spacing.xl },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
