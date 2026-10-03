/**
 * What a field shows when no editor is registered for its input kind.
 *
 * A field added to the domain before its editor exists — or whose editor
 * failed to register — still has values on real items. Rendering nothing
 * would hide them; rendering this shows them, read-only, until the editor
 * lands.
 *
 * @param {import('./FieldEditorRegistry').FieldEditorProps} props
 */
export function ReadOnlyFieldEditor({ field, value }) {
  return (
    <div className="field">
      {field.getLabel()}
      <span className="field-value">{value ? field.format(value) : '—'}</span>
    </div>
  );
}
