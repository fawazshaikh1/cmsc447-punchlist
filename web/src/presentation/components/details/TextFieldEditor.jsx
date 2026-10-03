import { useId } from 'react';

import { useCommitOnBlur } from '../useCommitOnBlur';

/**
 * A one-line text field — trade, company, assignee.
 *
 * Committed on blur, like the description box: one undo step per edit, not one
 * per character. Enter finishes the edit too, because on a tablet keyboard
 * that is the key a thumb reaches for when it is done.
 *
 * Suggestions come through a native <datalist>, which every target browser
 * renders as its own autocomplete — a dropdown on desktop, a bar above the
 * keyboard on iPad — with no custom widget to keep accessible.
 *
 * @param {import('./FieldEditorRegistry').FieldEditorProps} props
 */
export function TextFieldEditor({ field, value, readOnly, suggestions, identity, onCommit }) {
  const listId = useId();
  const editing = useCommitOnBlur(value, onCommit, identity);
  const offerSuggestions = !readOnly && suggestions.length > 0;

  return (
    <label className="field">
      {field.getLabel()}
      <input
        type="text"
        // Uncontrolled and keyed by the stored value, so an undo — a change
        // from outside — replaces what is shown instead of being hidden by it.
        defaultValue={value}
        key={`${identity}:${value}`}
        placeholder={readOnly ? '' : field.getPlaceholder()}
        maxLength={field.getMaxLength()}
        readOnly={readOnly}
        list={offerSuggestions ? listId : undefined}
        autoComplete="off"
        enterKeyHint="done"
        onChange={editing.onChange}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          editing.flush();
          // Show what was actually kept. When cleaning made the value equal to
          // what was stored, nothing re-renders, and the box would otherwise
          // keep showing the stray spaces that were thrown away.
          event.currentTarget.value = field.normalize(event.currentTarget.value);
        }}
      />
      {offerSuggestions && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </label>
  );
}
