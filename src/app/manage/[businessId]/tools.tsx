/**
 * Workspace tools — the opt-in modules picked at registration. Saving always
 * writes the explicit list, so a legacy business (no list = everything on)
 * becomes explicit the first time this screen is used.
 */
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import {
  AVAILABLE_MODULES,
  COMING_SOON_MODULES,
  enabledModules,
  type ModuleId,
} from '@/domain/modules';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button, Card, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function ManageToolsScreen() {
  return (
    <ManageGate
      title="Workspace tools"
      intro="Turn the tools you run the business with on or off — your workspace shows only what’s on. Chat and calls are always included. Turning a tool off hides it; nothing is deleted."
      need="owner"
      Form={ToolsForm}
    />
  );
}

function ToolsForm({ business, save, saving }: ManageFormProps) {
  const colors = useColors();
  const [moduleSet, setModuleSet] = useState(() => new Set(enabledModules(business)));

  const toggle = (id: ModuleId) =>
    setModuleSet((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <>
      <Card style={styles.card}>
        {AVAILABLE_MODULES.map((m, i) => (
          <View
            key={m.id}
            style={[
              styles.switchRow,
              i === 0 && styles.firstSwitchRow,
              { borderTopColor: colors.border },
            ]}
          >
            <View style={styles.moduleInfo}>
              <Text>
                {m.icon} {m.label}
              </Text>
              <Text variant="caption" tone="muted">
                {m.description}
              </Text>
            </View>
            <Switch value={moduleSet.has(m.id)} onValueChange={() => toggle(m.id)} />
          </View>
        ))}
        <Text variant="caption" tone="muted" style={styles.comingSoon}>
          Coming soon: {COMING_SOON_MODULES.map((m) => m.label).join(', ')}.
        </Text>
      </Card>

      <Button
        title="Save"
        onPress={() => save({ modules: Array.from(moduleSet) })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  firstSwitchRow: { marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  moduleInfo: { flex: 1, paddingRight: spacing.md },
  comingSoon: { marginTop: spacing.md },
  save: { marginTop: spacing.lg },
});
