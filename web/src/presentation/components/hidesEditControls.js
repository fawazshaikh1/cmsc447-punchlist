/**
 * Whether a lock should HIDE the edit controls rather than show them
 * disabled.
 *
 * An issued markup keeps its disabled Delete beside the notice, so the
 * explanation sits next to the control it explains. A role that can never
 * edit gets no controls at all (SCRUM-47): a row of greyed-out buttons that
 * will never work for this person is clutter, not information.
 *
 * @param {import('../../domain/policy').EditDecision} lock
 */
export function hidesEditControls(lock) {
  return lock.denied && lock.code !== 'sealed';
}
