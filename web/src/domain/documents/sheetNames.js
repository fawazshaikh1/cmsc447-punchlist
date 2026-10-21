import { SheetScope } from '../projects/SheetScope';

/**
 * How a sheet is named: `{document}#{page}` — the drawing's file name and the
 * zero-based page index. Inside a project the name is then scoped by
 * SheetScope (`p12:{document}#{page}`).
 *
 * Derived from the file name rather than a random id so it is STABLE ACROSS
 * RELOADS and across devices: everyone who opens `A-101.pdf` in a project is
 * looking at the same sheets, and finds the same markups on them.
 *
 * In the domain, not the interface, because the domain needs to read one back:
 * a returned working copy names the drawing it came from in the sheet ids of
 * its markups (see WorkingCopyService).
 */

/**
 * @param {string} documentName The drawing's file name.
 * @param {number} pageIndex Zero-based.
 * @returns {string}
 */
export function sheetIdFor(documentName, pageIndex) {
  return `${documentName}#${pageIndex}`;
}

/**
 * The drawing a sheet belongs to, whatever project it is scoped to — or null
 * when the id is not one this naming produced. A file name may itself contain
 * `#`, so only the final `#{digits}` is the page.
 *
 * @param {string} sheetId
 * @returns {string|null}
 */
export function documentNameOf(sheetId) {
  if (typeof sheetId !== 'string') return null;
  const match = /^(.+)#\d+$/.exec(SheetScope.localIdOf(sheetId));
  return match ? match[1] : null;
}
