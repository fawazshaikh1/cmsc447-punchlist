import { PageGeometry } from '../geometry/PageGeometry';
import { ViewportPoint } from '../geometry/ViewportPoint';
import { CoordinateTransformer } from '../geometry/CoordinateTransformer';
import { AnnotationRepository } from '../ports/AnnotationRepository';
import { IdGenerator } from '../ports/IdGenerator';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';

/**
 * @typedef {object} PlacementContext
 * @property {string} sheetId
 * @property {PageGeometry} geometry
 * @property {CoordinateTransformer} transformer
 *           MUST be the transformer for the CURRENT scale and rotation.
 * @property {import('../annotations/MarkupStyle').MarkupStyle} [style]
 *           Stroke colour and weight for markup tools. Ignored by PinTool.
 */

/**
 * ===========================================================================
 * TIER 2 — QUERIES AND THE DRAFT LIFECYCLE
 * ===========================================================================
 * Owns two things:
 *
 *   1. Reading a sheet's annotations.
 *   2. Turning a pointer gesture into a fully-formed annotation, via the
 *      active tool — the ONLY place screen coordinates become PDF coordinates.
 *
 * It deliberately does NOT persist anything. Every write in the application
 * goes through `EditorService`, so that every change is a reversible Command
 * and undo is correct by construction rather than by remembering to use it.
 * If this class could also save, someone would eventually call it and produce
 * a change the undo button silently cannot reverse.
 *
 * It knows nothing about React and nothing about pdf.js — only the contracts it
 * is handed. The whole draft lifecycle is therefore unit-testable with a
 * ten-line fake transformer, in Node, with no browser and no PDF fixture.
 */
export class AnnotationService {
  /**
   * @param {AnnotationRepository} repository Read-only use here.
   * @param {IdGenerator} ids
   */
  constructor(repository, ids) {
    // Constructor-injected dependencies, validated on the way in. Because
    // everything is wired in one composition root, a mis-wiring throws at
    // application startup naming the expected contract — not three screens deep
    // as `undefined is not a function`.
    assertInstanceOf(repository, AnnotationRepository, 'repository');
    assertInstanceOf(ids, IdGenerator, 'ids');

    this.repository = repository;
    this.ids = ids;
  }

  /**
   * Every annotation on a sheet, for the overlay to draw.
   * @param {string} sheetId
   * @returns {Promise<import('../annotations/Annotation').Annotation[]>}
   */
  async listForSheet(sheetId) {
    return this.repository.listBySheet(sheetId);
  }

  // =========================================================================
  // DRAFT LIFECYCLE
  // =========================================================================
  // These three methods are the only place a pointer gesture becomes an
  // annotation, for all seven tools. Each converts screen -> PDF user space
  // before handing the point to the tool, so a tool never sees a ViewportPoint
  // and cannot get the conversion wrong. Adding an eighth tool adds no new
  // conversion code and no new opportunity to misplace a markup.

  /**
   * Pointer down: create the draft. Nothing is persisted.
   *
   * @param {import('../tools/AnnotationTool').AnnotationTool} tool
   * @param {PlacementContext} context
   * @param {ViewportPoint} at
   * @param {{ text?: string }} [extras] Input a tool declared it needs.
   * @returns {import('../annotations/Annotation').Annotation}
   */
  beginDraft(tool, context, at, extras = {}) {
    assertInstanceOf(at, ViewportPoint, 'gesture start', COORDINATE_SPACE_HINT);
    assertInstanceOf(context.geometry, PageGeometry, 'context.geometry');
    assertInstanceOf(context.transformer, CoordinateTransformer, 'context.transformer');

    return tool.createDraft({
      id: this.ids.next(),
      sheetId: context.sheetId,
      point: this.toClampedPdfPoint(context, at),
      style: context.style,
      ...extras,
    });
  }

  /**
   * Pointer move: extend the draft.
   *
   * May return the SAME instance when the tool judged the movement not worth
   * recording (see InkTool's distance filter). Preserving that identity keeps
   * React from repainting the overlay on every discarded sample.
   *
   * @returns {import('../annotations/Annotation').Annotation}
   */
  updateDraft(tool, context, draft, at) {
    assertInstanceOf(at, ViewportPoint, 'gesture point', COORDINATE_SPACE_HINT);
    return tool.extendDraft(draft, this.toClampedPdfPoint(context, at));
  }

  /**
   * Pointer up: let the tool accept or reject the gesture.
   *
   * Returns the annotation to persist, or null when the gesture was an
   * accidental tap. **Persisting it is the caller's job, via EditorService** —
   * that is what makes it undoable.
   *
   * @returns {import('../annotations/Annotation').Annotation | null}
   */
  finalizeDraft(tool, draft) {
    return tool.finalize(draft);
  }

  /**
   * Screen -> document, clamped to the page box.
   *
   * Public because the drag-to-move interaction needs the same conversion, and
   * duplicating it there would reintroduce exactly the inconsistency this
   * class exists to prevent. The ordering — convert first, then clamp, never
   * the reverse — is written once, here.
   *
   * @param {PlacementContext} context
   * @param {ViewportPoint} at
   * @returns {import('../geometry/PdfPoint').PdfPoint}
   */
  toClampedPdfPoint(context, at) {
    assertInstanceOf(at, ViewportPoint, 'point', COORDINATE_SPACE_HINT);
    return context.geometry.clamp(context.transformer.toPdfPoint(at));
  }
}
