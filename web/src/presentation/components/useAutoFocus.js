import { useEffect } from 'react';

/**
 * Focuses an element when a dialog opens, and keeps it focused through the tail
 * of the gesture that opened it.
 *
 * ===========================================================================
 * WHY A PLAIN `focus()` IN AN EFFECT IS NOT ENOUGH HERE
 * ===========================================================================
 * The description prompt opens during `pointerdown` — partway through a tap.
 * React commits, the effect runs, the field takes focus, and THEN the rest of
 * that same gesture arrives: `pointerup`, then `click`, landing on the backdrop
 * that has just appeared under the cursor. Pressing a non-focusable element
 * moves focus to `<body>`, so the field is focused and then quietly un-focused
 * before the user can type a character.
 *
 * Observed exactly that: the dialog opened correctly, `document.activeElement`
 * was `BODY`, and everything typed went nowhere.
 *
 * On a desktop that is an annoyance — one extra click. On an iPad it is the
 * feature failing, because the on-screen keyboard only appears for a focused
 * field. Requiring a description and then not raising the keyboard would make
 * placing a pin take two taps instead of one, on the single most repeated
 * action in the product.
 *
 * ---------------------------------------------------------------------------
 * THE FIX
 * ---------------------------------------------------------------------------
 * Focus now, and again on the next animation frame — by which point the
 * gesture's remaining events have been dispatched. The second call is a no-op
 * whenever the first one held, which is the common case for a dialog opened
 * from a button rather than mid-gesture.
 *
 * Deliberately NOT a timeout: a frame is tied to the browser actually having
 * processed the pending input, whereas a millisecond figure is a guess that
 * would be wrong on some device.
 *
 * @param {React.RefObject<HTMLElement>} ref
 */
export function useAutoFocus(ref) {
  useEffect(() => {
    ref.current?.focus();

    const frame = requestAnimationFrame(() => {
      // Only reclaim focus if it was lost to the page body. If the user has
      // already tabbed to another control inside the dialog, stealing it back
      // would be worse than the problem being solved.
      if (document.activeElement === document.body) ref.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
