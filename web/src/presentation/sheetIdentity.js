/**
 * The id of one sheet: which file, which page.
 *
 * Derived from the file name and page index rather than a random id so it is
 * STABLE ACROSS RELOADS — which is what lets local storage hand the markups
 * back after F5. In Sprint 2 this becomes the sheet's real database id.
 *
 * One function rather than a template string in each caller, because two
 * places now need it and must agree exactly: the app shell, to look up a
 * sheet's markups, and opening a file, to restore a working copy's markups
 * onto the sheets they will be looked up under.
 *
 * @param {string} fileName
 * @param {number} pageIndex
 * @returns {string}
 */
export function sheetIdFor(fileName, pageIndex) {
  return `${fileName}#${pageIndex}`;
}
