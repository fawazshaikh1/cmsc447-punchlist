/**
 * @typedef {object} RevisionFacts
 * @property {number} revision 1 for an original set, 2 for its first revision…
 * @property {import('../library/LibraryDrawing').LibraryDrawing|null} replaces
 * @property {import('../library/LibraryDrawing').LibraryDrawing|null} replacedBy
 * @property {boolean} isCurrent Nothing replaces it — the set to work from
 *           (FR-10.5: the library says which set is current).
 */

/**
 * What the library says about each drawing's place in its set's history.
 *
 * @param {import('../library/LibraryDrawing').LibraryDrawing[]} drawings
 * @param {import('./RevisionLink').RevisionLink[]} links
 * @returns {Map<number, RevisionFacts>} By drawing id.
 */
export function describeRevisions(drawings, links) {
  const byId = new Map(drawings.map((drawing) => [drawing.id, drawing]));
  const previousOf = new Map(links.map((link) => [link.documentId, link.revisionOf]));
  const nextOf = new Map(links.map((link) => [link.revisionOf, link.documentId]));

  const facts = new Map();
  for (const drawing of drawings) {
    let revision = 1;
    // Bounded, so a malformed history can never hang the library.
    for (let at = drawing.id, steps = 0; previousOf.has(at) && steps < drawings.length; steps++) {
      at = previousOf.get(at);
      revision += 1;
    }
    const replacedBy = byId.get(nextOf.get(drawing.id)) ?? null;
    facts.set(drawing.id, {
      revision,
      replaces: byId.get(previousOf.get(drawing.id)) ?? null,
      replacedBy,
      isCurrent: replacedBy === null,
    });
  }
  return facts;
}
