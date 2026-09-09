import { useCallback, useState } from 'react';
import { Rotation } from '../../domain/geometry/PageGeometry';

/** 25% reads a whole E-size sheet; 800% reads a dimension string. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
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
 * THIS IS ALSO THE SPRINT 2 GESTURE SEAM
 * ---------------------------------------------------------------------------
 * A pinch-zoom library (react-zoom-pan-pinch, @use-gesture/react) replaces the
 * INTERNALS of this hook and nothing else, because everything downstream
 * consumes `scale` and `rotation` rather than reaching into gesture state.
 *
 * Selection criterion for that library: it must EXPOSE its current scale and
 * translation. One that hides its transform internally is unusable here, since
 * those numbers are exactly what the screen -> PDF conversion needs.
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

  const rotateClockwise = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  return { scale, rotation, zoomIn, zoomOut, resetZoom, rotateClockwise };
}
