import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * @typedef {object} DraftRequest
 * @property {string} id        Pre-generated id, so the draft is stable while
 *                              it is being dragged and keeps that id once saved.
 * @property {string} sheetId
 * @property {import('../geometry/PdfPoint').PdfPoint} point
 *           ALREADY converted to PDF user space by AnnotationService.
 * @property {import('../annotations/MarkupStyle').MarkupStyle} style
 * @property {string} [text]    Supplied by instant tools that need user input.
 */

/**
 * CONTRACT — turns a pointer gesture into an annotation.
 *
 * ===========================================================================
 * WHY TOOLS ARE THEIR OWN ABSTRACTION
 * ===========================================================================
 * The annotation model answers "what is a rectangle". The marker components
 * answer "how is a rectangle drawn". Neither answers "what sequence of pointer
 * events produces one" — and that varies far more than either:
 *
 *   Pin        one tap
 *   Rectangle  press, drag, release
 *   Ink        press, sample continuously, release
 *   Text       one tap plus typed input
 *
 * Without this abstraction that variation collapses into a growing conditional
 * inside the pointer handler — the third place a new markup type would force an
 * edit to existing code, after the deserialiser and the renderer. With it, an
 * interaction is a class, and adding one changes nothing that already works.
 *
 * ---------------------------------------------------------------------------
 * THE LIFECYCLE, AND WHERE THE COORDINATE CONVERSION HAPPENS
 * ---------------------------------------------------------------------------
 *   pointer down  -> AnnotationService.beginDraft()  -> tool.createDraft()
 *   pointer move  -> AnnotationService.updateDraft() -> tool.extendDraft()
 *   pointer up    -> AnnotationService.commitDraft() -> tool.finalize()
 *
 * Every `point` a tool receives is ALREADY a PdfPoint. AnnotationService does
 * the screen -> document conversion before calling in, exactly as it does for
 * `placePin`. Tools therefore never see a ViewportPoint and cannot get the
 * conversion wrong — the rule stays in one file no matter how many tools exist.
 *
 * A draft is a real, fully-valid Annotation instance. It is simply not
 * persisted until `commitDraft`, which means the live drag preview renders
 * through the same marker component as the finished markup, and what the user
 * sees while dragging is exactly what they get.
 */
export class AnnotationTool {
  static REQUIRED = ['getId', 'getLabel', 'createDraft', 'extendDraft'];

  constructor() {
    enforceContract(this, new.target, AnnotationTool);
  }

  /** @returns {string} Stable identifier, e.g. 'rectangle'. Used by ToolRegistry. */
  getId() {
    return abstractMethod('AnnotationTool', 'getId');
  }

  /** @returns {string} Human label for the tool palette. */
  getLabel() {
    return abstractMethod('AnnotationTool', 'getLabel');
  }

  /**
   * True for tools that complete on a single press with no drag (Pin, Text).
   *
   * The pointer handler uses this to skip the move/commit phases entirely,
   * which matters on a tablet: a tap always carries a pixel or two of finger
   * movement, and treating that as a drag would make every pin placement a
   * degenerate zero-size gesture.
   *
   * @returns {boolean}
   */
  isInstant() {
    return false;
  }

  /**
   * Does this tool need text typed before it can create anything?
   * The presentation layer prompts, then passes the result in `request.text`.
   * @returns {boolean}
   */
  requiresText() {
    return false;
  }

  /**
   * True for a tool that manipulates EXISTING annotations rather than creating
   * new ones — currently only SelectTool.
   *
   * The pointer handler branches on this to choose between the draw path and
   * the hit-test-and-drag path. It is a capability flag rather than a type
   * check, so a future "erase" or "measure" tool can opt in without the layer
   * learning any new tool names.
   *
   * @returns {boolean}
   */
  isSelection() {
    return false;
  }

  /**
   * @param {DraftRequest} request
   * @returns {import('../annotations/Annotation').Annotation}
   */
  createDraft(request) {
    return abstractMethod('AnnotationTool', 'createDraft', request);
  }

  /**
   * Produces an updated draft as the pointer moves. Returns a NEW annotation
   * rather than mutating, matching the immutability of the model.
   *
   * @param {import('../annotations/Annotation').Annotation} draft
   * @param {import('../geometry/PdfPoint').PdfPoint} point
   * @returns {import('../annotations/Annotation').Annotation}
   */
  extendDraft(draft, point) {
    return abstractMethod('AnnotationTool', 'extendDraft', draft, point);
  }

  /**
   * Last chance to accept or reject the gesture.
   *
   * The default discards anything the annotation itself reports as degenerate —
   * a stray tap that produced a zero-size rectangle, a two-point "stroke".
   * Storing those would litter the sheet with invisible artefacts that show up
   * in the punch-item count and in the export but cannot be seen or selected.
   *
   * Override for a tool whose validity rule is different.
   *
   * @param {import('../annotations/Annotation').Annotation} draft
   * @returns {import('../annotations/Annotation').Annotation | null} null to discard.
   */
  finalize(draft) {
    if (typeof draft.isDegenerate === 'function' && draft.isDegenerate()) return null;
    return draft;
  }
}
