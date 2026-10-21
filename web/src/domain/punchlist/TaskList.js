import { PinStatus } from '../annotations';
import { AssigneeField } from '../details/fields/AssigneeField';
import { DueDateField } from '../details/fields/DueDateField';
import { ResponsibleCompanyField } from '../details/fields/ResponsibleCompanyField';
import { TradeField } from '../details/fields/TradeField';
import { documentNameOf } from '../documents/sheetNames';
import { MarkupFlagRegistry } from '../flags/MarkupFlagRegistry';
import { assignOrdinals } from './ordinals';
import { PunchListRegistry } from './PunchListRegistry';
import { statusLabel } from './statusLabels';

/**
 * The punch list as a person works through it on screen (SCRUM-32, SCRUM-52):
 * every punch item, grouped by drawing, numbered exactly as its pin and the
 * issued schedule number it, and filterable by status, company, trade and
 * who it is assigned to.
 *
 * Pure: annotations in, rows out. Where the annotations come from — the
 * whole project on the server, or the open drawing in browser mode — is the
 * caller's business.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AN ITEM
 * ---------------------------------------------------------------------------
 * Whatever the printed schedule lists: a kind with a builder in
 * PunchListRegistry. A box or a cloud is drawn on the sheet but is not a line
 * on the punch list, here or on paper.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS MATCH THE PINS
 * ---------------------------------------------------------------------------
 * Items are numbered per drawing with `assignOrdinals`, in sheet order and
 * then in the order each sheet lists them — the same call, on the same order,
 * that numbers the pins and the schedule. "Item 7" on screen is the pin with
 * 7 in it and line 7 of the issued PDF.
 */

/**
 * @typedef {object} TaskListItem
 * @property {string} id
 * @property {string} sheetId
 * @property {string} documentName
 * @property {number} pageIndex
 * @property {number} number Matches the pin and the schedule.
 * @property {string} description
 * @property {string} statusKey e.g. 'open'
 * @property {string} status As people read it, e.g. 'Ready for review'.
 * @property {string} trade
 * @property {string} company
 * @property {string} assignee
 * @property {string} dueDate ISO date, or ''.
 * @property {string[]} flags Ids of the flags that apply, e.g. ['overdue'].
 * @property {Date} createdAt
 */

/**
 * @typedef {object} TaskListGroup
 * @property {string} documentName
 * @property {boolean} isOpen Whether this is the drawing on screen.
 * @property {TaskListItem[]} items
 */

/**
 * @param {import('../annotations/Annotation').Annotation[]} annotations
 * @param {object} context
 * @param {import('../details/CalendarDate').CalendarDate} context.today
 * @param {string|null} [context.openDocument] The drawing on screen; listed first.
 * @returns {TaskListGroup[]}
 */
export function buildTaskList(annotations, { today, openDocument = null }) {
  /** @type {Map<string, Map<number, import('../annotations/Annotation').Annotation[]>>} */
  const byDocument = new Map();

  for (const annotation of annotations) {
    if (!PunchListRegistry.has(annotation.getKind())) continue;
    const documentName = documentNameOf(annotation.sheetId) ?? annotation.sheetId;
    const pageIndex = pageIndexOf(annotation.sheetId);

    if (!byDocument.has(documentName)) byDocument.set(documentName, new Map());
    const pages = byDocument.get(documentName);
    if (!pages.has(pageIndex)) pages.set(pageIndex, []);
    pages.get(pageIndex).push(annotation);
  }

  const groups = [];
  for (const [documentName, pageMap] of byDocument) {
    const pages = [...pageMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([pageIndex, list]) => ({ pageIndex, annotations: list }));
    const ordinals = assignOrdinals(pages);

    const items = pages.flatMap(({ pageIndex, annotations: list }) =>
      list.map((annotation) => itemFrom(annotation, { documentName, pageIndex, number: ordinals.get(annotation), today })),
    );
    groups.push({ documentName, isOpen: documentName === openDocument, items });
  }

  // The drawing on screen first, then the rest by name — a stable order, so
  // the list does not reshuffle while someone is reading it.
  return groups.sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.documentName.localeCompare(b.documentName));
}

function itemFrom(annotation, { documentName, pageIndex, number, today }) {
  const detail = (key) =>
    typeof annotation.details?.get === 'function' ? annotation.details.get(key) ?? '' : '';
  const statusKey = typeof annotation.status === 'string' ? annotation.status : PinStatus.OPEN;

  return Object.freeze({
    id: annotation.id,
    sheetId: annotation.sheetId,
    documentName,
    pageIndex,
    number,
    description: typeof annotation.label === 'string' ? annotation.label.trim() : '',
    statusKey,
    status: statusLabel(statusKey),
    trade: detail(TradeField.KEY),
    company: detail(ResponsibleCompanyField.KEY),
    assignee: detail(AssigneeField.KEY),
    dueDate: detail(DueDateField.KEY),
    flags: Object.freeze(MarkupFlagRegistry.flagsFor(annotation, { today }).map((flag) => flag.getId())),
    createdAt: annotation.createdAt,
  });
}

/** The page of a sheet id — `…#3` is the fourth page. 0 when there is none. */
function pageIndexOf(sheetId) {
  const match = /#(\d+)$/.exec(String(sheetId));
  return match ? Number(match[1]) : 0;
}

// --- filtering ---------------------------------------------------------------

/** The status filter's choices beyond the statuses themselves. */
export const TaskFilter = Object.freeze({
  ANY: '',
  /** Not closed — what is still to do. */
  OUTSTANDING: 'outstanding',
  OVERDUE: 'overdue',
});

/**
 * @param {TaskListGroup[]} groups
 * @param {object} filters
 * @param {string} [filters.status] A PinStatus value, or a TaskFilter.
 * @param {string} [filters.company] Exact company, as listed in the options.
 * @param {string} [filters.trade] Exact trade.
 * @param {string|null} [filters.assignedTo] A person's name: only their items.
 * @param {string} [filters.query] Words to find in the description, company,
 *        trade, assignee or number.
 * @returns {TaskListGroup[]} Groups left with no items are dropped.
 */
export function filterTaskList(groups, { status = '', company = '', trade = '', assignedTo = null, query = '' } = {}) {
  const me = assignedTo ? fold(assignedTo) : null;
  const words = fold(query).split(' ').filter(Boolean);

  const keep = (item) => {
    if (status === TaskFilter.OUTSTANDING && item.statusKey === PinStatus.CLOSED) return false;
    if (status === TaskFilter.OVERDUE && !item.flags.includes('overdue')) return false;
    if (status && status !== TaskFilter.OUTSTANDING && status !== TaskFilter.OVERDUE && item.statusKey !== status) return false;
    if (company && fold(item.company) !== fold(company)) return false;
    if (trade && fold(item.trade) !== fold(trade)) return false;
    if (me && fold(item.assignee) !== me) return false;
    if (words.length > 0) {
      const haystack = fold(`${item.number} ${item.description} ${item.company} ${item.trade} ${item.assignee}`);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  };

  return groups
    .map((group) => ({ ...group, items: group.items.filter(keep) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The companies and trades the list actually uses, for the filter menus —
 * each once, however its spelling or case varied, sorted.
 *
 * @param {TaskListGroup[]} groups
 * @returns {{ companies: string[], trades: string[] }}
 */
export function taskListOptions(groups) {
  const distinct = (pick) => {
    const seen = new Map();
    for (const group of groups) {
      for (const item of group.items) {
        const value = pick(item);
        if (value && !seen.has(fold(value))) seen.set(fold(value), value);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };
  return { companies: distinct((item) => item.company), trades: distinct((item) => item.trade) };
}

/** Case- and spacing-insensitive, so "Rivera  electric" is "Rivera Electric". */
function fold(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
