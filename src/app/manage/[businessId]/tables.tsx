/**
 * Dine-in seating. How many tables the place has — dine-in orders are seated
 * at a numbered one automatically, so this number is the whole setting.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button, Input } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageTablesScreen() {
  return (
    <ManageGate
      title="Tables"
      need="owner"
      Form={TablesForm}
    />
  );
}

function TablesForm({ business, save, saving }: ManageFormProps) {
  const [tableCount, setTableCount] = useState(
    business.tableCount != null ? String(business.tableCount) : '',
  );

  // Blank / 0 / junk → no tables (undefined clears it on save).
  const parsed = (() => {
    const n = parseInt(tableCount, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  return (
    <>
      <Input
        label="How many tables"
        placeholder="e.g. 12"
        value={tableCount}
        onChangeText={setTableCount}
        keyboardType="number-pad"
        style={styles.input}
      />
      <Button
        title="Save"
        onPress={() => save({ tableCount: parsed })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  input: { maxWidth: 160 },
  save: { marginTop: spacing.lg },
});
