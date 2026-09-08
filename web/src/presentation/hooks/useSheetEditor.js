import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MarkupStyle } from '../../domain/annotations';
import { ToolRegistry } from '../../domain/tools';
import { useServices } from '../ServiceContainer';

/**
 * The editing session for one sheet: annotations, tool, selection, in-progress
 * gesture, and undo/redo.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE ONE HOOK AND NOT FOUR
 * ---------------------------------------------------------------------------
 * They were separate, and it was wrong. Every one of them has to react to the
 * others: committing a gesture changes the list, undo changes the list AND the
 * valid selection, deleting changes both, and switching sheets resets all four.
 * Split across hooks, that coordination becomes a web of callbacks passed
 * between them — the classic sign that the seam was cut in the wrong place.
 *
 * One hook owns the session. The pieces that genuinely do NOT interact — which
 * document is loaded, and how it is being looked at — stay in their own hooks
 * (`useSheetDocument`, `useViewState`), because a zoom must not re-run
 * annotation loading and a new pin must not re-render the canvas.
 *
 * This hook still contains no coordinate maths and no branch on annotation
 * type. Conversion is `AnnotationService`'s job, persistence is
 * `EditorService`'s, and shaping is the tool's.
 */
export function useSheetEditor({ sheetId, page, scale, rotation }) {
  const { annotations: reader, editor } = useServices();

  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [toolId, setToolId] = useState(() => ToolRegistry.default().getId());
  const [style, setStyle] = useState(() => new MarkupStyle());
  const [draft, setDraft] = useState(null);
  const [moving, setMoving] = useState(null);
  const [error, setError] = useState(null);
  // Bumped after every command so undo/redo button state re-reads from history.
  const [revision, setRevision] = useState(0);

  // Gesture state lives in refs as well as state. Several pointermove events
  // can fire before React commits a render, and a stale closure would then
  // extend an out-of-date draft — producing a stroke that loses points or a
  // box that snaps back mid-drag.
  const draftRef = useRef(null);
  const movingRef = useRef(null);

  const tool = ToolRegistry.resolve(toolId) ?? ToolRegistry.default();

  const context = useMemo(
    () => ({
      sheetId,
      geometry: page.getGeometry(),
      transformer: page.createTransformer(scale, rotation),
      style,
    }),
    [sheetId, page, scale, rotation, style],
  );

  // --- loading ------------------------------------------------------------

  const reload = useCallback(async () => {
    if (!sheetId) {
      setItems([]);
      return;
    }
    try {
      const loaded = await reader.listForSheet(sheetId);
      setItems(loaded);
      setError(null);
      // Drop a selection whose annotation no longer exists — after an undo of
      // an add, or a delete. Leaving it would show a properties panel for
      // something that is not on the sheet.
      setSelectedId((current) =>
        current && loaded.some((a) => a.id === current) ? current : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [reader, sheetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs a mutation, then re-reads so the screen always matches storage. */
  const run = useCallback(
    async (mutate) => {
      try {
        await mutate();
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      setRevision((n) => n + 1);
      await reload();
    },
    [reload],
  );

  // --- gestures -----------------------------------------------------------

  const setDraftBoth = useCallback((value) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  const setMovingBoth = useCallback((value) => {
    movingRef.current = value;
    setMoving(value);
  }, []);

  /**
   * Pointer down.
   * @param {import('../../domain/geometry/ViewportPoint').ViewportPoint} at
   * @param {string|null} hitId Annotation under the pointer, from the layer's
   *        hit test. The layer does the hit test because only it knows the DOM.
   */
  const begin = useCallback(
    (at, hitId) => {
      if (tool.isSelection()) {
        setSelectedId(hitId);
        if (!hitId) return;

        const target = items.find((a) => a.id === hitId);
        if (!target) return;

        // Record where the drag started, in PDF points, so the delta can be
        // computed in the same space the annotation is stored in.
        setMovingBoth({
          original: target,
          preview: target,
          from: reader.toClampedPdfPoint(context, at),
        });
        return;
      }

      const extras = {};
      if (tool.requiresText()) {
        // Placeholder input. Crude and unstyleable, but it works on desktop and
        // iPad. Replacing it with an inline editor changes this block alone —
        // the tool only ever receives `extras.text`.
        const entered = window.prompt('Callout text:');
        if (entered === null || entered.trim() === '') return;
        extras.text = entered.trim();
      }

      const created = reader.beginDraft(tool, context, at, extras);

      if (tool.isInstant()) {
        // A tap on a tablet always carries a pixel or two of movement. Instant
        // tools skip the drag phase so that jitter never turns a pin into a
        // discarded degenerate gesture.
        setDraftBoth(null);
        void run(async () => {
          const finalized = reader.finalizeDraft(tool, created);
          if (finalized) await editor.add(finalized);
        });
        return;
      }

      setDraftBoth(created);
    },
    [tool, items, reader, editor, context, run, setDraftBoth, setMovingBoth],
  );

  /** Pointer move. */
  const extend = useCallback(
    (at) => {
      const drag = movingRef.current;
      if (drag) {
        const to = reader.toClampedPdfPoint(context, at);
        setMovingBoth({
          ...drag,
          preview: drag.original.movedBy(to.x - drag.from.x, to.y - drag.from.y),
        });
        return;
      }

      const current = draftRef.current;
      if (!current) return;

      const next = reader.updateDraft(tool, context, current, at);
      // The tool may return the same instance when it judged the movement too
      // small to record. Skipping the write keeps React from repainting on
      // every discarded sample.
      if (next !== current) setDraftBoth(next);
    },
    [reader, tool, context, setDraftBoth, setMovingBoth],
  );

  /** Pointer up. @returns {boolean} true if a move actually happened. */
  const finish = useCallback(() => {
    const drag = movingRef.current;
    if (drag) {
      setMovingBoth(null);
      const moved = drag.preview !== drag.original;
      if (moved) {
        const dx = drag.preview.getAnchor().x - drag.original.getAnchor().x;
        const dy = drag.preview.getAnchor().y - drag.original.getAnchor().y;
        void run(() => editor.move(drag.original, dx, dy));
      }
      return moved;
    }

    const current = draftRef.current;
    if (!current) return false;

    setDraftBoth(null);
    void run(async () => {
      const finalized = reader.finalizeDraft(tool, current);
      if (finalized) await editor.add(finalized);
    });
    return false;
  }, [reader, editor, tool, run, setDraftBoth, setMovingBoth]);

  const cancel = useCallback(() => {
    setDraftBoth(null);
    setMovingBoth(null);
  }, [setDraftBoth, setMovingBoth]);

  // --- editing ------------------------------------------------------------

  const selected = items.find((a) => a.id === selectedId) ?? null;

  const update = useCallback(
    (previous, next, label) => run(() => editor.update(previous, next, label)),
    [editor, run],
  );

  const remove = useCallback(
    (annotation) => run(() => editor.remove(annotation)),
    [editor, run],
  );

  const clearSheet = useCallback(
    () => run(() => editor.clearSheet(sheetId)),
    [editor, run, sheetId],
  );

  const undo = useCallback(() => run(() => editor.undo()), [editor, run]);
  const redo = useCallback(() => run(() => editor.redo()), [editor, run]);

  // What the overlay should draw: the saved list, with the annotation being
  // dragged swapped for its live preview, plus any in-progress draft.
  const visible = useMemo(() => {
    const base = moving
      ? items.map((a) => (a.id === moving.original.id ? moving.preview : a))
      : items;
    return draft ? [...base, draft] : base;
  }, [items, moving, draft]);

  return {
    annotations: items,
    visible,
    error,
    selected,
    selectedId,
    select: setSelectedId,

    tool,
    toolId,
    selectTool: setToolId,
    style,
    setStyle,

    begin,
    extend,
    finish,
    cancel,
    isDragging: moving !== null,

    update,
    remove,
    clearSheet,

    undo,
    redo,
    // `revision` is in the dependency list so these re-evaluate after a command.
    canUndo: useMemo(() => editor.canUndo(), [editor, revision]),
    canRedo: useMemo(() => editor.canRedo(), [editor, revision]),
    undoLabel: useMemo(() => editor.peekUndo(), [editor, revision]),
    redoLabel: useMemo(() => editor.peekRedo(), [editor, revision]),
  };
}
