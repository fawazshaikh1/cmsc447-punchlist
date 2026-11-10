import { PinStatus } from '../annotations/Pin';
import { PriorityField } from '../details/fields/PriorityField';
import { TaskFilter } from '../punchlist/TaskList';
import { TaskGroupRegistry } from './TaskGroupRegistry';
import { TaskSortRegistry } from './TaskSortRegistry';

/**
 * Filtering, sorting and grouping the Tasks tab's rows (spec 6.2). Pure: rows
 * in, rows out. What each sort and group means lives in their registries;
 * this file only applies them, and falls back to sheet order for a key it
 * does not know — an old bookmark of a sort that was removed still shows a
 * sensible list.
 */

/** The order of the sheets: drawing, page, then pin number; off-sheet last. */
export function bySheet(a, b) {
  return (
    Number(a.isOffSheet) - Number(b.isOffSheet) ||
    a.documentName.localeCompare(b.documentName) ||
    a.pageIndex - b.pageIndex ||
    a.ordinal - b.ordinal
  );
}

/** Open, then Ready for review, then Closed. */
export const STATUS_ORDER = Object.freeze([PinStatus.OPEN, PinStatus.READY_FOR_REVIEW, PinStatus.CLOSED]);

/** High, then Medium, then Low. */
export const PRIORITY_ORDER = PriorityField.LEVELS;

/**
 * @param {import('./taskRows').TaskRow[]} rows
 * @param {string} key A registered sort.
 * @returns {import('./taskRows').TaskRow[]} A new array; ties in sheet order.
 */
export function sortTaskRows(rows, key) {
  const sort = TaskSortRegistry.get(key) ?? TaskSortRegistry.get('sheet');
  const compare = sort ? sort.compare : bySheet;
  return [...rows].sort((a, b) => compare(a, b) || bySheet(a, b));
}

/**
 * @param {import('./taskRows').TaskRow[]} rows Already sorted; each group
 *        keeps that order.
 * @param {string} key A registered grouping, or 'none'.
 * @returns {{ key: string, label: string, rows: import('./taskRows').TaskRow[] }[]}
 */
export function groupTaskRows(rows, key) {
  const grouping = TaskGroupRegistry.get(key);
  if (!grouping) return rows.length > 0 ? [{ key: 'all', label: '', rows }] : [];

  /** @type {Map<string, { key: string, label: string, rows: import('./taskRows').TaskRow[] }>} */
  const groups = new Map();
  for (const row of rows) {
    const { key: groupKey, label } = grouping.groupOf(row);
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, label, rows: [] });
    groups.get(groupKey).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => grouping.order(a.rows[0], b.rows[0]));
}

/**
 * @param {import('./taskRows').TaskRow[]} rows
 * @param {object} filters
 * @param {string} [filters.status] A PinStatus, or a TaskFilter (still to do, overdue).
 * @param {string} [filters.priority] 'high', 'medium' or 'low'.
 * @param {string} [filters.company] Exact company, in any case or spacing.
 * @param {string} [filters.trade]
 * @param {string|null} [filters.assignedTo] Only this person's tasks.
 * @param {string} [filters.query] Words to find in the number, description,
 *        sheet, company, trade or assignee.
 * @returns {import('./taskRows').TaskRow[]}
 */
export function filterTaskRows(
  rows,
  { status = '', priority = '', company = '', trade = '', assignedTo = null, query = '' } = {},
) {
  const me = assignedTo ? fold(assignedTo) : null;
  const words = fold(query).split(' ').filter(Boolean);

  return rows.filter((row) => {
    if (status === TaskFilter.OUTSTANDING && row.statusKey === PinStatus.CLOSED) return false;
    if (status === TaskFilter.OVERDUE && !row.isOverdue) return false;
    if (status && status !== TaskFilter.OUTSTANDING && status !== TaskFilter.OVERDUE && row.statusKey !== status) {
      return false;
    }
    if (priority && row.priority !== priority) return false;
    if (company && fold(row.company) !== fold(company)) return false;
    if (trade && fold(row.trade) !== fold(trade)) return false;
    if (me && fold(row.assignee) !== me) return false;
    if (words.length > 0) {
      const haystack = fold(
        `${row.number} ${row.description} ${row.sheetLabel} ${row.company} ${row.trade} ${row.assignee}`,
      );
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

/** Case- and spacing-insensitive, as the punch list's own filters are. */
export function fold(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
