import { assignOrdinals } from './ordinals';

/**
 * The numbers a sheet's markups carry on screen — the numbers the punch list
 * and the issued PDF give them.
 *
 * ===========================================================================
 * THE BUG THIS FIXES — pin "5" on the sheet was item 4 everywhere else
 * ===========================================================================
 * The sheet numbered a pin by its position among EVERY markup on the sheet, so
 * an arrow drawn after the first pin made the second pin "3", while the punch
 * list and the issued schedule — numbering pins only, through assignOrdinals —
 * called it 2. A sheet after the first also started again at 1, where the list
 * carries on from the sheets before it. Someone reading "item 4" off the list
 * looked for a pin labelled 4 and found a different one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CALLS assignOrdinals RATHER THAN COUNTING ITSELF
 * ---------------------------------------------------------------------------
 * Numbering is per kind, across the drawing, in sheet order. Counting the
 * earlier sheets' markups first and then this sheet's is exactly that walk,
 * cut down to the one sheet on screen — so the three places a number appears
 * (the pin, the list, the schedule) come from one function and cannot drift.
 *
 * Only HOW MANY of each kind the earlier sheets hold matters, not their order,
 * which is why `earlier` may arrive in any order and from any source.
 *
 * @param {import('../annotations/Annotation').Annotation[]} annotations
 *        This sheet's markups, in the order the sheet lists them.
 * @param {import('../annotations/Annotation').Annotation[]} [earlier]
 *        Every markup on the drawing's earlier sheets. Empty on the first
 *        sheet, and until the earlier sheets have been read.
 * @returns {Map<import('../annotations/Annotation').Annotation, number>}
 */
export function ordinalsOnSheet(annotations, earlier = []) {
  const numbered = assignOrdinals([
    { pageIndex: -1, annotations: earlier },
    { pageIndex: 0, annotations },
  ]);
  return new Map(annotations.map((annotation) => [annotation, numbered.get(annotation)]));
}
