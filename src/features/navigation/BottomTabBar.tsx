/**
 * The One Place bottom bar. Each tab is an icon over its label; the ACTIVE tab
 * becomes a solid brand pill holding both, in white. A tab's unread count sits
 * as a small badge on the top-right of its icon — red by default, or whatever
 * `tabBarBadgeStyle.backgroundColor` the screen sets (Workspace uses amber, so
 * business messages read apart from the customer's own Chats).
 *
 * A custom bar rather than React Navigation's own because the stock bar can
 * only tint the icon and label — it can't put them inside one pill.
 *
 * Only the routes named in `icons` get a button, in navigator order; the rest
 * (Account, My Orders, the on-hold Stalls feed) stay routes with no button.
 *
 * `action` adds one button that is NOT a tab — the raised terracotta Deals
 * button in the middle, which opens a full-screen route over the tabs rather
 * than switching between them, so it never shows as "active".
 *
 * On Home (the `index` tab) the bar joins Home's colour grading: no top border,
 * and a fade from Home's mint down to white instead of the flat linen tint.
 */
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Tabs } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, Text, type IconName } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export interface TabBarAction {
  /** How many tab buttons come before it. */
  after: number;
  label: string;
  icon: IconName;
  onPress: () => void;
}

export function BottomTabBar({
  state,
  descriptors,
  navigation,
  insets,
  icons,
  action,
}: TabBarProps & { icons: Record<string, IconName>; action?: TabBarAction }) {
  const colors = useColors();
  const tabRoutes = state.routes.filter((route) => icons[route.name]);
  const onHome = state.routes[state.index]?.name === 'index';
  // What the badge/disc rims blend into — the bar's own colour at its top.
  const barTint = onHome ? colors.homeBackground : colors.headerTint;

  const actionButton = action ? (
    <Pressable
      key="action"
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={styles.slot}
    >
      {({ pressed }) => (
        <View style={styles.actionItem}>
          <View
            style={[
              styles.actionDisc,
              { backgroundColor: colors.cta, borderColor: barTint },
              pressed && styles.actionPressed,
            ]}
          >
            <Icon name={action.icon} size={26} color={colors.textInverse} />
          </View>
          <Text weight="bold" numberOfLines={1} style={[styles.label, { color: colors.cta }]}>
            {action.label}
          </Text>
        </View>
      )}
    </Pressable>
  ) : null;

  const tabs = (
    <>
      {tabRoutes.map((route, position) => {
        const icon = icons[route.name];
        const { options } = descriptors[route.key];
        const focused = state.routes[state.index]?.key === route.key;
        const label =
          typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
        const badge = options.tabBarBadge;
        const badgeColor =
          (StyleSheet.flatten(options.tabBarBadgeStyle)?.backgroundColor as string | undefined) ??
          colors.danger;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

        const tint = focused ? colors.textInverse : colors.text;
        const tab = (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={
              badge !== undefined && badge !== '' ? `${label}, ${badge} unread` : label
            }
            style={styles.slot}
          >
            <View style={[styles.item, focused && { backgroundColor: colors.brand }]}>
              <View>
                <Icon name={icon} size={22} color={tint} filled={focused} />
                {badge !== undefined && badge !== '' ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: badgeColor, borderColor: barTint },
                    ]}
                  >
                    <Text style={styles.badgeText} weight="bold">
                      {typeof badge === 'number' && badge > 99 ? '99+' : String(badge)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                weight={focused ? 'bold' : 'medium'}
                numberOfLines={1}
                style={[styles.label, { color: tint }]}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
        return action && position === action.after ? [actionButton, tab] : tab;
      })}
      {action && action.after >= tabRoutes.length ? actionButton : null}
    </>
  );

  return onHome ? (
    <LinearGradient
      colors={[colors.homeBackground, colors.surface]}
      style={[styles.bar, styles.barSeamless, { paddingBottom: insets.bottom + spacing.sm }]}
    >
      {tabs}
    </LinearGradient>
  ) : (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.headerTint,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      {tabs}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  barSeamless: { borderTopWidth: 0 },
  // Each tab gets an equal fifth; the pill fills its slot so the longest label
  // ("Subscriptions") fits on a phone without truncating.
  slot: { flex: 1, paddingHorizontal: 2 },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: spacing.sm,
    paddingHorizontal: 2,
    borderRadius: radius.pill,
  },
  label: { fontSize: 11, lineHeight: 14 },
  // The action floats half out of the bar, as in the mockup.
  actionItem: { alignItems: 'center', gap: 3, marginTop: -spacing.lg },
  actionDisc: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  actionPressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
  badge: {
    position: 'absolute',
    top: -8,
    left: 12,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 12 },
});
