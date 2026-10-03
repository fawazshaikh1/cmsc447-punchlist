import { DateItemField } from '../DateItemField';

/**
 * When the fix is due. Optional (D10).
 *
 * A date in the past is allowed on purpose: it is how an item that was due
 * last Friday gets recorded on Monday, and refusing it would push people into
 * entering a false date instead. Highlighting what is overdue is a separate
 * concern, built on CalendarDate.isBefore.
 */
export class DueDateField extends DateItemField {
  static KEY = 'dueDate';

  getKey() {
    return DueDateField.KEY;
  }

  getLabel() {
    return 'Due date';
  }
}
