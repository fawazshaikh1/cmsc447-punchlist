import { AnnotationRegistry } from '../annotations/AnnotationRegistry';
import { PinStatus } from '../annotations/Pin';
import { LocationCheckField } from '../details/fields/LocationCheckField';
import { documentNameOf } from '../documents/sheetNames';
import { PunchListRegistry } from '../punchlist/PunchListRegistry';

/**
 * @typedef {{ previous: import('../annotations/Annotation').Annotation, next: import('../annotations/Annotation').Annotation }} CarryMove
 * @typedef {{ annotation: import('../annotations/Annotation').Annotation, reason: string }} LeftBehind
 */

/**
 * Which open items move to a revised set, and where (SCRUM-91, D7).
 *
 * Items belong to a SHEET NUMBER, not to a page of a file: a revision can add,
 * drop and reorder pages, and an item on A-101 must land on whichever page of
 * the new set is A-101. It moves as itself — the same id, so its history,
 * comments and photos follow it — at the same spot on the sheet, flagged
 * "sheet revised — verify location" until someone who may edit it confirms
 * its place (LocationCheckField, RevisedSheetFlag).
 *
 * Only open items move (Open and Ready for review). A closed item is part of
 * the record of the set it was closed on, and stays there. An issued item
 * stays too, open or not: an issue seals what it printed, and the sealed
 * markups are the record of what went out on THAT set (SCRUM-38) — moving one
 * would change an issued document after the fact. The caller passes the
 * project's sealed ids, because the editor's own policy only knows the seals
 * of the sheet that is open. Markups that are not items — clouds, arrows,
 * notes about the old drawing — stay as well. An open item that is issued,
 * whose sheet has no number, or whose number is not in the revision, is left
 * where it is and listed with the reason, never dropped silently.
 *
 * Pure, so it is checked in Node (verify-revisions).
 *
 * @param {object} request
 * @param {import('../annotations/Annotation').Annotation[]} request.items
 *        Markups in the project; those not on `fromDocument` are ignored.
 * @param {string} request.fromDocument The set being replaced.
 * @param {string} request.toDocument The revision.
 * @param {import('../sheets/SheetName').SheetName[]} request.fromSheets
 * @param {import('../sheets/SheetName').SheetName[]} request.toSheets
 * @param {(documentName: string, pageIndex: number) => string} request.sheetIdFor
 * @param {Set<string>} [request.sealedIds] Ids of markups sealed by an issue.
 * @returns {{ moves: CarryMove[], left: LeftBehind[] }}
 */
export function planCarryForward({ items, fromDocument, toDocument, fromSheets, toSheets, sheetIdFor, sealedIds = new Set() }) {
  const kinds = new Set(PunchListRegistry.registeredKinds());
  const numberOnPage = new Map(fromSheets.map((sheet) => [sheet.pageIndex, sheet.number]));
  const pageForNumber = new Map();
  for (const sheet of toSheets) {
    const key = squash(sheet.number);
    if (key && !pageForNumber.has(key)) pageForNumber.set(key, sheet.pageIndex);
  }

  const moves = [];
  const left = [];
  for (const annotation of items) {
    if (!kinds.has(annotation.getKind())) continue;
    if (documentNameOf(annotation.sheetId) !== fromDocument) continue;
    if (annotation.status === PinStatus.CLOSED) continue;
    if (sealedIds.has(annotation.id)) {
      left.push({ annotation, reason: 'Issued items stay with the set they were issued on; void the issue to move them.' });
      continue;
    }

    const number = numberOnPage.get(pageIndexOf(annotation.sheetId)) ?? '';
    if (!squash(number)) {
      left.push({ annotation, reason: 'Its sheet has no number to match.' });
      continue;
    }
    const target = pageForNumber.get(squash(number));
    if (target === undefined) {
      left.push({ annotation, reason: `${number} is not in the revised set.` });
      continue;
    }

    const moved = AnnotationRegistry.fromJSON({ ...annotation.toJSON(), sheetId: sheetIdFor(toDocument, target) });
    const next = typeof moved.withDetail === 'function' ? moved.withDetail(LocationCheckField.KEY, fromDocument) : moved;
    moves.push({ previous: annotation, next });
  }
  return { moves, left };
}

/** "A-101", "a101" and "A 101" are the same sheet. */
function squash(number) {
  return String(number ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pageIndexOf(sheetId) {
  const match = /#(\d+)$/.exec(String(sheetId));
  return match ? Number(match[1]) : 0;
}
