import { useCallback, useRef } from 'react';

/**
 * Makes a modal backdrop dismiss only on a click that STARTED on the backdrop.
 *
 * ===========================================================================
 * THE BUG THIS FIXES
 * ===========================================================================
 * A pointer gesture delivers `pointerdown`, `pointerup`, then `click`. Placing
 * a pin opens the description prompt during `pointerdown` — so by the time the
 * browser dispatches `click`, the backdrop has rendered UNDER THE CURSOR and
 * receives it. The dialog closed itself with the same tap that opened it.
 *
 * It was intermittent, which is what makes it worth a named helper rather than
 * a quick guard: whether it happened depended on whether React had committed
 * the render before `click` was dispatched. On a fast machine the dialog
 * flickered and vanished; on a slow one it stayed. A user would have reported
 * it as "sometimes pins do not work".
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * A backdrop click means "I deliberately clicked outside the dialog", and that
 * intent is only real if the gesture BEGAN outside it. So dismissal requires a
 * `pointerdown` on the backdrop as well as a `click` on it.
 *
 * That also fixes a second, quieter annoyance for free: selecting text inside
 * the dialog and releasing the mouse past its edge no longer throws the dialog
 * away along with whatever the user had typed.
 *
 * @param {() => void} onDismiss
 * @returns {{ onPointerDown: (e: React.PointerEvent) => void,
 *             onClick: (e: React.MouseEvent) => void }}
 *          Spread onto the backdrop element.
 */
export function useBackdropDismiss(onDismiss) {
  // A ref, not state: it is read in the very next event of the same gesture,
  // long before a re-render would deliver a state update.
  const startedOnBackdrop = useRef(false);

  const onPointerDown = useCallback((event) => {
    // `currentTarget` is the backdrop; `target` is what was actually under the
    // pointer. Equal means the press landed on the backdrop itself rather than
    // on the dialog panel inside it.
    startedOnBackdrop.current = event.target === event.currentTarget;
  }, []);

  const onClick = useCallback(
    (event) => {
      const deliberate = startedOnBackdrop.current && event.target === event.currentTarget;

      // Reset first: a click that does not dismiss must not leave the flag set
      // for the next one, or a press inside followed by a stray click outside
      // would close the dialog.
      startedOnBackdrop.current = false;

      if (deliberate) onDismiss();
    },
    [onDismiss],
  );

  return { onPointerDown, onClick };
}
