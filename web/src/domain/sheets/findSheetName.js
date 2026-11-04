/**
 * Reads a sheet's number and title from the text on the page.
 *
 * ===========================================================================
 * HOW A TITLE BLOCK IS READ
 * ===========================================================================
 * Most title blocks LABEL their fields: a small "SHEET NUMBER" with "A-101"
 * under it in large type, a "SHEET TITLE" with "LEVEL 1 FLOOR PLAN" under it.
 * Where the labels are there, the value is whatever sits nearest below or
 * beside the label. That is the reliable reading and it is tried first.
 *
 * Where there are no labels, the sheet number is still the largest thing on
 * the page that looks like a sheet number — a discipline letter or two and a
 * number: A-101, S-2.01, FP-101, M1.1 — in the bottom-right corner, where a
 * title block sits on nearly every drawing set.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MUST NOT BE FOOLED BY
 * ---------------------------------------------------------------------------
 * A plan is covered in text that is almost a sheet number: grid bubbles (A,
 * 6), room numbers (101), dimensions (23'-4"), dates, and notes that NAME
 * other sheets ("SEE A-501"). The pattern needs a letter AND digits and must
 * match the whole piece of text, which rules out the first four; looking only
 * in the title block's corner rules out the last.
 *
 * A wrong reading is not a disaster — an admin can rename a sheet — but a
 * missing one is better than a wrong one, so where nothing fits the page keeps
 * its "Sheet N".
 *
 * Pure: text in, name out. Turning a PDF page into these items is the
 * infrastructure tier's job (see infrastructure/pdf/sheetTextItems).
 *
 * @typedef {object} TextItem
 * @property {string} text
 * @property {number} x    Left edge, page units, from the page's left.
 * @property {number} y    Top edge, page units, from the page's TOP — as the
 *                         page is seen, so a rotated sheet reads the same.
 * @property {number} size Height of the text.
 */

const DESIGNATOR = /^[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/;
const NUMBER_LABEL = /^(SHEET|DWG|DRAWING)\.?\s*(NO\.?|NUMBER|#)$/i;
const TITLE_LABEL = /^(SHEET|DRAWING)\s+TITLE$/i;

/**
 * @param {TextItem[]} items
 * @param {{ width: number, height: number }} page
 * @returns {{ number: string, title: string } | null}
 */
export function findSheetName(items, page) {
  const clean = items
    .map((item) => ({ ...item, text: String(item.text ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.text.length > 0);

  const isLabel = (item) => NUMBER_LABEL.test(item.text) || TITLE_LABEL.test(item.text);
  const isDesignator = (item) => DESIGNATOR.test(item.text);

  // 2. A labelled number.
  let number = null;
  const numberLabel = clean.find((item) => NUMBER_LABEL.test(item.text));
  if (numberLabel) number = nearestTo(numberLabel, clean.filter(isDesignator));

  // 3. A labelled title, with the rest of its line.
  let title = null;
  const titleLabel = clean.find((item) => TITLE_LABEL.test(item.text));
  if (titleLabel) {
    const value = nearestTo(titleLabel, clean.filter((item) => !isLabel(item) && !isDesignator(item)));
    if (value) title = lineOf(value, clean.filter((item) => !isLabel(item) && !isDesignator(item)));
  }

  const inCorner = (item) => item.x >= (page.width * 2) / 3 && item.y >= (page.height * 2) / 3;

  // 4. An unlabelled number: the largest designator in the bottom-right third.
  if (!number) {
    number =
      clean
        .filter((item) => isDesignator(item) && inCorner(item))
        .sort((a, b) => b.size - a.size || b.y - a.y || b.x - a.x)[0] ?? null;
  }

  if (!number) return null;

  // 5. An unlabelled title: the largest capitalised line near the number.
  if (!title) {
    const candidate = clean
      .filter(
        (item) =>
          inCorner(item) &&
          !isLabel(item) &&
          !isDesignator(item) &&
          /[A-Z]/i.test(item.text) &&
          item.text === item.text.toUpperCase() &&
          item.text.length >= 4 &&
          Math.abs(item.y - number.y) <= number.size * 6,
      )
      .sort((a, b) => b.size - a.size || Math.abs(a.y - number.y) - Math.abs(b.y - number.y))[0];
    if (candidate) title = candidate.text;
  }

  return { number: number.text, title: title ?? '' };
}

/**
 * The candidate nearest a label, among those below it (within a column a few
 * dozen label-heights wide) or on its line to its right. Nearest by how far
 * down, then how far across.
 */
function nearestTo(label, candidates) {
  return (
    candidates
      .filter((item) => item !== label)
      .filter(
        (item) =>
          (item.y > label.y && Math.abs(item.x - label.x) <= label.size * 40) ||
          (Math.abs(item.y - label.y) <= label.size && item.x > label.x),
      )
      .sort((a, b) => a.y - label.y - (b.y - label.y) || a.x - label.x - (b.x - label.x))[0] ?? null
  );
}

/** A value and whatever else sits on its line, left to right. */
function lineOf(value, candidates) {
  return candidates
    .filter((item) => Math.abs(item.y - value.y) <= value.size / 2)
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join(' ');
}
