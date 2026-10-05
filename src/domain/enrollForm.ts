/**
 * The joining form — what a business asks everyone who enrols.
 *
 * A gym wants a photo and an emergency number, a tuition class wants the
 * child's school and the parent's mobile, a bus route wants the pickup address.
 * Rather than guess, the owner builds the form themselves: tap the ready-made
 * questions they recognise, add any of their own, mark the compulsory ones.
 *
 * This file is the vocabulary that makes that quick — a LIBRARY of the
 * questions nearly everyone asks (so the common case is tapping, not typing)
 * plus the field TYPES a custom question can be. Both are plain data, exactly
 * like `TAG_CATALOG` or `SERVICE_SECTIONS`: adding a question to the library
 * here is the whole change.
 *
 * Two rules the rest of the app leans on:
 *  - `NAME_FIELD_ID` ('name') is RESERVED. The enrollee's name already has a
 *    home (`Membership.enrolleeName`), so this one field only decides the label
 *    and whether the name is compulsory — it never becomes an answer of its own.
 *  - An answer copies the question's label and type (`EnrollAnswer`), so the
 *    owner can reword or delete a question without orphaning what people gave.
 */
import type { Business, EnrollAnswer, EnrollField, EnrollFieldType, EnrollForm } from './types';

/**
 * The enrollee's own name. Reserved: it maps onto `Membership.enrolleeName`
 * rather than becoming an `EnrollAnswer`, so the enrol screen shows ONE name
 * box however the form is built.
 */
export const NAME_FIELD_ID = 'name';

/** What a field type is called and what it does, for the custom-field picker. */
export interface FieldTypeMeta {
  type: EnrollFieldType;
  label: string;
  icon: string;
  /** One line telling the owner what the customer will get. */
  hint: string;
}

export const FIELD_TYPES: FieldTypeMeta[] = [
  { type: 'text', label: 'Short text', icon: '✏️', hint: 'A word or a line — a name, a class, a blood group' },
  { type: 'longtext', label: 'Long text', icon: '📝', hint: 'A few lines — notes, medical history' },
  { type: 'number', label: 'Number', icon: '🔢', hint: 'Digits only — age, weight, roll number' },
  { type: 'phone', label: 'Phone number', icon: '📞', hint: 'Opens the number keypad' },
  { type: 'email', label: 'Email', icon: '✉️', hint: 'Opens the email keyboard' },
  { type: 'date', label: 'Date', icon: '📅', hint: 'Typed as YYYY-MM-DD' },
  { type: 'address', label: 'Address', icon: '📍', hint: 'A multi-line address box' },
  { type: 'photo', label: 'Photo', icon: '📷', hint: 'They take one or pick it from their gallery' },
  { type: 'choice', label: 'Pick one', icon: '☑️', hint: 'They tap one of your options' },
  { type: 'yesno', label: 'Yes / No', icon: '🔀', hint: 'A two-way answer' },
];

export const fieldTypeMeta = (type: EnrollFieldType): FieldTypeMeta =>
  FIELD_TYPES.find((t) => t.type === type) ?? FIELD_TYPES[0];

/**
 * The ready-made questions, in the order an owner would think of them. Tapping
 * one adds it with its id, so a form built from the library is comparable
 * across businesses (every `phone` answer is a phone number) — and the owner
 * can still rename any of them afterwards.
 */
export const ENROLL_FIELD_LIBRARY: EnrollField[] = [
  { id: NAME_FIELD_ID, type: 'text', label: 'Full name', required: true },
  { id: 'photo', type: 'photo', label: 'Photo', hint: 'A clear face photo' },
  { id: 'phone', type: 'phone', label: 'Mobile number', required: true },
  { id: 'address', type: 'address', label: 'Address' },
  { id: 'dob', type: 'date', label: 'Date of birth' },
  { id: 'age', type: 'number', label: 'Age' },
  { id: 'gender', type: 'choice', label: 'Gender', options: ['Male', 'Female', 'Other'] },
  { id: 'email', type: 'email', label: 'Email' },
  { id: 'emergencyPhone', type: 'phone', label: 'Emergency contact number' },
  { id: 'guardian', type: 'text', label: 'Parent / guardian name' },
  { id: 'bloodGroup', type: 'text', label: 'Blood group' },
  { id: 'idNumber', type: 'text', label: 'ID number (Aadhaar / licence)' },
  { id: 'occupation', type: 'text', label: 'Occupation' },
  { id: 'school', type: 'text', label: 'School / college' },
  { id: 'medical', type: 'longtext', label: 'Medical conditions', hint: 'Anything we should know about' },
  { id: 'preferredTime', type: 'text', label: 'Preferred timing / batch' },
  { id: 'pickup', type: 'address', label: 'Pickup address' },
  { id: 'referredBy', type: 'text', label: 'Referred by' },
];

/** A fresh id for a question the owner typed themselves. */
let customCounter = 0;
export const newFieldId = (): string =>
  `f${Date.now().toString(36)}${(customCounter++).toString(36)}`;

/** The form's questions, or an empty list when the business asks nothing extra. */
export const enrollFormFields = (business: Pick<Business, 'enrollForm'>): EnrollField[] =>
  business.enrollForm?.fields ?? [];

/** Does this business ask anything at all on enrolment? */
export const hasEnrollForm = (business: Pick<Business, 'enrollForm'>): boolean =>
  enrollFormFields(business).length > 0;

/**
 * The questions the customer actually fills in as ANSWERS — everything except
 * the reserved name field, which is the enrollee-name box instead.
 */
export const answerableFields = (fields: EnrollField[]): EnrollField[] =>
  fields.filter((f) => f.id !== NAME_FIELD_ID);

/** The name question, when the owner put it on the form. */
export const nameField = (fields: EnrollField[]): EnrollField | undefined =>
  fields.find((f) => f.id === NAME_FIELD_ID);

/** An empty form, so the editor always has something to work on. */
export const emptyEnrollForm = (): EnrollForm => ({ fields: [] });

/** The keyboard a field's text box should open with. */
export function fieldKeyboard(
  type: EnrollFieldType,
): 'default' | 'numeric' | 'phone-pad' | 'email-address' {
  if (type === 'number') return 'numeric';
  if (type === 'phone') return 'phone-pad';
  if (type === 'email') return 'email-address';
  return 'default';
}

/** The placeholder that tells someone what shape of answer is wanted. */
export function fieldPlaceholder(field: EnrollField): string {
  switch (field.type) {
    case 'phone':
      return 'e.g. 98765 43210';
    case 'email':
      return 'e.g. name@example.com';
    case 'date':
      return 'YYYY-MM-DD';
    case 'address':
      return 'House, street, area, city';
    case 'number':
      return 'e.g. 24';
    case 'longtext':
      return 'Type here…';
    default:
      return `Your ${field.label.toLowerCase()}`;
  }
}

/**
 * The compulsory questions still blank, by label — what the enrol screen puts
 * in front of the customer instead of sending an incomplete request. The name
 * field is checked separately against the enrollee-name box.
 */
export function missingRequired(
  fields: EnrollField[],
  answers: Record<string, string>,
): string[] {
  return answerableFields(fields)
    .filter((f) => f.required && !(answers[f.id] ?? '').trim())
    .map((f) => f.label);
}

/**
 * Turn the filled boxes into the answers stored on the membership — blanks
 * dropped, labels and types copied in so they still read right if the owner
 * later rewords the question.
 */
export function toAnswers(
  fields: EnrollField[],
  answers: Record<string, string>,
): EnrollAnswer[] {
  return answerableFields(fields)
    .map((f) => ({ fieldId: f.id, label: f.label, type: f.type, value: (answers[f.id] ?? '').trim() }))
    .filter((a) => a.value.length > 0);
}
