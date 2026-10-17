import { useCallback, useState } from 'react';
import { Rotation } from '../../domain/geometry/PageGeometry';
import { clampScale, MAX_SCALE, MIN_SCALE } from '../gestures/zoomLimits';

const ZOOM_STEP = 1.5;

/**
 * Owns how the sheet is currently being LOOKED AT — zoom and rotation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM useSheetDocument AND useAnnotations
 * ---------------------------------------------------------------------------
 * These three things change at completely different rates: view state changes
 * on every pinch, annotations change on every tap, and the document changes
 * once. Splitting them means a zoom does not re-run annotation loading, and
 * adding a pin does not tear down and re-render the canvas.
 *
 * ---------------------------------------------------------------------------
 * THIS IS ALSO THE GESTURE SEAM
 * ---------------------------------------------------------------------------
 * Pinch-zoom (presentation/gestures/usePinchZoom) attaches through `zoomTo`
 * and nothing else, because everything downstream consumes `scale` and
 * `rotation` rather than reaching into gesture state. Any replacement gesture
 * code must keep it that way: the screen -> PDF conversion needs the real
 * scale, so a transform hidden inside a gesture layer would break it.
 */
export function useViewState(initial = {}) {
  const [scale, setScale] = useState(initial.scale ?? 1);
  const [rotation, setRotation] = useState(initial.rotation ?? Rotation.NONE);

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(Number((s * ZOOM_STEP).toFixed(4)), MAX_SCALE)),
    [],
  );

  const zoomOut = useCallback(
    () => setScale((s) => Math.max(Number((s / ZOOM_STEP).toFixed(4)), MIN_SCALE)),
    [],
  );

  const resetZoom = useCallback(() => setScale(1), []);

  /**
   * Any zoom inside the limits — what a pinch or a trackpad sets, as opposed
   * to the buttons' fixed steps. The gesture lives in usePinchZoom; this only
   * stores the result, which is what keeps every consumer of `scale`
   * unaware that pinching exists.
   */
  const zoomTo = useCallback((next) => setScale(clampScale(next)), []);

  const rotateClockwise = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  return { scale, rotation, zoomIn, zoomOut, resetZoom, zoomTo, rotateClockwise };
}
