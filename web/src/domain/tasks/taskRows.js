import { PriorityField } from '../details/fields/PriorityField';
import { buildTaskList } from '../punchlist/TaskList';
import { isOffSheet } from './offSheet';

/**
 * @typedef {import('../punchlist/TaskList').TaskListItem & {
 *   annotation: import('../annotations/Annotation').Annotation,
 *   ordinal: number,
 *   number: string,
 *   isOffSheet: boolean,
 *   drawing: string,
 *   priority: 'high'|'medium'|'low',
 *   priorityLabel: string,
 *   isOverdue: boolean,
 *   isLocked: boolean,
 *   lastChange: import('../audit/ChangeRecord').ChangeRecord|null,
 *   comments: number,
 * }} TaskRow
 *
 * One line of the Tasks tab. It is the punch list's item — numbered exactly
 * as its pin, the schedule and the side panel's list number it — plus what
 * the Tasks tab adds: priority, whether it is on a drawing at all, whether an
 * issue has locked it, who last changed it, and how many comments it has.
 *
 * `number` is what people read: the pin's number, or G-1, G-2 for a task off
 * the drawings. `ordinal` is the plain count behind it, for sorting.
 */

/**
 * Every task in the project as Tasks-tab rows, in sheet order.
 *
 * @param {import('../annotations/Annotation').Annotation[]} annotations Every
 *        markup in the project; the ones that are not tasks are left out.
 * @param {object} context
 * @param {import('../details/CalendarDate').CalendarDate} context.today
 * @param {(documentName: string, pageIndex: number) => string} [context.sheetLabelFor]
 * @param {Set<string>} [context.sealedIds] Locked by an issued PDF.
 * @param {Map<string, import('../audit/ChangeRecord').ChangeRecord>} [context.lastChanges]
 * @param {Map<string, number>} [context.commentCounts]
 * @returns {TaskRow[]}
 */
export function buildTaskRows(
  annotations,
  { today, sheetLabelFor, sealedIds = new Set(), lastChanges = new Map(), commentCounts = new Map() },
) {
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const groups = buildTaskList(annotations, { today, ...(sheetLabelFor ? { sheetLabelFor } : {}) });

  return groups.flatMap((group) =>
    group.items.map((item) => {
      const annotation = byId.get(item.id);
      const offSheet = isOffSheet(item.sheetId);
      const priority = PriorityField.of(annotation?.details?.get?.(PriorityField.KEY) ?? '');
      return Object.freeze({
        ...item,
        annotation,
        ordinal: item.number,
        number: offSheet ? `G-${item.number}` : String(item.number),
        isOffSheet: offSheet,
        drawing: offSheet ? '' : item.documentName,
        sheetLabel: offSheet ? 'Not on a sheet' : item.sheetLabel,
        priority,
        priorityLabel: PriorityField.LABELS[priority],
        isOverdue: item.flags.includes('overdue'),
        isLocked: sealedIds.has(item.id),
        lastChange: lastChanges.get(item.id) ?? null,
        comments: commentCounts.get(item.id) ?? 0,
      });
    }),
  );
}
