import { EditDecision } from './EditDecision';
import { EditPolicy } from './EditPolicy';

/**
 * Refuses any change to a markup that has already been issued in a flattened
 * export.
 *
 * ===========================================================================
 * WHAT "SEALED" MEANS AND WHY IT IS NOT A FLAG
 * ===========================================================================
 * A flattened export paints the markups into the page itself. Once that file
 * has been sent to an architect or a client, the marks in it are a matter of
 * record: someone outside this system is holding a document that says a defect
 * was at a particular place on a particular sheet.
 *
 * Letting the app quietly change its copy afterwards would mean the two
 * disagree, with no way to tell which is right. So the moment a markup leaves
 * in a flattened export, it stops being editable here.
 *
 * Note that "sealed" is not stored ON the annotation. It is DERIVED from the
 * export history: an annotation is sealed if it appears in a completed
 * flattened export. Two things follow from that choice:
 *
 *   - The annotation model did not have to change at all. No new field on the
 *     base class, no edit to any of the six markup types.
 *   - The seal is backed by a record of a real event — who exported what, and
 *     when — which is the audit trail the stakeholder asked for, rather than a
 *     boolean somebody could flip.
 *
 * The sealed set is injected as a plain function rather than a repository, so
 * this policy stays synchronous. `check` is called on every render of the
 * properties panel and must not await anything.
 */
export class SealedByExportPolicy extends EditPolicy {
  /**
   * @param {() => Set<string>} getSealedIds Returns the ids sealed on the sheet
   *        currently being edited. Read fresh on every check so that an export
   *        completed moments ago takes effect immediately.
   */
  constructor(getSealedIds) {
    super();
    this.getSealedIds = getSealedIds;
  }

  /**
   * @param {import('./EditPolicy').EditRequest} request
   * @returns {EditDecision}
   */
  check({ annotation }) {
    if (!annotation?.id) return EditDecision.allow();

    if (!this.getSealedIds().has(annotation.id)) return EditDecision.allow();

    return EditDecision.deny(
      'This markup was included in a flattened PDF that has already been ' +
        'issued, so it is now part of the permanent record and cannot be ' +
        'changed. Add a new markup instead.',
      'sealed',
    );
  }
}
