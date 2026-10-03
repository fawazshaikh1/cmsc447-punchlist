import { useState } from 'react';

import { CalendarDate } from '../../../domain/details';
import { useCommitOnBlur } from '../useCommitOnBlur';

const MIN = `${CalendarDate.MIN_YEAR}-01-01`;
const MAX = `${CalendarDate.MAX_YEAR}-12-31`;

/**
 * A calendar date — the due date.
 *
 * The browser's own date input, so an iPad gets its wheel picker and a laptop
 * its calendar, and the value arrives as `YYYY-MM-DD` with no parsing of
 * locale-specific text on our side.
 *
 * ===========================================================================
 * THE TRAP: AN UNFINISHED DATE READS AS EMPTY
 * ===========================================================================
 * Type "10 / __ / 2026" into a date box and its `value` is '' — exactly what
 * clearing it produces. Committed as-is, half-typing a new date would ERASE
 * the existing one. The input's `validity.badInput` is the only thing that
 * tells the two apart, so:
 *
 *   - while the box holds an unfinished date, the pending edit is reset to the
 *     stored value, so no flush path — blur, choosing another item, closing
 *     the panel — can save it;
 *   - on blur the user is told, and what they typed stays on screen to fix.
 *
 * Clearing is a separate, explicit button rather than "delete the digits",
 * because that gesture is the one that is ambiguous.
 *
 * @param {import('./FieldEditorRegistry').FieldEditorProps} props
 */
export function DateFieldEditor({ field, value, readOnly, identity, onCommit }) {
  const [problem, setProblem] = useState(null);

  // Every flush path ends here, including the ones that run after the input
  // has gone and there is nobody left to show a message to. An invalid value
  // is therefore dropped here as well as on blur — the domain would refuse it
  // anyway, but it should never get that far.
  const accept = (raw) => {
    if (!field.validate(raw)) onCommit(raw);
  };
  const editing = useCommitOnBlur(value, accept, identity);

  /** Records the edit — or, for an unfinished date, cancels any pending one. */
  const record = (input) => {
    editing.onChange({ target: { value: input.validity.badInput ? value : input.value } });
  };

  return (
    <div className={`field${problem ? ' field-invalid' : ''}`}>
      <label htmlFor={`${identity}-${field.getKey()}`}>{field.getLabel()}</label>
      <div className="field-inline">
        <input
          id={`${identity}-${field.getKey()}`}
          type="date"
          defaultValue={value}
          key={`${identity}:${value}`}
          min={MIN}
          max={MAX}
          readOnly={readOnly}
          aria-invalid={problem ? 'true' : undefined}
          onChange={(event) => {
            setProblem(null);
            record(event.currentTarget);
          }}
          onBlur={(event) => {
            const input = event.currentTarget;

            if (input.validity.badInput) {
              setProblem('Finish the date, or use Clear to remove it.');
              return;
            }

            const message = field.validate(input.value);
            setProblem(message);
            if (!message) editing.flush();
          }}
        />
        {!readOnly && value && (
          <button
            type="button"
            className="field-clear"
            onClick={() => {
              setProblem(null);
              onCommit('');
            }}
            aria-label={`Clear ${field.getLabel().toLowerCase()}`}
          >
            Clear
          </button>
        )}
      </div>
      {problem && <span className="field-error">{problem}</span>}
    </div>
  );
}
