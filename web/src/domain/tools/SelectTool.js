import { AnnotationTool } from './AnnotationTool';

/**
 * Selects and drags existing markups instead of creating new ones.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS STILL AN AnnotationTool
 * ---------------------------------------------------------------------------
 * It belongs in the palette next to the drawing tools, because from the user's
 * point of view it is the same kind of thing: a mode the pointer is in. Keeping
 * it in `ToolRegistry` means the palette needs no special case and no separate
 * "mode" concept living alongside the tool concept.
 *
 * The cost is one honest exception to the contract: `createDraft` and
 * `extendDraft` are never called for this tool, because `isSelection()` tells
 * the pointer handler to take the move path instead. They are implemented as
 * throwing stubs rather than silent no-ops, so that if the branch is ever
 * removed the failure is immediate and obvious rather than a tool that
 * mysteriously creates nothing.
 *
 * The alternative — a separate `EditTool` hierarchy — would have meant two
 * registries, two palette code paths and a mode flag threaded through the
 * layer, to avoid one clearly-documented branch on a capability flag. Not
 * worth it.
 */
export class SelectTool extends AnnotationTool {
  getId() {
    return 'select';
  }

  getLabel() {
    return 'Select';
  }

  /**
   * Tells the pointer handler to hit-test and drag rather than draw.
   * The one capability flag the layer branches on.
   * @returns {boolean}
   */
  isSelection() {
    return true;
  }

  createDraft() {
    throw new Error(
      'SelectTool.createDraft should never be called — the pointer handler must ' +
        'check isSelection() and take the move path instead.',
    );
  }

  extendDraft() {
    throw new Error('SelectTool.extendDraft should never be called. See createDraft.');
  }
}
