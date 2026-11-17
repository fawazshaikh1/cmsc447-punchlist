/**
 * What went wrong, in words for the person — an Error's message, or the
 * thing itself when something other than an Error was thrown.
 *
 * @param {unknown} cause
 * @returns {string}
 */
export function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
