/**
 * The food menu — sections, nested subcategories and priced dishes. The whole
 * builder is `FoodMenuEditor`; this screen just loads, gates and saves it.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { MenuItem } from '@/domain/types';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { FoodMenuEditor } from '@/features/businesses/FoodMenuEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageMenuScreen() {
  return (
    <ManageGate
      title="Menu"
      need="offerings"
      what="the menu"
      Form={MenuForm}
    />
  );
}

function MenuForm({ business, save, saving }: ManageFormProps) {
  const [menu, setMenu] = useState<MenuItem[]>(business.menu ?? []);

  return (
    <>
      <FoodMenuEditor value={menu} onChange={setMenu} />
      <Button
        title="Save menu"
        onPress={() => save({ menu: menu.length > 0 ? menu : undefined })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
