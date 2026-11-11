/**
 * Edits a field with a fixed set of choices — priority's High, Medium and
 * Low (spec 6.3). Registered for the `choice` input kind, so any field that
 * answers `getChoices()` gets a menu here with no edit to the panel.
 *
 * A choice commits as soon as it is picked: there is nothing to type, so
 * nothing to lose by saving at once.
 *
 * @param {object} props
 * @param {import('../../../domain/details').ItemField & { getChoices?: () => Array<[string, string]>, getDefault?: () => string }} props.field
 * @param {string} props.value What is stored; '' when nothing was chosen.
 * @param {boolean} props.readOnly
 * @param {(raw: string) => void} props.onCommit
 */
export function ChoiceFieldEditor({ field, value, readOnly, onCommit }) {
  const choices = field.getChoices?.() ?? [];
  const shown = value || field.getDefault?.() || '';

  return (
    <label className="field">
      {field.getLabel()}
      <select value={shown} disabled={readOnly} onChange={(event) => onCommit(event.target.value)}>
        {choices.map(([choice, label]) => (
          <option key={choice} value={choice}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
