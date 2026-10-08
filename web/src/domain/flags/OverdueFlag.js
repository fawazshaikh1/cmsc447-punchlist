import { PinStatus } from '../annotations/Pin';
import { CalendarDate } from '../details/CalendarDate';
import { DueDateField } from '../details/fields/DueDateField';
import { MarkupFlag } from './MarkupFlag';

const DUE_DATE = new DueDateField();

/**
 * A punch item whose due date has passed while the work is still open.
 *
 * ===========================================================================
 * WHAT COUNTS AS OVERDUE
 * ===========================================================================
 *   - It has a due date, and that day is BEFORE today. Due today is not late
 *     until tomorrow — the trade has the whole day.
 *   - Its status is Open. "Ready for review" means the trade says the work is
 *     done and is waiting on the general contractor; flagging it red would
 *     blame the subcontractor for the reviewer's delay. A rejected item goes
 *     back to Open (D3) and becomes overdue again.
 *   - Closed is never overdue.
 *
 * Asks for capabilities, not types: anything with `details` and `status`
 * qualifies, so a future markup type that gains a due date is flagged too.
 */
export class OverdueFlag extends MarkupFlag {
  static ID = 'overdue';

  getId() {
    return OverdueFlag.ID;
  }

  getTone() {
    return 'danger';
  }

  /** @param {import('./MarkupFlag').FlagContext} context */
  appliesTo(annotation, context) {
    if (annotation?.status !== PinStatus.OPEN) return false;

    const due = dueDateOf(annotation);
    return Boolean(due && context?.today && due.isBefore(context.today));
  }

  /** @param {import('./MarkupFlag').FlagContext} context */
  describe(annotation, context) {
    const due = dueDateOf(annotation);
    const days = daysBetween(due, context.today);
    const ago = days === 1 ? 'yesterday' : `${days} days ago`;

    return `Overdue — was due ${DUE_DATE.format(due.toString())}, ${ago}.`;
  }
}

function dueDateOf(annotation) {
  if (typeof annotation?.details?.get !== 'function') return null;
  return CalendarDate.parse(annotation.details.get(DueDateField.KEY));
}

/** Whole calendar days from `earlier` to `later`, immune to daylight saving. */
function daysBetween(earlier, later) {
  const utc = (date) => Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((utc(later) - utc(earlier)) / 86_400_000);
}
