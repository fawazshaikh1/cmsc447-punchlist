import { PinStatus } from '../annotations';

/**
 * How each status reads to a person — on the printed schedule and in the punch
 * list on screen, which must say the same thing.
 *
 * Kept apart from `PinStatus` because it is wording, not data. The stored
 * values stay lowercase and underscored, which is what a database column and
 * the API want; only what people read spells them out. Adding a status means
 * adding a line here — and if someone forgets, `statusLabel` falls back to the
 * raw value rather than printing nothing.
 */
export const STATUS_LABELS = Object.freeze({
  [PinStatus.OPEN]: 'Open',
  [PinStatus.READY_FOR_REVIEW]: 'Ready for review',
  [PinStatus.CLOSED]: 'Closed',
});

/** @param {string} status */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status).replace(/_/g, ' ');
}
