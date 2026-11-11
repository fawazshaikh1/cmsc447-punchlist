/**
 * @typedef {{ documentName: string, pageIndex: number, number: string, title: string }} SheetEntry
 */

/**
 * Finds sheets by number or title (SRS 4.9.7) — "a201", "A 201" and "A-201"
 * all find A-201, because nobody on a site types the hyphen the same way
 * twice. Words also find a title: "elevations" finds EXTERIOR ELEVATIONS.
 *
 * An exact number comes first, then numbers that start with what was typed,
 * then the rest, each in drawing and page order.
 *
 * @param {SheetEntry[]} sheets
 * @param {string} query
 * @returns {SheetEntry[]}
 */
export function searchSheets(sheets, query) {
  const wanted = squash(query);
  if (!wanted) return [];
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);

  const rank = (sheet) => {
    const number = squash(sheet.number);
    if (number === wanted) return 0;
    if (number.startsWith(wanted)) return 1;
    return 2;
  };
  const matches = (sheet) =>
    (sheet.number && squash(sheet.number).includes(wanted)) ||
    // Words find a title; the number is matched squashed, above, so "A 201"
    // is not also every sheet whose title has an "a" in it.
    (Boolean(sheet.title) && words.every((word) => sheet.title.toLowerCase().includes(word)));

  return sheets
    .filter(matches)
    .sort((a, b) => rank(a) - rank(b) || a.documentName.localeCompare(b.documentName) || a.pageIndex - b.pageIndex);
}

/** Letters and digits only, lower case: "A-201" and "a 201" are both "a201". */
function squash(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
