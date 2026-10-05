/**
 * Filling in a business's joining form (`Business.enrollForm`).
 *
 * One of these renders under each person being enrolled on the enrol screen, so
 * a parent signing up two children answers the questions twice — once per child
 * — and each request carries its own answers.
 *
 * Every answer is held as a STRING, whatever the question's type: a date is the
 * typed `YYYY-MM-DD`, a chosen option is its own label, a yes/no is "Yes"/"No",
 * and a photo is the uploaded URL. That keeps `EnrollAnswer.value` one shape to
 * store, send and print, and means a question whose type the owner later changes
 * doesn't invalidate what people already answered.
 *
 * The reserved `name` field is NOT drawn here — the enrollee's name has its own
 * box on the enrol screen (it becomes `Membership.enrolleeName`), and drawing it
 * twice is exactly what `answerableFields` exists to prevent.
 */
import { StyleSheet, View } from 'react-native';
import type { EnrollField, EnrollForm } from '@/domain/types';
import { answerableFields, fieldKeyboard, fieldPlaceholder } from '@/domain/enrollForm';
import { PhotosField } from '@/features/media/PhotosField';
import { Input, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export interface EnrollFormFillProps {
  form: EnrollForm;
  /** Answers by field id — the caller owns them, one record per enrollee. */
  answers: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}

const YES_NO = ['Yes', 'No'];

export function EnrollFormFill({ form, answers, onChange }: EnrollFormFillProps) {
  const fields = answerableFields(form.fields);
  if (fields.length === 0) return null;
  return (
    <View>
      {fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          value={answers[field.id] ?? ''}
          onChange={(v) => onChange(field.id, v)}
        />
      ))}
    </View>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: EnrollField;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = `${field.label}${field.required ? ' *' : ''}`;

  if (field.type === 'photo') {
    return (
      <View style={styles.block}>
        <PhotosField
          label={label}
          // One photo per question: the answer is a single URL, and a second
          // one would have nowhere to go.
          max={1}
          value={value ? [value] : []}
          onChange={(photos) => onChange(photos[0] ?? '')}
        />
        {field.hint ? (
          <Text variant="caption" tone="muted">
            {field.hint}
          </Text>
        ) : null}
      </View>
    );
  }

  if (field.type === 'choice' || field.type === 'yesno') {
    const options = field.type === 'yesno' ? YES_NO : (field.options ?? []);
    return (
      <View style={styles.block}>
        <Text variant="label" weight="medium">
          {label}
        </Text>
        {field.hint ? (
          <Text variant="caption" tone="muted" style={styles.hint}>
            {field.hint}
          </Text>
        ) : null}
        <View style={styles.chips}>
          {options.map((opt) => (
            <Tag
              key={opt}
              label={opt}
              selected={value === opt}
              // Tapping the chosen one again clears it, so a non-compulsory
              // question can be left unanswered after a mis-tap.
              onPress={() => onChange(value === opt ? '' : opt)}
            />
          ))}
        </View>
      </View>
    );
  }

  const long = field.type === 'longtext' || field.type === 'address';
  return (
    <Input
      label={label}
      helper={field.hint}
      placeholder={fieldPlaceholder(field)}
      value={value}
      onChangeText={onChange}
      keyboardType={fieldKeyboard(field.type)}
      autoCapitalize={field.type === 'email' ? 'none' : 'sentences'}
      multiline={long}
      numberOfLines={long ? 3 : undefined}
      style={long ? styles.multiline : undefined}
    />
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  hint: { marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
});
