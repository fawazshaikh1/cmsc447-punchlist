/**
 * A field that asks to be confirmed rather than typed into — the location of
 * an item carried forward to a revised set (LocationCheckField, D7).
 *
 * Shows nothing while there is nothing to confirm, so items that were never
 * carried forward have no extra row. While set: why, and a button that clears
 * it — an ordinary edit, recorded as "Confirm the location of pin" and only
 * offered to someone who may edit the item.
 *
 * @param {object} props
 * @param {import('../../../domain/details').ItemField} props.field
 * @param {string} props.value What is stored; '' once confirmed.
 * @param {boolean} props.readOnly
 * @param {(raw: string) => void} props.onCommit
 */
export function ConfirmFieldEditor({ field, value, readOnly, onCommit }) {
  if (!value) return null;
  return (
    <div className="field confirm-field">
      {field.getLabel()}
      <p className="notice notice-flag-warning small">{field.format(value)}</p>
      {!readOnly && (
        <button type="button" className="btn" onClick={() => onCommit('')}>
          Confirm location
        </button>
      )}
    </div>
  );
}
