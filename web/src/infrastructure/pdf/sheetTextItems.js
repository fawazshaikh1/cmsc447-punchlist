/**
 * pdf.js text items, as positions on the page as it is SEEN.
 *
 * pdf.js reports each piece of text with a transform in PDF user space —
 * origin at the bottom left, y going up, and on a page with /Rotate set, the
 * page's unrotated axes. `findSheetName` wants the page as a person sees it:
 * origin at the top left, y going down, rotation applied. The page's viewport
 * transform is exactly that conversion, so each item's transform is put
 * through it.
 *
 * Pure, and free of pdf.js itself, so the conversion is checked without a
 * browser or a worker.
 *
 * @param {{ str: string, transform: number[] }[]} items From getTextContent().
 * @param {number[]} viewportTransform `page.getViewport({ scale: 1 }).transform`.
 * @returns {import('../../domain/sheets/findSheetName').TextItem[]}
 */
export function toSheetTextItems(items, viewportTransform) {
  return items
    .filter((item) => typeof item?.str === 'string' && Array.isArray(item.transform))
    .map((item) => {
      const m = multiply(viewportTransform, item.transform);
      const size = Math.hypot(m[2], m[3]);
      // m[4], m[5] is the text's baseline origin on the seen page; its top is
      // one text-height above the baseline.
      return { text: item.str, x: m[4], y: m[5] - size, size };
    });
}

/** PDF matrix product a × b, as pdf.js's Util.transform computes it. */
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
