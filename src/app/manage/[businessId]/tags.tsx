/**
 * Tags — the whole of discovery. A business appears under every filter whose
 * tags it carries, so this screen is the one that decides who finds it.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SUGGESTED_BUSINESS_TAGS } from '@/domain/tags';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { TagPicker } from '@/features/businesses/TagPicker';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageTagsScreen() {
  return (
    <ManageGate
      title="Tags"
      need="owner"
      Form={TagsForm}
    />
  );
}

function TagsForm({ business, save, saving }: ManageFormProps) {
  const [tags, setTags] = useState<string[]>(business.tags ?? []);

  return (
    <>
      <TagPicker value={tags} onChange={setTags} suggestions={SUGGESTED_BUSINESS_TAGS} />
      <Button
        title="Save"
        onPress={() => save({ tags: tags.length > 0 ? tags : undefined })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
