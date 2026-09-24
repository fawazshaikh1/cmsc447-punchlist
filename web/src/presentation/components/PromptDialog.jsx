import { useCallback, useEffect, useRef, useState } from 'react';

import { useAutoFocus } from './useAutoFocus';
import { useBackdropDismiss } from './useBackdropDismiss';

/**
 * Asks the user for a line or two of text before something is created.
 *
 * ===========================================================================
 * WHY THIS REPLACED `window.prompt`
 * ===========================================================================
 * The placeholder was always marked as temporary, and requiring a description
 * on every pin is what made it untenable — it turned the crudest thing in the
 * application into the thing a user meets most often.
 *
 * Concretely, `window.prompt`:
 *
 *   - is single-line, so a two-sentence defect gets truncated rather than
 *     scrolled, and people shorten what they write to fit;
 *   - cannot show a label, a placeholder or an example, so "what goes in here?"
 *     has to be guessed from one line of text;
 *   - blocks the main thread, freezing the pdf.js render behind it;
 *   - is suppressible by the browser after repeated use, which for a required
 *     field means pin placement silently stops working;
 *   - on iPad Safari is a cramped system sheet that covers the drawing the user
 *     is trying to describe.
 *
 * The last two matter most here. A required field that a browser can switch off
 * is not a required field.
 *
 * Promise-based for the same reason as `useConfirmation`: the caller reads top
 * to bottom, and what happens after the answer sits directly under the
 * question. See ConfirmDialog for the longer argument.
 */

/**
 * @typedef {object} PromptRequest
 * @property {string} title
 * @property {string} label
 * @property {string} [placeholder]
 * @property {string} [confirmLabel]
 * @property {boolean} [multiline]
 * @property {string} [initialValue] Pre-fills the box, for an edit rather than
 *           a creation.
 */

/**
 * @returns {{ ask: (request: PromptRequest) => Promise<string|null>, dialog: React.ReactNode }}
 *          Resolves to the trimmed text, or null if the user backed out.
 */
export function useTextPrompt() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((answer) => {
    resolverRef.current?.(answer);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const ask = useCallback(
    (next) =>
      new Promise((resolve) => {
        // A second prompt while one is open would orphan the first promise and
        // hang whatever awaited it. Cancel it — backing out is always safe.
        resolverRef.current?.(null);

        resolverRef.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const dialog = request ? (
    <PromptDialog
      {...request}
      onSubmit={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  ) : null;

  return { ask, dialog };
}

/**
 * The modal itself. Exported separately so it can be rendered directly in a
 * test without driving it through the hook.
 */
export function PromptDialog({
  title,
  label,
  placeholder = '',
  confirmLabel = 'Add',
  multiline = false,
  initialValue = '',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  // The same tap that places a pin opens this dialog, so the backdrop can
  // appear under the cursor before the browser dispatches `click`. Without this
  // guard the dialog dismisses itself with the gesture that opened it.
  const backdrop = useBackdropDismiss(onCancel);

  // Whitespace is not an answer. Trimming here as well as in the domain rule
  // means the button is visibly disabled rather than the user pressing it and
  // being told off — the check exists in both places on purpose, because the
  // interface's job is to prevent and the domain's job is to guarantee.
  const trimmed = value.trim();
  const canSubmit = trimmed !== '';

  // Focus the input, not the button: the user is here to type, and on an iPad
  // this is what raises the keyboard without a second tap. Via useAutoFocus
  // because this dialog opens mid-gesture and the tail of that gesture would
  // otherwise take the focus straight back. See that file for the full story.
  useAutoFocus(inputRef);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const submit = () => {
    if (canSubmit) onSubmit(trimmed);
  };

  /**
   * Enter submits a single-line prompt. In the multiline box it inserts a
   * newline as it should, and Ctrl/Cmd+Enter submits — the convention people
   * already have from every chat and comment box.
   */
  const onKeyDown = (event) => {
    if (event.key !== 'Enter') return;

    if (!multiline || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      submit();
    }
  };

  const Field = multiline ? 'textarea' : 'input';

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="prompt-title">{title}</h2>

        <label className="field">
          {label}
          <Field
            ref={inputRef}
            rows={multiline ? 3 : undefined}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
