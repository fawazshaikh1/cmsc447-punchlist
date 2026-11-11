import { documentNameOf } from '../documents/sheetNames';

/**
 * The name of the project's own sheet for tasks that are on no drawing
 * (spec 6.4). A drawing can never be called this: drawing names are PDF file
 * names, and a sheet id is this name, a '#' and a page — so `~tasks#0` is
 * unmistakable wherever it travels.
 */
export const OFF_SHEET_DOCUMENT = '~tasks';

/**
 * Whether a sheet id is the project's tasks sheet rather than a page of a
 * drawing.
 *
 * @param {string} sheetId
 * @returns {boolean}
 */
export function isOffSheet(sheetId) {
  return documentNameOf(sheetId) === OFF_SHEET_DOCUMENT;
}
