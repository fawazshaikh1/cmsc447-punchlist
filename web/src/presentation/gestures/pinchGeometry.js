/**
 * The arithmetic of a two-finger gesture, kept free of the DOM so it can be
 * checked without a browser.
 *
 * Points are client coordinates `{ x, y }`; rectangles are `DOMRect`-shaped
 * `{ left, top, width, height }`.
 */

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b */
export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Where a screen point falls on the sheet, as fractions of its width and
 * height — `{ u: 0.5, v: 0.5 }` is the centre. Fractions rather than pixels
 * because they stay true across a zoom: the same spot on the drawing is at
 * the same fraction whatever size the sheet is drawn at.
 *
 * @param {{left:number,top:number,width:number,height:number}} sheet
 * @param {{x:number,y:number}} point
 * @returns {{u:number, v:number}}
 */
export function anchorOn(sheet, point) {
  return {
    u: sheet.width > 0 ? (point.x - sheet.left) / sheet.width : 0.5,
    v: sheet.height > 0 ? (point.y - sheet.top) / sheet.height : 0.5,
  };
}

/**
 * How far to scroll so the spot at `anchor` on the sheet ends up under
 * `point` on the screen. This is what keeps the thing between your fingers
 * between your fingers when a pinch ends and the sheet is redrawn bigger.
 *
 * @param {{left:number,top:number,width:number,height:number}} sheet As laid out now.
 * @param {{u:number, v:number}} anchor
 * @param {{x:number,y:number}} point
 * @returns {{dx:number, dy:number}} Add to scrollLeft / scrollTop.
 */
export function scrollToKeep(sheet, anchor, point) {
  return {
    dx: sheet.left + anchor.u * sheet.width - point.x,
    dy: sheet.top + anchor.v * sheet.height - point.y,
  };
}

/**
 * The CSS transform that previews a pinch without redrawing anything: scale
 * about where the fingers started, then follow where they have moved.
 *
 * @param {{x:number,y:number}} startMid Midpoint when the pinch began.
 * @param {{x:number,y:number}} mid Midpoint now.
 * @param {number} factor New scale ÷ starting scale, already clamped.
 * @param {{left:number,top:number}} sheet The sheet's rect when the pinch began.
 * @returns {{ transform: string, transformOrigin: string }}
 */
export function previewTransform(startMid, mid, factor, sheet) {
  const originX = startMid.x - sheet.left;
  const originY = startMid.y - sheet.top;
  return {
    transformOrigin: `${originX}px ${originY}px`,
    transform: `translate(${mid.x - startMid.x}px, ${mid.y - startMid.y}px) scale(${factor})`,
  };
}
