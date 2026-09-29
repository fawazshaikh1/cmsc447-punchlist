import { useCallback, useEffect, useRef } from 'react';

/**
 * A text field that commits when the user finishes with it — by any route.
 *
 * ===========================================================================
 * THE BUG THIS FIXES
 * ===========================================================================
 * The panel's fields committed on `blur`, chosen so an edit is ONE undo step
 * rather than one per keystroke. That reasoning still holds. What it missed is
 * that `blur` does not fire when a focused element is removed from the DOM.
 *
 * So typing a caption and then doing any of these lost it silently:
 *
 *   - closing the panel with its × button
 *   - selecting a different markup (the field is keyed by annotation id, so
 *     React unmounts it)
 *   - changing sheets, or opening another drawing
 *
 * Reproduced on the photo caption, but the pin description and the callout text
 * had exactly the same hole. Silent data loss on the field a user is most
 * likely to be in the middle of.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PENDING EDIT CARRIES ITS OWN COMMIT FUNCTION
 * ---------------------------------------------------------------------------
 * The subtle case is selecting a DIFFERENT markup. The panel does not unmount —
 * it re-renders with new props — so by the time a cleanup runs, `commit` from
 * the current render closes over the NEW annotation. Flushing with that would
 * write the text you typed for photo A onto photo B.
 *
 * So the keystroke stores `{ commit, value }` together, capturing the commit
 * closure from the render the user was actually typing in. Every flush path —
 * blur, selection change, unmount — applies that same pair, and cannot apply an
 * edit to the wrong annotation.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST CONTROL THE INPUT
 * ---------------------------------------------------------------------------
 * A controlled field committing on every keystroke would produce one undo entry
 * per character, and each one is a repository write. Debouncing narrows that
 * window without closing it — the last few hundred milliseconds are still lost
 * on unmount. This closes it entirely.
 *
 * @param {string} storedValue The value currently in the annotation.
 * @param {(next: string) => void} commit Called with the new value, at most
 *        once per edit.
 * @param {unknown} identity Something that changes when the field starts
 *        describing a different thing — normally the annotation's id. A change
 *        flushes the pending edit before the field is reused.
 * @returns {{ onChange: Function, onBlur: Function, flush: Function }}
 */
export function useCommitOnBlur(storedValue, commit, identity) {
  /** @type {{ current: { commit: Function, value: string } | null }} */
  const pending = useRef(null);

  const flush = useCallback(() => {
    const edit = pending.current;
    if (!edit) return;

    // Cleared BEFORE committing, so a commit that re-renders and triggers
    // another flush cannot apply the same edit twice.
    pending.current = null;

    if (edit.value !== edit.storedValue) edit.commit(edit.value);
  }, []);

  // `flush` reads everything it needs from the ref, so it has no dependencies
  // and is stable for the life of the component. That is what lets it sit in
  // this dependency list without causing the effect to re-run: the cleanup
  // fires only when the field moves to another annotation, and when the panel
  // unmounts. Both mean "the user has finished with this field".
  //
  // An earlier version kept `flush` in a ref updated during render. That works,
  // but writing to a ref while rendering is not safe under concurrent React and
  // was not needed once `flush` turned out to be stable already.
  useEffect(() => () => flush(), [identity, flush]);

  return {
    /**
     * Records the keystroke without committing it. A ref write, so typing
     * costs nothing and the field stays uncontrolled.
     */
    onChange: (event) => {
      pending.current = { commit, value: event.target.value, storedValue };
    },
    onBlur: flush,
    flush,
  };
}
