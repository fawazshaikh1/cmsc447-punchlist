import { useEffect, useLayoutEffect, useRef } from 'react';

import { anchorOn, distance, midpoint, previewTransform, scrollToKeep } from './pinchGeometry';
import { TouchGestureArbiter } from './TouchGestureArbiter';
import { clampScale } from './zoomLimits';

/**
 * Two-finger pinch-zoom and pan on a tablet, and pinch-zoom on a laptop
 * trackpad, for the sheet inside `stageRef`.
 *
 * ===========================================================================
 * HOW IT FITS IN
 * ===========================================================================
 * The zoom itself is still just `scale`, owned by useViewState — this hook
 * only asks for a new one through `onZoomTo`. Everything downstream (the
 * canvas, the overlay, the coordinate maths) keeps consuming `scale` exactly
 * as it did for the zoom buttons, which is the seam ARCHITECTURE.md said a
 * gesture implementation would attach to.
 *
 * Touches are caught on the stage in the CAPTURE phase, before the sheet's
 * overlay sees them, and TouchGestureArbiter decides what each one is. A
 * one-finger gesture is passed on (after a moment's hold — see the arbiter);
 * two fingers never reach the overlay at all.
 *
 * ===========================================================================
 * WHY THE PINCH IS PREVIEWED, THEN COMMITTED
 * ===========================================================================
 * Re-rendering a drawing through pdf.js on every finger movement would mean
 * sixty renders a second of an E-size sheet. Instead the sheet is scaled with
 * a CSS transform while the fingers move — free, and smooth — and the real
 * scale is set once, when they lift. The spot that was between the fingers is
 * then scrolled back under them, so the drawing does not jump.
 *
 * @param {object} options
 * @param {import('react').RefObject<HTMLElement>} options.stageRef The scrolling container.
 * @param {import('react').RefObject<HTMLElement>} options.sheetRef The sheet inside it.
 * @param {number} options.scale The current zoom.
 * @param {(scale: number) => void} options.onZoomTo Sets the zoom (clamped by the caller too).
 * @param {() => void} options.onCancelGesture Abandons a half-finished one-finger gesture.
 */
export function usePinchZoom({ stageRef, sheetRef, scale, onZoomTo, onCancelGesture }) {
  const latest = useRef({ scale, onZoomTo, onCancelGesture });
  useLayoutEffect(() => {
    latest.current = { scale, onZoomTo, onCancelGesture };
  });

  /** A spot on the sheet to bring back under a screen point once the new scale has been laid out. */
  const pendingAnchor = useRef(null);

  // A passive effect, NOT a layout effect, on purpose. The sheet takes its
  // size from the canvas, and SheetCanvas sets that size in its own effect.
  // A layout effect here runs first, measures the sheet at the OLD size, and
  // scrolls by nothing — and any scroll it did try would be clamped to the old
  // content. Children's effects run before their parent's, so by the time this
  // one runs the canvas has grown and the measurement is the real one.
  useEffect(() => {
    const pending = pendingAnchor.current;
    if (!pending) return;
    pendingAnchor.current = null;
    keepUnder(stageRef.current, sheetRef.current, pending);
  }, [scale, stageRef, sheetRef]);

  useEffect(() => {
    const stage = stageRef.current;
    const sheet = sheetRef.current;
    if (!stage || !sheet) return undefined;

    let disposed = false;
    let pinch = null;
    let previewFrame = 0;
    let replaying = false;
    /** @type {Map<number, EventTarget>} where each held touch landed, to replay it there */
    const landedOn = new Map();

    /** Sets the zoom and arranges for `anchor` to end up under `point`. */
    const commitZoom = (target, anchor, point) => {
      if (target === latest.current.scale) {
        keepUnder(stage, sheet, { anchor, point });
        return;
      }
      pendingAnchor.current = { anchor, point };
      // Optimistic, so a second commit in the same frame — trackpads send
      // bursts — compounds from the new scale rather than the stale one.
      latest.current = { ...latest.current, scale: target };
      latest.current.onZoomTo(target);
    };

    const showPreview = () => {
      previewFrame = 0;
      if (!pinch) return;
      const { transform, transformOrigin } = previewTransform(pinch.startMid, pinch.mid, pinch.factor, pinch.rect);
      sheet.style.transformOrigin = transformOrigin;
      sheet.style.transform = transform;
    };

    const clearPreview = () => {
      if (previewFrame) cancelAnimationFrame(previewFrame);
      previewFrame = 0;
      sheet.style.transform = '';
      sheet.style.transformOrigin = '';
      sheet.style.willChange = '';
    };

    const arbiter = new TouchGestureArbiter({
      onRelease: (first) => {
        if (disposed) return;
        const target = landedOn.get(first.pointerId) ?? sheet;
        // Replay the pointerdown the sheet never saw, exactly where it
        // happened, so drawing, placing and selecting start as they always
        // did. Flagged so the capture listener lets its own replay through.
        replaying = true;
        try {
          target.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: first.pointerId,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: first.x,
              clientY: first.y,
            }),
          );
        } finally {
          replaying = false;
        }
      },

      onCancelDrawing: () => latest.current.onCancelGesture?.(),

      onPinchStart: (a, b) => {
        const rect = sheet.getBoundingClientRect();
        const mid = midpoint(a, b);
        pinch = {
          startMid: mid,
          mid,
          startDistance: Math.max(distance(a, b), 1),
          startScale: latest.current.scale,
          factor: 1,
          rect,
          anchor: anchorOn(rect, mid),
        };
        sheet.style.willChange = 'transform';
      },

      onPinchMove: (a, b) => {
        if (!pinch) return;
        const target = clampScale((pinch.startScale * distance(a, b)) / pinch.startDistance);
        pinch.factor = target / pinch.startScale;
        pinch.mid = midpoint(a, b);
        if (!previewFrame) previewFrame = requestAnimationFrame(showPreview);
      },

      onPinchEnd: () => {
        if (!pinch) return;
        const { startScale, factor, anchor, mid } = pinch;
        pinch = null;
        clearPreview();
        commitZoom(clampScale(startScale * factor), anchor, mid);
      },
    });

    const pointOf = (event) => ({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    });

    const keepFromSheet = (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    };

    const onDown = (event) => {
      if (replaying) return;
      if (event.pointerType === 'touch') landedOn.set(event.pointerId, event.target);
      if (arbiter.down(pointOf(event))) keepFromSheet(event);
    };
    const onMove = (event) => {
      if (arbiter.move(pointOf(event))) keepFromSheet(event);
    };
    const onUp = (event) => {
      const keep = arbiter.up(pointOf(event));
      landedOn.delete(event.pointerId);
      if (keep) keepFromSheet(event);
    };
    const onCancel = (event) => {
      const keep = arbiter.up(pointOf(event), { cancelled: true });
      landedOn.delete(event.pointerId);
      if (keep) keepFromSheet(event);
    };

    // Trackpad pinch arrives as a wheel event with ctrlKey set (as does
    // Ctrl+scroll). Plain scrolling is left to the browser. Bursts within one
    // frame are merged into a single zoom step.
    let wheelFactor = 1;
    let wheelAt = null;
    let wheelFrame = 0;
    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      wheelFactor *= Math.exp(-pixels * 0.01);
      wheelAt = { x: event.clientX, y: event.clientY };

      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const target = clampScale(latest.current.scale * wheelFactor);
        wheelFactor = 1;
        commitZoom(target, anchorOn(sheet.getBoundingClientRect(), wheelAt), wheelAt);
      });
    };

    stage.addEventListener('pointerdown', onDown, true);
    stage.addEventListener('pointermove', onMove, true);
    stage.addEventListener('pointerup', onUp, true);
    stage.addEventListener('pointercancel', onCancel, true);
    stage.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      disposed = true;
      clearPreview();
      if (wheelFrame) cancelAnimationFrame(wheelFrame);
      stage.removeEventListener('pointerdown', onDown, true);
      stage.removeEventListener('pointermove', onMove, true);
      stage.removeEventListener('pointerup', onUp, true);
      stage.removeEventListener('pointercancel', onCancel, true);
      stage.removeEventListener('wheel', onWheel);
    };
  }, [stageRef, sheetRef]);
}

/** Scrolls `stage` so the spot at `anchor` on `sheet` sits under `point`. */
function keepUnder(stage, sheet, { anchor, point }) {
  if (!stage || !sheet) return;
  const { dx, dy } = scrollToKeep(sheet.getBoundingClientRect(), anchor, point);
  stage.scrollLeft += dx;
  stage.scrollTop += dy;
}
