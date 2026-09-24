import { PIN_KIND, PinStatus } from '../annotations';
import { PunchListEntry } from './PunchListEntry';
import { PunchListRegistry } from './PunchListRegistry';

export { PunchListEntry } from './PunchListEntry';
export { PunchListRegistry } from './PunchListRegistry';
export { assignOrdinals } from './ordinals';

/**
 * How each status reads on a printed schedule.
 *
 * Kept here rather than on `PinStatus` because it is a presentation decision
 * about one document. The stored values stay lowercase and underscored, which
 * is what a database column and a future API want; only the schedule spells
 * them out. Adding a status means adding a line here — and if someone forgets,
 * `statusLabel` falls back to the raw value rather than printing nothing.
 */
const STATUS_LABELS = Object.freeze({
  [PinStatus.OPEN]: 'Open',
  [PinStatus.READY_FOR_REVIEW]: 'Ready for review',
  [PinStatus.CLOSED]: 'Closed',
});

/** @param {string} status */
function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status).replace(/_/g, ' ');
}

/**
 * A pin is a punch item, so a pin is a row on the schedule.
 *
 * ===========================================================================
 * WHY THIS LIVES HERE AND NOT IN Pin.js
 * ===========================================================================
 * `Pin` already knows it is a punch item. What it does not need to know is that
 * a PDF export prints a schedule, or how that schedule words a status — those
 * are facts about a document the domain object is never shown.
 *
 * Registering from the outside keeps that ignorance intact. It is also the
 * difference between "a pin gained a method" and "the export gained a feature":
 * this whole folder can be deleted and `Pin` still compiles.
 */
PunchListRegistry.register(PIN_KIND, (pin, { number, pageIndex }) =>
  new PunchListEntry({
    number,
    pageIndex,
    description: pin.label,
    status: statusLabel(pin.status),
    statusKey: pin.status,
    createdAt: pin.createdAt,
  }),
);
