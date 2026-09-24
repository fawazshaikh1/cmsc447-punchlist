/**
 * Numbers every markup in a document, counting each kind separately.
 *
 * ===========================================================================
 * THE BUG THIS FIXES — "Punch item 2" was not the second punch item
 * ===========================================================================
 * The exporters numbered a pin by its position in the sheet's annotation list,
 * which contains every markup regardless of type. So a sheet holding
 *
 *     a box, a cloud, a photo, a pin
 *
 * exported that pin as "Punch item 4". Draw a box first and the very first
 * punch item on the job is number 2. Delete the box and it silently becomes
 * number 1 — the same item, renumbered, on a document someone has already
 * printed and walked the site with.
 *
 * Counting per kind gives a pin a number that means "the nth punch item", which
 * is the only thing a number on a punch list can usefully mean.
 *
 * ---------------------------------------------------------------------------
 * WHY DOCUMENT-WIDE AND NOT PER SHEET
 * ---------------------------------------------------------------------------
 * Per sheet, a 4-sheet set has four different items called "1". The schedule
 * would need the sheet to disambiguate every reference, and so would everyone
 * talking about it: "one on sheet three" rather than "seventeen". Numbering
 * across the set is how a punch list is written on paper, and the schedule
 * still prints the sheet alongside.
 *
 * ---------------------------------------------------------------------------
 * WHY A MAP KEYED BY THE ANNOTATION
 * ---------------------------------------------------------------------------
 * The number has to reach two places that never meet: the writer that draws the
 * pin, and the builder that writes the schedule row. Keying by identity means
 * neither has to recompute it — and so they cannot disagree, which is the one
 * failure that would make the schedule point at the wrong mark.
 *
 * Annotations are frozen and immutable, so identity is stable for the length of
 * an export. It is NOT stable across edits, which is why this is computed per
 * export and never stored.
 *
 * @param {{ pageIndex: number, annotations: import('../annotations/Annotation').Annotation[] }[]} pages
 *        In page order. Order determines the numbering, so a caller that sorts
 *        differently gets a different — but still self-consistent — result.
 * @returns {Map<import('../annotations/Annotation').Annotation, number>}
 */
export function assignOrdinals(pages) {
  const runningByKind = new Map();
  const ordinals = new Map();

  for (const { annotations } of pages) {
    for (const annotation of annotations) {
      const kind = annotation.getKind();
      const next = (runningByKind.get(kind) ?? 0) + 1;
      runningByKind.set(kind, next);
      ordinals.set(annotation, next);
    }
  }

  return ordinals;
}
