import { PIN_KIND } from '../annotations';
import { PunchListEntry } from './PunchListEntry';
import { PunchListRegistry } from './PunchListRegistry';
import { statusLabel } from './statusLabels';

export { PunchListEntry } from './PunchListEntry';
export { PunchListRegistry } from './PunchListRegistry';
export { assignOrdinals } from './ordinals';
export { STATUS_LABELS, statusLabel } from './statusLabels';
export { buildTaskList, filterTaskList, taskListOptions, TaskFilter } from './TaskList';

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
    // Whatever item fields are registered and set — trade, company, assignee,
    // due date. Read through the capability, so a pin built before details
    // existed simply has none.
    details: typeof pin.details?.labelled === 'function' ? pin.details.labelled() : [],
  }),
);
