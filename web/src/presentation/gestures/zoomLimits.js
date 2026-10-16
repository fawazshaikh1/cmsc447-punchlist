/**
 * How far the sheet can be zoomed, shared by the zoom buttons and by pinching
 * so the two can never disagree about the limits.
 *
 * 25% reads a whole E-size sheet; 800% reads a dimension string.
 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

/**
 * A scale inside the limits, rounded to four places. The rounding is what
 * lets a pinch that ends where it began compare equal to the scale it started
 * at, instead of differing in the fifteenth decimal and forcing a re-render.
 *
 * @param {number} scale
 * @returns {number}
 */
export function clampScale(scale) {
  if (!Number.isFinite(scale)) return 1;
  return Number(Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE).toFixed(4));
}
