import { CalendarDate } from '../../domain/details';

/**
 * What flags need to know about "now": today's date where the user is.
 *
 * Built fresh on each call rather than cached, so a sheet left open overnight
 * turns an item overdue on the next render after midnight instead of keeping
 * yesterday's answer. It is three numbers; there is nothing worth caching.
 *
 * @returns {import('../../domain/flags/MarkupFlag').FlagContext}
 */
export function currentFlagContext() {
  return { today: CalendarDate.fromLocalDate(new Date()) };
}
