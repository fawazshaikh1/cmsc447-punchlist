/**
 * A day on the calendar — a due date — with no time and no time zone.
 *
 * ===========================================================================
 * WHY NOT A Date
 * ===========================================================================
 * A due date is "the 10th of October", not an instant. Storing it as a `Date`
 * makes it an instant at midnight UTC, and the bug that follows is the classic
 * one: `new Date('2026-10-10')` is UTC midnight, which in Baltimore is the
 * evening of the 9th. Every due date entered on the east coast would display a
 * day early, and an item would turn overdue a day before it actually is.
 *
 * So the value is the three numbers and nothing else, stored as the ISO day
 * string `YYYY-MM-DD` — exactly what `<input type="date">` produces, what sorts
 * correctly as text, and what Postgres's `date` type accepts without a cast.
 * A `Date` is built only at the edge, in local time, when something needs one
 * to display.
 *
 * Immutable, like every other value object in the domain.
 */
export class CalendarDate {
  /**
   * The years a due date may fall in. Not a product rule so much as a typo
   * catch: a browser date box lets a thumb type a five-digit year, and 0026 or
   * 20266 is never what anybody meant.
   */
  static MIN_YEAR = 1900;
  static MAX_YEAR = 2999;

  static #PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  /**
   * @param {number} year Four digits, MIN_YEAR..MAX_YEAR.
   * @param {number} month 1..12.
   * @param {number} day 1..31, and real for that month and year.
   */
  constructor(year, month, day) {
    if (!CalendarDate.#isReal(year, month, day)) {
      throw new RangeError(`${year}-${month}-${day} is not a date between ${CalendarDate.MIN_YEAR} and ${CalendarDate.MAX_YEAR}.`);
    }

    this.year = year;
    this.month = month;
    this.day = day;
    Object.freeze(this);
  }

  /**
   * Reads an ISO day string. Returns null rather than throwing for anything
   * that is not a real date, because the callers are reading storage and user
   * input — places where a bad value is expected and must not crash a sheet.
   *
   * Rejects 2026-02-30 and 2027-02-29 (real-calendar check, not just a shape
   * check), and rejects timestamps: `2026-10-10T00:00:00Z` is an instant, and
   * accepting it would reintroduce the very time-zone bug this class exists to
   * prevent.
   *
   * @param {unknown} value
   * @returns {CalendarDate|null}
   */
  static parse(value) {
    if (typeof value !== 'string') return null;

    const match = CalendarDate.#PATTERN.exec(value.trim());
    if (!match) return null;

    const [year, month, day] = match.slice(1).map(Number);
    return CalendarDate.#isReal(year, month, day) ? new CalendarDate(year, month, day) : null;
  }

  /**
   * The calendar day a `Date` falls on IN LOCAL TIME — "today", as the person
   * holding the tablet understands it.
   *
   * @param {Date} date
   * @returns {CalendarDate}
   */
  static fromLocalDate(date) {
    return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  /** @returns {string} `YYYY-MM-DD`. */
  toString() {
    const pad = (n, width) => String(n).padStart(width, '0');
    return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
  }

  /** @returns {string} */
  toJSON() {
    return this.toString();
  }

  /**
   * Local midnight on this day, for display only. Never store the result.
   * @returns {Date}
   */
  toLocalDate() {
    return new Date(this.year, this.month - 1, this.day);
  }

  /**
   * @param {CalendarDate} other
   * @returns {number} Negative if this is earlier, 0 if the same day, positive if later.
   */
  compareTo(other) {
    return this.year - other.year || this.month - other.month || this.day - other.day;
  }

  /** @param {CalendarDate} other */
  isBefore(other) {
    return this.compareTo(other) < 0;
  }

  /** @param {CalendarDate} other */
  equals(other) {
    return other instanceof CalendarDate && this.compareTo(other) === 0;
  }

  static #isReal(year, month, day) {
    if (![year, month, day].every(Number.isInteger)) return false;
    if (year < CalendarDate.MIN_YEAR || year > CalendarDate.MAX_YEAR) return false;
    if (month < 1 || month > 12 || day < 1) return false;

    // Day 0 of the NEXT month is the last day of this one. UTC so the answer
    // cannot be bent by a daylight-saving boundary.
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= daysInMonth;
  }
}
