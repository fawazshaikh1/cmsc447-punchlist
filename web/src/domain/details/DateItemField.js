import { CalendarDate } from './CalendarDate';
import { ItemField } from './ItemField';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A calendar day — a due date. Stored as `YYYY-MM-DD`; see CalendarDate for
 * why it is never a timestamp.
 *
 * Abstract in practice, like TextItemField: a concrete field supplies its key
 * and label.
 */
export class DateItemField extends ItemField {
  getInputKind() {
    return 'date';
  }

  /** @param {unknown} raw */
  normalize(raw) {
    return CalendarDate.parse(raw)?.toString() ?? '';
  }

  /**
   * Empty is fine — it clears the date. Anything else must be a real day.
   * @param {unknown} raw
   */
  validate(raw) {
    if (raw === '' || raw === null || raw === undefined) return null;
    if (typeof raw === 'string' && raw.trim() === '') return null;
    if (CalendarDate.parse(raw)) return null;

    return `Enter a real date between ${CalendarDate.MIN_YEAR} and ${CalendarDate.MAX_YEAR}.`;
  }

  /**
   * "10 Oct 2026". Spelled out rather than numeric because 10/03/2026 means
   * two different days on either side of the Atlantic, and the architect
   * receiving the export may be on either. Built by hand rather than with
   * `Intl` so an exported PDF reads the same whatever the browser's locale.
   *
   * @param {string} value
   */
  format(value) {
    const date = CalendarDate.parse(value);
    return date ? `${date.day} ${MONTHS[date.month - 1]} ${date.year}` : '';
  }
}
