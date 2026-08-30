/**
 * Reusable chat thread (messages list + input) for the single conversation
 * between a customer and a business. Used from both sides:
 *  - the customer view (`me.type = 'customer'`)
 *  - the business inbox (`me.type = 'business'`, reply attributed to the member)
 *
 * A message is "mine" when its authorType matches `me.type`. `labelFor` decides
 * the small label shown above a bubble (e.g. "Sagar from Arvind Transport").
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { ChatMessage } from '@/domain/types';
import type { ChatAuthor } from '@/data/repositories';
import { useRepositories } from '@/data/DataProvider';
import { CHAT_REFRESH_MS, useAsync } from '@/lib/useAsync';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface ChatThreadProps {
  businessId: string;
  participantId: string;
  /** Who I am when I send. */
  me: ChatAuthor;
  /**
   * Resolved just before sending, when who-I-am can only be settled at that
   * moment — a logged-out guest gains an anonymous identity on their first
   * message so the thread is really theirs (and the backend accepts it).
   * Defaults to the `participantId`/`me` props.
   */
  ensureIdentity?: () => Promise<{ participantId: string; me: ChatAuthor }>;
  /** Label shown above a bubble; return undefined for none. */
  labelFor?: (message: ChatMessage, mine: boolean) => string | undefined;
  placeholder?: string;
}

export function ChatThread({
  businessId,
  participantId,
  me,
  ensureIdentity,
  labelFor,
  placeholder = 'Type a message…',
}: ChatThreadProps) {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // The thread re-reads itself every few seconds while it's on screen, so the
  // other side's replies land here as they're written instead of only on the
  // next visit to the screen.
  const threadKey = `${businessId}:${participantId}`;
  const { data: fetched } = useAsync(
    () =>
      // A thread you can't read yet (e.g. a guest before their first message)
      // is simply an empty one — never an error screen.
      repos.chat.listThread(businessId, participantId).catch(() => [] as ChatMessage[]),
    [repos, businessId, participantId],
    { refreshMs: CHAT_REFRESH_MS },
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

  // The composer lifting shrinks the list — follow it down so the message you
  // are replying to stays in view instead of sliding under the keyboard.
  useEffect(() => {
    if (keyboard > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [keyboard]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    setSending(true);
    setSendError(null);
    try {
      // Who I am is settled here, not at render: a guest becomes an anonymous
      // identity on their first message so the thread belongs to someone.
      const who = ensureIdentity ? await ensureIdentity() : { participantId, me };
      const updated = await repos.chat.send(businessId, who.participantId, body, who.me);
      setThread(updated);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      // Put the message back in the box so nothing is lost.
      setDraft(body);
      setSendError(err instanceof Error ? err.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.flex, { paddingBottom: keyboard }]}>
      <FlatList
        ref={listRef}
        data={thread}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text tone="muted" style={styles.empty}>
            No messages yet. Say hello 👋
          </Text>
        }
        renderItem={({ item }) => {
          const mine = item.authorType === me.type;
          const label = labelFor?.(item, mine);
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowEnd : styles.rowStart]}>
              <View style={styles.bubbleWrap}>
                {label ? (
                  <Text
                    variant="caption"
                    weight="semibold"
                    tone="accent"
                    style={[styles.author, mine ? styles.authorRight : styles.authorLeft]}
                  >
                    {label}
                  </Text>
                ) : null}
                <View
                  style={[
                    styles.bubble,
                    mine
                      ? { backgroundColor: colors.brand, borderBottomRightRadius: 4 }
                      : {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderBottomLeftRadius: 4,
                        },
                  ]}
                >
                  {item.billId ? (
                    <Text weight="semibold" tone={mine ? 'inverse' : 'default'}>
                      🧾 Bill
                    </Text>
                  ) : null}
                  <Text tone={mine ? 'inverse' : 'default'}>{item.body}</Text>
                  {item.billId ? (
                    <Pressable
                      onPress={() => router.push(`/bill/${item.billId}`)}
                      style={[
                        styles.billLink,
                        { borderTopColor: mine ? 'rgba(255,255,255,0.35)' : colors.border },
                      ]}
                    >
                      <Text weight="semibold" tone={mine ? 'inverse' : 'accent'}>
                        View bill ›
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        }}
      />

      {sendError ? (
        <View style={[styles.errorBar, { backgroundColor: colors.surfaceAlt }]}>
          <Text variant="caption" tone="danger">
            {sendError}
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.inputBar,
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
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.brand : colors.surfaceAlt }]}
        >
          <Text weight="semibold" tone={draft.trim() ? 'inverse' : 'muted'}>
            Send
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  messages: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: spacing.xxl },
  bubbleRow: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubbleWrap: { maxWidth: '82%' },
  author: { marginBottom: 2 },
  authorLeft: { marginLeft: spacing.sm },
  authorRight: { textAlign: 'right', marginRight: spacing.sm },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  billLink: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  errorBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, minHeight: 44, borderRadius: radius.pill, paddingHorizontal: spacing.md, fontSize: 15 },
  sendBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
