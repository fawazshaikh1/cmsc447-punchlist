/**
 * The Tasks tab as a spreadsheet (spec 6.7, SRS 4.9.5): the rows on screen,
 * filtered and sorted as they are shown, one line each.
 *
 * Written for Excel, where most of these files are opened:
 *   - a byte-order mark, without which Excel reads UTF-8 as Latin-1 and
 *     "café" arrives as "cafÃ©";
 *   - CRLF line ends, and RFC 4180 quoting, so a description with a comma,
 *     a quote or a new line stays in its own cell;
 *   - text that starts like a formula (=, +, -, @) is prefixed with an
 *     apostrophe. A description is typed by anyone on the project, and a cell
 *     that Excel runs on opening is how a shared CSV becomes an attack.
 *
 * Pure, so it is checked in Node (verify-tasks-tab).
 */

const COLUMNS = Object.freeze([
  ['Number', (row) => row.number],
  ['Drawing', (row) => row.drawing],
  ['Sheet', (row) => row.sheetLabel],
  ['Description', (row) => row.description],
  ['Status', (row) => row.status],
  ['Priority', (row) => row.priorityLabel],
  ['Trade', (row) => row.trade],
  ['Company', (row) => row.company],
  ['Assigned to', (row) => row.assignee],
  ['Due date', (row) => row.dueDate],
  ['Overdue', (row) => (row.isOverdue ? 'Yes' : '')],
  ['Created', (row) => isoDate(row.createdAt)],
  ['Last updated by', (row) => (row.lastChange ? String(row.lastChange.actor) : '')],
  ['Last updated at', (row) => row.lastChange?.at ?? ''],
]);

/**
 * @param {import('./taskRows').TaskRow[]} rows In the order to write them.
 * @returns {string}
 */
export function taskCsv(rows) {
  const lines = [COLUMNS.map(([title]) => cell(title))];
  for (const row of rows) lines.push(COLUMNS.map(([, pick]) => cell(pick(row))));
  return `﻿${lines.map((line) => line.join(',')).join('\r\n')}`;
}

function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
