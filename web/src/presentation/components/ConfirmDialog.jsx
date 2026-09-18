import { useCallback, useEffect, useRef, useState } from 'react';

import { useAutoFocus } from './useAutoFocus';
import { useBackdropDismiss } from './useBackdropDismiss';

/**
 * A modal that asks before something irreversible happens.
 *
 * ===========================================================================
 * WHY THIS IS PROMISE-BASED
 * ===========================================================================
 * The alternative — an `open` boolean, a `pendingAction` in state, and an
 * `onConfirm` that remembers what it was about to do — splits one decision
 * across three pieces of state and a callback. Every caller reinvents it, and
 * the bug it invites is the worst one available here: a stale
 * `pendingAction` firing the PREVIOUS confirmation's effect.
 *
 * With `await ask(...)` the caller reads top to bottom, and what happens after
 * "yes" sits directly under the question:
 *
 *     const { ask, dialog } = useConfirmation();
 *     ...
 *     if (!(await ask({ title: 'Close this item?', body: ... }))) return;
 *     await doTheThing();
 *     ...
 *     return <>{dialog}...</>;
 *
 * ===========================================================================
 * WHY `window.confirm` IS NOT GOOD ENOUGH HERE
 * ===========================================================================
 * These particular messages are the only warning a user gets before work
 * becomes permanent, and they need more than one line: what is about to happen,
 * what it costs, and what is still possible afterwards. A native confirm gives
 * a single unstyled string, cannot show a count, and on iPad Safari is
 * dismissible in ways that read as agreement.
 */

/**
 * @typedef {object} ConfirmRequest
 * @property {string} title
 * @property {React.ReactNode} body
 * @property {string} [confirmLabel]
 * @property {string} [cancelLabel]
 * @property {'danger'|'normal'} [tone] `danger` styles the confirm button as
 *           destructive. Used for anything that cannot be undone.
 */

/**
 * @returns {{ ask: (request: ConfirmRequest) => Promise<boolean>, dialog: React.ReactNode }}
 */
export function useConfirmation() {
  const [request, setRequest] = useState(null);

  // The pending promise's resolver. In a ref, not state: resolving it must not
  // depend on a render having happened, and storing a function in state would
  // make React call it as a lazy initialiser.
  const resolverRef = useRef(null);

  const settle = useCallback((answer) => {
    resolverRef.current?.(answer);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const ask = useCallback(
    (next) =>
      new Promise((resolve) => {
        // A second question while one is open would orphan the first promise
        // and hang whatever was awaiting it. Answer it "no" first — declining
        // is always the safe outcome for a question about permanence.
        resolverRef.current?.(false);

        resolverRef.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const dialog = request ? (
    <ConfirmDialog
      {...request}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { ask, dialog };
}

/**
 * The modal itself. Exported separately so it can be rendered directly in a
 * test or a Storybook entry without driving it through the hook.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'normal',
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  // Shared with PromptDialog: a backdrop click only dismisses when the gesture
  // began on the backdrop. See useBackdropDismiss for the race it prevents.
  const backdrop = useBackdropDismiss(onCancel);

  useEffect(() => {
    // Escape cancels, wherever focus happens to be. Captured on the document
    // rather than the dialog because the user may not have tabbed into it yet.
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  // Focus the CONFIRM button, but never auto-submit: a user who hits Enter out
  // of habit should be aiming at something they have had a chance to read.
  // Keyboard users land inside the dialog rather than behind it.
  useAutoFocus(confirmRef);

  return (
    <div
      className="modal-backdrop"
      // Clicking the backdrop cancels. An accidental click outside a dialog is
      // far more likely than a deliberate one, and cancelling is the outcome
      // that loses nothing — but only when the click STARTED there.
      role="presentation"
      {...backdrop}
    >
      <div
        className={`modal modal-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        // Stops a click inside the panel from reaching the backdrop handler and
        // dismissing the very dialog the user is reading.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>

        <div className="modal-body">{body}</div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
