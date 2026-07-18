/**
 * B2B thread — the conversation between TWO businesses
 * (?me=<my business id>&other=<their business id>). Any member of either
 * side reads and replies as their business; bubbles are attributed
 * "<member> · <business>". Members-only, like the workspace.
 */
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { BizChatMessage } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { EmptyView, ErrorView, LoadingView, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function B2BChatScreen() {
  const { me, other } = useLocalSearchParams<{ me: string; other: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [thread, setThread] = useState<BizChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<BizChatMessage>>(null);

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

  useEffect(() => {
    let active = true;
    if (!me || !other) return;
    repos.bizChat.listMessages(me, other).then((msgs) => {
      if (active) setThread(msgs);
    });
    return () => {
      active = false;
    };
  }, [repos, me, other]);

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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: `🏢 ${data.theirs.name}` }} />
      <FlatList
        ref={listRef}
        data={thread}
        keyExtractor={(m) => m.id}
        style={[styles.flex, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.listContent}
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
      <View style={[styles.inputRow, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
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
    </KeyboardAvoidingView>
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
