import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { MarkupStyle } from '../../domain/annotations';
import { ToolRegistry } from '../../domain/tools';
import { useServices } from '../ServiceContainer';

/**
 * Last-resort text collection, used only if no `promptForText` is supplied.
 *
 * Present so the hook still works in a test or a harness that has not wired a
 * dialog. The application always passes the real one — see PromptDialog for why
 * `window.prompt` is not good enough for a required field.
 */
const fallbackPrompt = async ({ title }) => {
  const entered = window.prompt(title);
  return entered === null || entered.trim() === '' ? null : entered.trim();
};

/**
 * The editing session for one sheet: annotations, tool, selection, in-progress
 * gesture, undo/redo, which markups have been issued, what is still missing
 * from them, and who last touched each one.
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
 * The pieces that genuinely do NOT interact — which document is loaded, and how
 * it is being looked at — stay in their own hooks, because a zoom must not
 * re-run annotation loading and a new pin must not re-render the canvas.
 *
 * This hook contains no coordinate maths and no branch on annotation type. It
 * likewise does not decide what may be edited or what counts as finished — it
 * asks `EditorService` and passes the answers on.
 *
 * @param {object} options
 * @param {(request: object) => Promise<import('../../domain/media/MediaRef').MediaRef|null>} [options.capturePhoto]
 *        How to obtain an image a tool has declared it needs. Same seam as
 *        `promptForText`: the hook never opens a camera, it asks.
 * @param {(request: object) => Promise<string|null>} [options.promptForText]
 *        How to collect text a tool has declared it needs. Injected rather than
 *        called directly so the hook does not own a dialog, and so swapping the
 *        modal for an inline editor on the sheet changes one component.
 */
export function useSheetEditor({
  sheetId,
  documentName,
  page,
  scale,
  rotation,
  promptForText = fallbackPrompt,
  capturePhoto = async () => null,
}) {
  const { annotations: reader, editor, exportHistory, changeLog, activeSeals } =
    useServices();

  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [toolId, setToolId] = useState(() => ToolRegistry.default().getId());
  const [style, setStyle] = useState(() => new MarkupStyle());
  const [draft, setDraft] = useState(null);
  const [moving, setMoving] = useState(null);
  const [error, setError] = useState(null);
  /** annotationId -> the most recent ChangeRecord for it. */
  const [lastChanges, setLastChanges] = useState(() => new Map());
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

  // --- seals --------------------------------------------------------------

  /**
   * Which markups on this sheet have already been issued.
   *
   * `useSyncExternalStore` rather than `useState` plus a subscription, because
   * the policy reads this same object DURING render. Without it a concurrent
   * render could paint one markup using the old seal set and its neighbour
   * using the new one, and two identical markups would disagree about whether
   * they are locked.
   */
  const sealedIds = useSyncExternalStore(
    useCallback((onChange) => activeSeals.subscribe(onChange), [activeSeals]),
    useCallback(() => activeSeals.ids, [activeSeals]),
  );

  useEffect(() => {
    let cancelled = false;

    if (!sheetId || !documentName) {
      activeSeals.replace([]);
      return undefined;
    }

    void (async () => {
      try {
        const ids = await exportHistory.sealedIdsForSheet(documentName, sheetId);
        // The user may have changed sheets while this was in flight. Applying a
        // stale result would lock the wrong markups on the wrong drawing.
        if (!cancelled) activeSeals.replace(ids);
      } catch (cause) {
        // FAILING OPEN is the wrong answer, but it is the only one available:
        // we cannot know what was sealed. Say so loudly rather than letting the
        // user believe nothing was ever issued.
        if (!cancelled) {
          activeSeals.replace([]);
          setError(
            'Could not read the export history, so previously issued markups ' +
              'may appear editable. ' +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exportHistory, activeSeals, documentName, sheetId]);

  /**
   * Whether a given markup may be changed, and why not.
   *
   * Delegates straight to the service. The hook deliberately does not know that
   * "issued" is the reason — when roles are switched on, this same call starts
   * returning role refusals and every caller keeps working.
   */
  const lockFor = useCallback(
    (annotation) => editor.canEdit(annotation),
    // `sealedIds` is in the list even though it is not referenced: the DECISION
    // depends on it, so this must be re-created when the seals change or the
    // panel would keep showing a stale answer.
    [editor, sealedIds],
  );

  // --- completeness -------------------------------------------------------

  /** What is still missing from a markup. Empty array when it is finished. */
  const problemsFor = useCallback(
    (annotation) => editor.problemsWith(annotation),
    [editor],
  );

  /**
   * Markups on this sheet that are not finished.
   *
   * New work cannot be incomplete — the tool collects the description and
   * `EditorService` refuses a blank one. So in practice this is pins placed
   * before the rule existed, which is exactly who needs surfacing: they are the
   * ones that would otherwise reach an architect as bare numbers.
   */
  const incompleteIds = useMemo(
    () =>
      new Set(
        items
          .filter((annotation) => editor.problemsWith(annotation).length > 0)
          .map((annotation) => annotation.id),
      ),
    [items, editor],
  );

  // --- loading ------------------------------------------------------------

  const reload = useCallback(async () => {
    if (!sheetId) {
      setItems([]);
      setLastChanges(new Map());
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
      return;
    }

    // Attribution is loaded separately and is allowed to fail quietly. "Who
    // last touched this" is useful context; it is not the user's work, and a
    // history read that fails must never stop a drawing from opening.
    try {
      setLastChanges(await changeLog.latestBySheet(sheetId));
    } catch {
      setLastChanges(new Map());
    }
  }, [reader, changeLog, sheetId]);

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
   *
   * ASYNC, because a tool may need text before anything can be created and
   * collecting it is now a proper dialog rather than a blocking `window.prompt`.
   * The pointerup that follows arrives while the dialog is open, finds no draft
   * in progress, and correctly does nothing.
   *
   * @param {import('../../domain/geometry/ViewportPoint').ViewportPoint} at
   * @param {string|null} hitId Annotation under the pointer, from the layer's
   *        hit test. The layer does the hit test because only it knows the DOM.
   */
  const begin = useCallback(
    async (at, hitId) => {
      // The WHOLE body is guarded. Now that this is async, anything thrown
      // becomes a rejected promise rather than an error the pointer handler
      // surfaces — and an unhandled rejection means a tap that silently does
      // nothing, which is the hardest kind of fault to report from a site.
      //
      // The selection branch is inside deliberately: `toClampedPdfPoint`
      // asserts its argument's coordinate space and throws on a mismatch.
      try {
        if (tool.isSelection()) {
          setSelectedId(hitId);
          if (!hitId) return;

          const target = items.find((a) => a.id === hitId);
          if (!target) return;

          // An issued markup can be SELECTED but not dragged. Selecting it is
          // how the user gets the panel that explains why it is locked, so
          // refusing the selection outright would hide the explanation behind
          // silence.
          if (editor.canEdit(target, 'move').denied) return;

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

        // Photo first, because it is the step most likely to be abandoned —
        // a denied camera permission or a cancelled file picker. Asking for
        // a caption before knowing there IS a photo would waste the typing.
        if (tool.requiresPhoto()) {
          const photo = await capturePhoto(tool.getPhotoPrompt());
          if (photo === null) return;
          extras.photo = photo;
        }

        if (tool.requiresText()) {
          // The TOOL describes what it needs; the presentation layer decides
          // how to ask. That is why a pin says "What needs fixing?" and a
          // callout says "Callout text" without this hook knowing either.
          const entered = await promptForText(tool.getTextPrompt());
          if (entered === null) return;
          extras.text = entered;
        }

        const created = reader.beginDraft(tool, context, at, extras);

        if (tool.isInstant()) {
          // A tap on a tablet always carries a pixel or two of movement.
          // Instant tools skip the drag phase so that jitter never turns a pin
          // into a discarded degenerate gesture.
          setDraftBoth(null);
          void run(async () => {
            const finalized = reader.finalizeDraft(tool, created);
            if (finalized) await editor.add(finalized);
          });
          return;
        }

        setDraftBoth(created);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [
      tool,
      items,
      reader,
      editor,
      context,
      run,
      promptForText,
      capturePhoto,
      setDraftBoth,
      setMovingBoth,
    ],
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

  /**
   * Scales a markup about its anchor.
   *
   * Routed through `run` like every other mutation, so a resize is one undo
   * step, is refused on issued work by the same policy, and is recorded with
   * the same attribution. Nothing about resizing needed a new path.
   */
  const resize = useCallback(
    (annotation, factor) => run(() => editor.resize(annotation, factor)),
    [editor, run],
  );

  /** Whether this markup has a size the interface should offer to change. */
  const canResize = useCallback(
    (annotation) => editor.canResize(annotation),
    [editor],
  );

  /**
   * Clears the sheet, reporting anything the seal kept.
   *
   * The service returns what it actually did rather than assuming, so the
   * message is the truth about the sheet and not a guess.
   */
  const clearSheet = useCallback(
    () =>
      run(async () => {
        const { keptSealed } = await editor.clearSheet(sheetId);
        if (keptSealed > 0) {
          setError(
            `${keptSealed} markup(s) were left in place because they have ` +
              'already been issued in a flattened PDF.',
          );
        }
      }),
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
    resize,
    canResize,
    clearSheet,

    // Permission and completeness, as data rather than as rules this layer
    // knows. Both come from EditorService so there is one answer in the app.
    lockFor,
    sealedIds,
    problemsFor,
    incompleteIds,

    // Attribution. Anonymous until sign-in exists, then real names, with no
    // change to this hook or anything that reads it.
    lastChangeFor: useCallback(
      (annotation) => lastChanges.get(annotation.id) ?? null,
      [lastChanges],
    ),

    undo,
    redo,
    // `revision` is in the dependency list so these re-evaluate after a command.
    //
    // `sealedIds` and `sheetId` are there because the history is ALSO cleared
    // by things that are not commands: issuing a flattened PDF, and opening a
    // different drawing. Without them the Undo button stays lit after an
    // export — which quietly contradicts the promise the confirmation just
    // made, that nothing can reach back behind a seal. Clicking it was
    // harmless, but a live-looking button is the wrong thing to show at the
    // moment a user has been told their work is now permanent.
    canUndo: useMemo(() => editor.canUndo(), [editor, revision, sealedIds, sheetId]),
    canRedo: useMemo(() => editor.canRedo(), [editor, revision, sealedIds, sheetId]),
    undoLabel: useMemo(() => editor.peekUndo(), [editor, revision, sealedIds, sheetId]),
    redoLabel: useMemo(() => editor.peekRedo(), [editor, revision, sealedIds, sheetId]),
  };
}
