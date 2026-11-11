import { statusLabel } from '../punchlist/statusLabels';
import { PRIORITY_ORDER, STATUS_ORDER, bySheet } from './TaskQuery';

/**
 * The sorts and groupings the Tasks tab ships with (spec 6.2), registered in
 * `domain/tasks/index.js`. Each is a plain definition; adding one is a new
 * entry there, not an edit to the list.
 */

const rank = (order, value) => {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
};

/** Sheet first because a punch walk goes sheet by sheet. */
export const SORTS = Object.freeze([
  ['sheet', { label: 'Sheet', compare: bySheet }],
  ['number', { label: 'Number', compare: (a, b) => Number(a.isOffSheet) - Number(b.isOffSheet) || a.ordinal - b.ordinal }],
  ['status', { label: 'Status', compare: (a, b) => rank(STATUS_ORDER, a.statusKey) - rank(STATUS_ORDER, b.statusKey) }],
  ['priority', { label: 'Priority', compare: (a, b) => rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority) }],
  [
    'dueDate',
    {
      label: 'Due date',
      // Soonest first; a task with no due date is not urgent by any date, so last.
      compare: (a, b) => (a.dueDate ? 0 : 1) - (b.dueDate ? 0 : 1) || a.dueDate.localeCompare(b.dueDate),
    },
  ],
  [
    'updated',
    {
      label: 'Last updated',
      // Most recent first; never changed since it was made, last.
      compare: (a, b) => (b.lastChange?.at ?? '').localeCompare(a.lastChange?.at ?? ''),
    },
  ],
]);

export const GROUPINGS = Object.freeze([
  [
    'sheet',
    {
      label: 'Sheet',
      groupOf: (row) =>
        row.isOffSheet
          ? { key: 'off-sheet', label: 'Not on a sheet' }
          : { key: `${row.documentName}#${row.pageIndex}`, label: `${row.sheetLabel} — ${row.documentName}` },
      order: (a, b) =>
        Number(a.isOffSheet) - Number(b.isOffSheet) ||
        a.documentName.localeCompare(b.documentName) ||
        a.pageIndex - b.pageIndex,
    },
  ],
  [
    'status',
    {
      label: 'Status',
      groupOf: (row) => ({ key: row.statusKey, label: statusLabel(row.statusKey) }),
      order: (a, b) => rank(STATUS_ORDER, a.statusKey) - rank(STATUS_ORDER, b.statusKey),
    },
  ],
  [
    'priority',
    {
      label: 'Priority',
      groupOf: (row) => ({ key: row.priority, label: row.priorityLabel }),
      order: (a, b) => rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority),
    },
  ],
  [
    'company',
    {
      label: 'Company',
      groupOf: (row) =>
        row.company ? { key: `c:${row.company.toLocaleLowerCase()}`, label: row.company } : { key: 'none', label: 'No company' },
      order: (a, b) => (a.company ? 0 : 1) - (b.company ? 0 : 1) || a.company.localeCompare(b.company),
    },
  ],
]);
