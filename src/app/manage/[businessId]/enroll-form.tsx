/**
 * Manage › Joining form — the questions everyone enrolling is asked.
 *
 * The point is that an owner never has to design a form. The questions almost
 * every business wants are already here as chips (`ENROLL_FIELD_LIBRARY`): tap
 * Photo, Mobile number, Address and you have a form. Anything the library
 * doesn't cover is one "＋ Add your own question" away — type the label, pick
 * what kind of answer it takes, mark it compulsory or not.
 *
 * What the customer then sees is `features/memberships/EnrollFormFill`, drawn
 * once per person on the enrol screen; what comes back lands on the membership
 * as `formAnswers` and shows on the request and the member's page.
 *
 * The "Full name" question is the one oddity, and it's deliberate: the enrollee's
 * name already has a home (`Membership.enrolleeName`), so putting it on the form
 * only decides its label and whether it's compulsory — see `NAME_FIELD_ID`.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { EnrollField, EnrollFieldType } from '@/domain/types';
import {
  ENROLL_FIELD_LIBRARY,
  FIELD_TYPES,
  NAME_FIELD_ID,
  fieldTypeMeta,
  newFieldId,
} from '@/domain/enrollForm';
import { hasModule } from '@/domain/modules';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button, Card, Input, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function ManageEnrollFormScreen() {
  return <ManageGate title="Joining form" need="owner" what="joining form" Form={EnrollFormBuilder} />;
}

function EnrollFormBuilder({ business, save, saving }: ManageFormProps) {
  const colors = useColors();
  const [intro, setIntro] = useState(business.enrollForm?.intro ?? '');
  const [fields, setFields] = useState<EnrollField[]>(business.enrollForm?.fields ?? []);

  // The custom-question composer, revealed by its own button so the common path
  // (tap three chips, Save) stays a single screenful.
  const [adding, setAdding] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customType, setCustomType] = useState<EnrollFieldType>('text');
  const [customRequired, setCustomRequired] = useState(false);
  const [customOptions, setCustomOptions] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  // A form nobody can submit is a dead end — enrolling only exists while the
  // Members tool is on.
  const canJoin = hasModule(business, 'memberships');

  const has = (id: string) => fields.some((f) => f.id === id);
  const addLibrary = (field: EnrollField) =>
    setFields((list) => (list.some((f) => f.id === field.id) ? list : [...list, { ...field }]));
  const remove = (id: string) => setFields((list) => list.filter((f) => f.id !== id));
  const patch = (id: string, change: Partial<EnrollField>) =>
    setFields((list) => list.map((f) => (f.id === id ? { ...f, ...change } : f)));
  /** Move a question one place up or down — the order is the order people read. */
  const move = (index: number, by: -1 | 1) =>
    setFields((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) {
      setCustomError('Type what you want to ask, e.g. “Which batch?”');
      return;
    }
    const options =
      customType === 'choice'
        ? customOptions
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    if (customType === 'choice' && (!options || options.length < 2)) {
      setCustomError('List at least two options, separated by commas.');
      return;
    }
    setFields((list) => [
      ...list,
      { id: newFieldId(), type: customType, label, required: customRequired, options },
    ]);
    setCustomLabel('');
    setCustomOptions('');
    setCustomRequired(false);
    setCustomType('text');
    setCustomError(null);
    setAdding(false);
  };

  const unused = ENROLL_FIELD_LIBRARY.filter((f) => !has(f.id));

  return (
    <>
      {!canJoin ? (
        <Text variant="caption" tone="muted" style={styles.note}>
          Turn on “Members” in Workspace tools to let customers enrol — until then nobody
          reaches this form.
        </Text>
      ) : null}

      <Text variant="caption" tone="muted" style={styles.note}>
        Everyone who asks to join fills this in. Tap the questions you want; add your own for
        anything else. A ＊ marks a question they can’t skip.
      </Text>

      <Input
        label="A line to show above the questions (optional)"
        placeholder="e.g. Please bring the original ID on your first visit"
        value={intro}
        onChangeText={setIntro}
        multiline
        numberOfLines={2}
        style={styles.multiline}
      />

      {unused.length > 0 ? (
        <>
          <Text variant="label" weight="semibold" style={styles.sectionHead}>
            Ask for…
          </Text>
          <View style={styles.chips}>
            {unused.map((f) => (
              <Tag
                key={f.id}
                label={`＋ ${f.label}`}
                icon={fieldTypeMeta(f.type).icon}
                onPress={() => addLibrary(f)}
              />
            ))}
          </View>
        </>
      ) : null}

      <Text variant="label" weight="semibold" style={styles.sectionHead}>
        Your form {fields.length > 0 ? `(${fields.length})` : ''}
      </Text>

      {fields.length === 0 ? (
        <Text variant="caption" tone="muted" style={styles.note}>
          Nothing asked yet — people can join by just picking a plan. Tap a question above to
          start.
        </Text>
      ) : (
        fields.map((f, i) => (
          <Card key={f.id} style={styles.fieldCard}>
            <View style={styles.fieldTop}>
              <Text variant="caption" tone="muted" style={styles.flex}>
                {fieldTypeMeta(f.type).icon} {fieldTypeMeta(f.type).label}
                {f.id === NAME_FIELD_ID ? ' · the member’s own name' : ''}
              </Text>
              <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0}>
                <Text tone={i === 0 ? 'muted' : 'accent'} weight="bold">
                  ▲
                </Text>
              </Pressable>
              <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === fields.length - 1}>
                <Text tone={i === fields.length - 1 ? 'muted' : 'accent'} weight="bold">
                  ▼
                </Text>
              </Pressable>
              <Pressable onPress={() => remove(f.id)} hitSlop={8}>
                <Text tone="danger" weight="bold">
                  ✕
                </Text>
              </Pressable>
            </View>

            <Input
              placeholder="What you’re asking for"
              value={f.label}
              onChangeText={(t) => patch(f.id, { label: t })}
            />

            {f.type === 'choice' ? (
              <Input
                label="Options (comma separated)"
                placeholder="e.g. Morning, Evening, Weekend"
                value={(f.options ?? []).join(', ')}
                onChangeText={(t) =>
                  patch(f.id, {
                    options: t
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : null}

            <Pressable
              onPress={() => patch(f.id, { required: !f.required })}
              hitSlop={6}
              style={styles.requiredToggle}
            >
              <Text variant="caption" weight="semibold" tone={f.required ? 'brand' : 'muted'}>
                {f.required ? '☑' : '☐'} They can’t skip this
              </Text>
            </Pressable>
          </Card>
        ))
      )}

      {adding ? (
        <Card style={[styles.fieldCard, { borderColor: colors.brand, borderWidth: 1 }]}>
          <Text weight="semibold">Your own question</Text>
          <Input
            label="What do you want to ask?"
            placeholder="e.g. Which batch suits you?"
            value={customLabel}
            onChangeText={setCustomLabel}
          />
          <Text variant="label" weight="medium" style={styles.sectionHead}>
            What kind of answer?
          </Text>
          <View style={styles.chips}>
            {FIELD_TYPES.map((t) => (
              <Tag
                key={t.type}
                label={t.label}
                icon={t.icon}
                selected={customType === t.type}
                onPress={() => setCustomType(t.type)}
              />
            ))}
          </View>
          <Text variant="caption" tone="muted" style={styles.note}>
            {fieldTypeMeta(customType).hint}
          </Text>
          {customType === 'choice' ? (
            <Input
              label="Options (comma separated)"
              placeholder="e.g. Morning, Evening, Weekend"
              value={customOptions}
              onChangeText={setCustomOptions}
            />
          ) : null}
          <Pressable
            onPress={() => setCustomRequired((v) => !v)}
            hitSlop={6}
            style={styles.requiredToggle}
          >
            <Text variant="caption" weight="semibold" tone={customRequired ? 'brand' : 'muted'}>
              {customRequired ? '☑' : '☐'} They can’t skip this
            </Text>
          </Pressable>
          {customError ? (
            <Text variant="caption" tone="danger" style={styles.note}>
              {customError}
            </Text>
          ) : null}
          <View style={styles.rowBtns}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setAdding(false);
                setCustomError(null);
              }}
              style={styles.flex}
            />
            <Button title="Add question" onPress={addCustom} style={styles.flex} />
          </View>
        </Card>
      ) : (
        <Button
          title="＋ Add your own question"
          variant="secondary"
          onPress={() => setAdding(true)}
          style={styles.addOwn}
        />
      )}

      <Button
        title="Save"
        onPress={() => {
          // A question with its label wiped would be an unanswerable box, so
          // blanks are dropped on the way out rather than saved.
          const clean = fields.filter((f) => f.label.trim().length > 0);
          const trimmedIntro = intro.trim();
          save({
            enrollForm:
              clean.length > 0 || trimmedIntro
                ? { intro: trimmedIntro || undefined, fields: clean }
                : undefined,
          });
        }}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  note: { marginBottom: spacing.md },
  sectionHead: { marginTop: spacing.md, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  fieldCard: { marginBottom: spacing.sm, borderRadius: radius.md },
  fieldTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  requiredToggle: { alignSelf: 'flex-start', marginTop: spacing.xs },
  rowBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  addOwn: { marginTop: spacing.sm },
  save: { marginTop: spacing.lg },
});
