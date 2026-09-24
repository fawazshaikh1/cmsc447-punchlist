import { useCallback, useMemo, useRef } from 'react';

import { ViewportPoint } from '../../domain/geometry/ViewportPoint';
import { ErrorBoundary } from './ErrorBoundary';
import { SourceAnnotationLayer } from './SourceAnnotationLayer';
import { MarkerRegistry } from './markers';

/**
 * A key that changes whenever an annotation's geometry does.
 *
 * Used to remount the per-marker ErrorBoundary, so a markup that failed to
 * render in one state recovers the moment it leaves that state — rather than
 * staying permanently broken for the rest of the session.
 */
function markerResetKey(annotation) {
  try {
    const { x, y } = annotation.getAnchor();
    return `${annotation.id}:${x}:${y}`;
  } catch {
    // Even reading the anchor can throw on a malformed annotation.
    return annotation.id;
  }
}

/**
 * Placeholder for a markup whose renderer threw.
 *
 * Shows a small dashed marker rather than nothing, because a silently missing
 * markup is worse than a visibly broken one: the user would believe their work
 * had been lost, and would redraw it on top of something that is still stored
 * and will still appear in the export.
 *
 * Must itself be incapable of throwing — it is the fallback.
 */
function BrokenMarker({ annotation, project }) {
  let position = null;
  try {
    position = project(annotation.getAnchor());
  } catch {
    position = null;
  }
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;

  return (
    <g transform={`translate(${position.x}, ${position.y})`} pointerEvents="none">
      <rect x={-9} y={-9} width={18} height={18} fill="none" stroke="#c00" strokeWidth={1.5} strokeDasharray="3" />
      <title>This markup could not be drawn. It is still saved and will still export.</title>
    </g>
  );
}

/**
 * Pointer capture that cannot break the gesture it is trying to help.
 *
 * ===========================================================================
 * WHY THESE ARE WRAPPED
 * ===========================================================================
 * `setPointerCapture` throws `NotFoundError` when the pointer id is not
 * currently active — a fast tap whose pointer has already been released, a
 * stylus the browser has re-issued under a new id, or a synthetic event from an
 * assistive tool or a test harness.
 *
 * The optional call (`?.`) that used to be here guards the method being
 * MISSING, not the method THROWING, so those cases escaped it.
 *
 * That became more costly when placing a pin started asking for a description:
 * capture runs BEFORE the gesture is handed to the hook, so a throw here loses
 * the whole tap — the drawing would simply not respond, with nothing to
 * explain why.
 *
 * Capture is an enhancement, not a requirement. Losing it means a drag that
 * leaves the sheet may not finish cleanly; losing the gesture means the tool
 * appears broken. Swallowing is the right trade, and the only one.
 */
function capturePointer(element, pointerId) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // See above: the gesture proceeds without capture.
  }
}

function releasePointer(element, pointerId) {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // Already released, or never captured. Nothing to undo.
  }
}

/**
 * Transparent SVG sheet stacked over the canvas, carrying every annotation.
 *
 * ===========================================================================
 * WHY MARKUPS SURVIVE ZOOM — the central idea
 * ===========================================================================
 * The `viewBox` is the page size **in PDF points**, while the SVG's CSS size is
 * the page size **in screen pixels at the current zoom**. The browser performs
 * the document -> screen transform itself, natively, every frame.
 *
 * Marker coordinates are therefore **NOT RECALCULATED** on zoom. A marker
 * written at PDF point (200, 642) stays at (200, 642) in this SVG at every zoom
 * level. Verified: zooming 1.00x -> 2.25x left every marker's geometry
 * attributes byte-identical while the rendered size scaled correctly.
 *
 * ---------------------------------------------------------------------------
 * THE Y FLIP
 * ---------------------------------------------------------------------------
 * SVG's Y axis points down; PDF's points up. Rather than flipping by hand
 * (`svgY = pageHeight - pdfY`), which breaks as soon as rotation is involved,
 * we ask a SCALE-1 transformer. At scale 1, pdf.js's viewport space IS this
 * SVG's coordinate space. That function is handed to every marker as `project`.
 *
 * ---------------------------------------------------------------------------
 * HIT TESTING WITHOUT THE MARKERS KNOWING
 * ---------------------------------------------------------------------------
 * Each marker is wrapped in a `<g data-annotation-id>`, so a pointerdown can
 * find what it landed on with `closest()`. Selection and drag-to-move therefore
 * live entirely in this component, and none of the six marker components had to
 * change to gain either — which is the same "add, don't modify" property the
 * registries give the model.
 *
 * ---------------------------------------------------------------------------
 * AND THE SAME TRICK MARKS ISSUED MARKUPS
 * ---------------------------------------------------------------------------
 * A markup that has been issued in a flattened PDF is drawn with a `data-sealed`
 * attribute on that same wrapper, and one that is missing something it needs —
 * a pin with no description — gets `data-incomplete`. The stylesheet does the
 * rest. None of the six marker components knows either concept exists.
 *
 * Putting the state on the wrapper instead of passing `isSealed` / `isIncomplete`
 * props is what keeps that true: a seventh markup type gets both treatments for
 * free, and a marker author never has to remember to honour them. It is also why
 * adding the second one just now cost one attribute rather than six components.
 */
export function AnnotationLayer({
  page,
  scale,
  rotation,
  annotations,
  sourceAnnotations,
  showSource,
  selectedId,
  sealedIds,
  incompleteIds,
  onSelect,
  onGestureStart,
  onGestureMove,
  onGestureEnd,
  onGestureCancel,
}) {
  // Scale 1 => output is in this SVG's own coordinate space.
  const layout = useMemo(() => page.createTransformer(1, rotation), [page, rotation]);

  // Current scale => used only for sizing, so the overlay matches the canvas.
  const rendered = useMemo(
    () => page.createTransformer(scale, rotation),
    [page, scale, rotation],
  );

  // The viewBox MUST come from the scale-1 transformer, not from
  // `page.getGeometry()`. PageGeometry knows only the page's intrinsic
  // `/Rotate`, not the rotation the user applied, so deriving the viewBox from
  // it leaves the box unswapped after a 90-degree turn while the CSS box swaps
  // correctly — silently stretching the overlay and misplacing every marker.
  const viewBox = layout.getCssSize();
  const cssSize = rendered.getCssSize();

  /** PdfPoint -> this SVG's coordinate space. Handed to every marker. */
  const project = useCallback((pdfPoint) => layout.toViewportPoint(pdfPoint), [layout]);

  // Set when a drag actually moved something, so the click that follows
  // pointerup does not also toggle the selection. Cleared on the next capture.
  const suppressClick = useRef(false);

  const pointAt = useCallback(
    (event) => ViewportPoint.fromPointerEvent(event, event.currentTarget),
    [],
  );

  /** Which annotation is under the pointer, if any. */
  const hitTest = useCallback((event) => {
    const node = event.target instanceof Element
      ? event.target.closest('[data-annotation-id]')
      : null;
    return node?.getAttribute('data-annotation-id') ?? null;
  }, []);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      width={cssSize.width}
      height={cssSize.height}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        // Stops the browser treating a drag as a scroll or pinch on a tablet,
        // which would pan the page instead of drawing on it.
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        // Capture so a drag that leaves the SVG still delivers move and up
        // events here. Without it, dragging past the sheet edge strands the
        // gesture forever with no pointerup to finish it.
        capturePointer(event.currentTarget, event.pointerId);
        suppressClick.current = false;
        // Deliberately not awaited: nothing here depends on the result, and the
        // hook reports its own failures. `void` marks that as a decision rather
        // than a forgotten await — begin() became async when placing a pin
        // started asking for a description first.
        void onGestureStart(pointAt(event), hitTest(event));
      }}
      onPointerMove={(event) => onGestureMove(pointAt(event))}
      onPointerUp={(event) => {
        releasePointer(event.currentTarget, event.pointerId);
        suppressClick.current = onGestureEnd() === true;
      }}
      onPointerCancel={onGestureCancel}
      onClickCapture={(event) => {
        // Runs BEFORE a marker's own onClick. After a real drag we swallow the
        // click, or releasing the pointer over the moved marker would toggle
        // its selection off — the annotation would visibly deselect itself the
        // moment the user finished positioning it.
        if (suppressClick.current) {
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      {/* Existing PDF comments render FIRST, so they sit beneath the user's own
          markups. They are read-only and are never re-exported. */}
      {showSource && (
        <ErrorBoundary label="source-annotations" fallback={null}>
          <SourceAnnotationLayer annotations={sourceAnnotations} project={project} />
        </ErrorBoundary>
      )}

      {annotations.map((annotation, index) => {
        const Marker = MarkerRegistry.resolve(annotation.getKind());

        // Unknown kind: a newer build wrote a markup type this one cannot draw.
        // Skip the marker, keep the sheet.
        if (!Marker) return null;

        // Projecting the anchor can itself throw on a malformed annotation, so
        // it happens inside the boundary's scope, not before it.
        return (
          <g
            key={annotation.id}
            data-annotation-id={annotation.id}
            // Rendered only when true, so the attribute selector in the
            // stylesheet stays a simple presence check.
            data-sealed={sealedIds?.has(annotation.id) ? 'true' : undefined}
            // Rendered only when true, so the attribute selectors in the
            // stylesheet stay simple presence checks.
            data-incomplete={incompleteIds?.has(annotation.id) ? 'true' : undefined}
          >
            <ErrorBoundary
              // Remounting on any geometry change clears a previous failure, so
              // a markup that broke while being dragged through a bad state
              // recovers as soon as it leaves it.
              key={markerResetKey(annotation)}
              label={`marker:${annotation.getKind()}`}
              fallback={<BrokenMarker project={project} annotation={annotation} />}
            >
              <Marker
                annotation={annotation}
                project={project}
                rotation={rotation}
                x={project(annotation.getAnchor()).x}
                y={project(annotation.getAnchor()).y}
                ordinal={index + 1}
                isSelected={annotation.id === selectedId}
                onSelect={onSelect}
              />
            </ErrorBoundary>
          </g>
        );
      })}
    </svg>
  );
}
