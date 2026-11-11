import { ItemField } from '../ItemField';

/**
 * How urgent an item is — High, Medium or Low (spec 6.3).
 *
 * Stored like every other detail, so it appears in the sheet's side panel, the
 * Tasks tab, the CSV and the issued schedule with no edit to any of them. An
 * item that never had a priority reads as Medium: every item made before this
 * field existed sorts and filters as Medium without being rewritten, and only
 * a priority someone actually chose is printed on the schedule.
 */
export class PriorityField extends ItemField {
  static KEY = 'priority';
  static LEVELS = Object.freeze(['high', 'medium', 'low']);
  static DEFAULT = 'medium';
  static LABELS = Object.freeze({ high: 'High', medium: 'Medium', low: 'Low' });

  /**
   * An item's priority, Medium where none was set.
   *
   * @param {string} stored What the item's details hold for this field.
   * @returns {'high'|'medium'|'low'}
   */
  static of(stored) {
    return PriorityField.LEVELS.includes(stored) ? stored : PriorityField.DEFAULT;
  }

  getKey() {
    return PriorityField.KEY;
  }

  getLabel() {
    return 'Priority';
  }

  getInputKind() {
    return 'choice';
  }

  /** @returns {Array<[string, string]>} The choices in order, as [value, label]. */
  getChoices() {
    return PriorityField.LEVELS.map((level) => [level, PriorityField.LABELS[level]]);
  }

  /** What the editor shows before anything was chosen. */
  getDefault() {
    return PriorityField.DEFAULT;
  }

  normalize(raw) {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return PriorityField.LEVELS.includes(value) ? value : '';
  }

  format(value) {
    return PriorityField.LABELS[value] ?? '';
  }

  describeChange() {
    return 'Set priority of';
  }
}
