import { useEffect, useRef } from 'react';

import { ItemFieldRegistry } from '../../../domain/details';
import { FieldEditorRegistry } from './FieldEditorRegistry';
import { ReadOnlyFieldEditor } from './ReadOnlyFieldEditor';

/** Enough to cover a sheet's companies without turning a hint into a list to scroll. */
const MAX_SUGGESTIONS = 40;

/**
 * Every registered item field, for one punch item.
 *
 * ===========================================================================
 * NO FIELD IS NAMED HERE
 * ===========================================================================
 * The list comes from ItemFieldRegistry and each editor from
 * FieldEditorRegistry. A field added in the domain appears in the panel with
 * no edit to this file or to PropertiesPanel.
 *
 * ===========================================================================
 * TWO QUICK EDITS MUST NOT UNDO EACH OTHER
 * ===========================================================================
 * Saving is asynchronous. Type a trade, then tap straight into the company
 * box: the trade commits on blur, but the company's keystrokes can be recorded
 * before the saved pin has come back as a prop. Building the company edit from
 * that older pin would write a pin with no trade — the first edit silently
 * reverted by the second.
 *
 * So a commit builds on the NEWEST copy of the same item it has seen, kept in
 * a ref. It falls back to the copy it was created with only when the panel has
 * moved on to a different item, which is the case useCommitOnBlur exists for:
 * an edit flushed after selection changes must land on the item it was typed
 * into, never on the one now selected.
 *
 * @param {object} props
 * @param {import('../../../domain/annotations').Pin} props.annotation Anything
 *        with `details` and `withDetail`.
 * @param {boolean} props.readOnly
 * @param {(previous, next, label: string) => void} props.onUpdate
 * @param {import('../../../domain/annotations').Annotation[]} [props.peers]
 *        Other markups on the sheet, whose values are offered as suggestions so
 *        one company is not entered three different ways.
 */
export function ItemDetailsEditor({ annotation, readOnly, onUpdate, peers = [] }) {
  const latest = useRef(annotation);
  useEffect(() => {
    latest.current = annotation;
  });

  const fields = ItemFieldRegistry.all();
  if (fields.length === 0) return null;

  const commitFor = (field) => {
    const typedInto = annotation;

    return (raw) => {
      const current = latest.current?.id === typedInto.id ? latest.current : typedInto;

      let next;
      try {
        next = current.withDetail(field.getKey(), raw);
      } catch (error) {
        // Editors validate before committing, so this is a bypass, not a typo.
        // Refusing loudly in the console beats storing junk or clearing a value.
        console.warn(`[ItemDetailsEditor] ${field.getLabel()} was not saved.`, error);
        return;
      }

      // Same instance back means nothing really changed — someone tabbed
      // through, or typed what was there with different spacing. No undo
      // step, no history entry.
      if (next === current) return;

      onUpdate(current, next, field.describeChange(next.details.get(field.getKey())));
    };
  };

  return (
    <section className="details" aria-label="Assignment">
      <h3 className="details-title">Assignment</h3>

      {fields.map((field) => {
        const Editor = FieldEditorRegistry.get(field.getInputKind()) ?? ReadOnlyFieldEditor;

        return (
          <Editor
            key={field.getKey()}
            field={field}
            value={annotation.details.get(field.getKey())}
            readOnly={readOnly}
            suggestions={suggestionsFor(field, peers)}
            identity={annotation.id}
            onCommit={commitFor(field)}
          />
        );
      })}
    </section>
  );
}

/**
 * Values already used on this sheet first — they are the ones this job
 * actually uses — then the field's own list, without repeats that differ only
 * in letter case.
 */
function suggestionsFor(field, peers) {
  const key = field.getKey();
  const seen = new Set();
  const result = [];

  const offer = (value) => {
    const fingerprint = value.toLocaleLowerCase();
    if (!value || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    result.push(value);
  };

  for (const peer of peers) {
    if (typeof peer.details?.get === 'function') offer(peer.details.get(key));
  }
  for (const suggestion of field.getSuggestions()) offer(suggestion);

  return result.slice(0, MAX_SUGGESTIONS);
}
