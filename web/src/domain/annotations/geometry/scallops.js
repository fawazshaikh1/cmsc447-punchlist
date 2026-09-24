/**
 * Shared geometry for revision clouds.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED RATHER THAN DUPLICATED IN EACH RENDERER
 * ---------------------------------------------------------------------------
 * A cloud is drawn twice: once as SVG on screen, once into the exported PDF's
 * appearance stream. SVG and PDF use different primitives — SVG has an arc
 * command (`A`), PDF has only cubic Bézier curves (`c`) — so the two renderers
 * cannot share drawing CODE.
 *
 * They can and must share the SHAPE. This module produces the scallop centres
 * and angles; each renderer converts them using its own primitive. Without
 * that, the on-screen cloud and the exported cloud would slowly diverge, and
 * the difference would only be discovered by a user opening the export in
 * Acrobat and finding it does not match what they drew.
 *
 * All coordinates are in PDF user space (origin bottom-left, Y up).
 */

/**
 * How far around each bump the outline travels, in radians.
 *
 * ===========================================================================
 * WHY 200 DEGREES
 * ===========================================================================
 * This started as a semicircle per bump, which is the obvious reading of
 * "scalloped edge" — and it drew a WAVE, not a cloud. Semicircles meet the edge
 * at a right angle and flow smoothly into each other, so the outline undulates
 * gently and reads as a decorative border.
 *
 * A cloud, and a thought bubble, are puffy: each bump is more than half a
 * circle, so the outline curves back towards the edge and meets the next bump
 * at a cusp. That needs a MAJOR arc.
 *
 * The value was chosen by rendering a grid of candidates and looking at them,
 * not by argument. Below about 195 it still reads as a wave. At 200 the lobes
 * are round and full with clean cusps. Past about 225 each bump's base starts
 * to pinch inward, and by 240 — the first value tried here — the lobes are
 * deeper than they are wide and the whole thing reads as a flower.
 */
const BUMP_SWEEP = (200 * Math.PI) / 180;

/**
 * Distributes cloud bumps evenly around a rectangle's perimeter.
 *
 * Each returned entry is a MAJOR arc bulging OUTWARD from the rectangle, and
 * consecutive arcs share an endpoint on the edge line — so the whole perimeter
 * is one continuous path with a cusp between each pair of bumps, which is what
 * makes it read as a cloud rather than a wave.
 *
 * The arcs are laid out corner to corner along each edge, with the count per
 * edge rounded so the bumps are evenly spaced rather than leaving a ragged
 * partial one at a corner.
 *
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 *        Normalised bounds — x,y is the bottom-left corner.
 * @param {number} radius Nominal scallop radius in PDF points.
 * @returns {{ cx: number, cy: number, r: number, from: number, to: number,
 *              sweep: number }[]}
 *          `from`/`to` are angles in radians, measured counter-clockwise from
 *          the positive X axis, and span `BUMP_SWEEP`. `sweep` is carried so a
 *          renderer can pick its own primitive's flags — SVG needs to know
 *          whether this is a major arc.
 */
export function scallopArcs(bounds, radius) {
  const { x, y, width, height } = bounds;

  // ==========================================================================
  // CRASH THIS GUARD PREVENTS — worth understanding before changing it
  // ==========================================================================
  // The nominal radius used to be clamped against BOTH dimensions:
  //
  //     Math.max(1, Math.min(radius, width / 2, height / 2))
  //
  // which collapses to 1 the moment either dimension is zero — and a cloud is
  // ALWAYS zero-sized on pointerdown, before the drag has moved. Each edge then
  // divided by its own length, and a zero-length edge produced `0 / 0` = NaN
  // for the arc centres. Those NaNs reached `new PdfPoint(NaN, NaN)`, whose
  // constructor correctly throws — but it threw during a React render, which
  // unmounts the whole tree and leaves a WHITE SCREEN.
  //
  // A perfectly horizontal or vertical drag hit the same path, so it was not
  // only the first click.
  //
  // The fix is in two parts. Here, the radius no longer depends on the smaller
  // dimension at all: each edge derives its own scallop size from its own
  // length below, which is what "evenly spaced along this edge" actually means.
  // And `edge()` returns nothing for a zero-length side, so a degenerate cloud
  // yields fewer arcs rather than invalid ones.
  //
  // The second part is an ErrorBoundary around each marker, so that a future
  // bug of this shape degrades to one missing markup instead of a dead app.
  const nominalRadius = Math.max(2, radius);

  /**
   * Walks one edge, emitting evenly spaced semicircles.
   * @param {number} x0 @param {number} y0 Start of the edge.
   * @param {number} x1 @param {number} y1 End of the edge.
   * @param {number} outwardAngle Direction the bumps should bulge, in radians.
   * @returns {object[]} Empty for a zero-length edge.
   */
  const edge = (x0, y0, x1, y1, outwardAngle) => {
    const length = Math.hypot(x1 - x0, y1 - y0);

    // A side with no length has no scallops, and dividing by it would produce
    // the NaNs described above.
    if (!(length > 0)) return [];

    // Each bump spans `step` along the edge. At least one, so a short side
    // still gets a bump rather than a flat segment.
    const count = Math.max(1, Math.round(length / (nominalRadius * 2)));
    const step = length / count;

    // The geometry that makes a bump puffy.
    //
    // The two endpoints sit `step` apart ON the edge — that is the chord. For a
    // chord of length `step` subtending BUMP_SWEEP, the circle's radius is
    // (step/2) / sin(sweep/2), and its centre sits off the chord's midpoint by
    // r*|cos(sweep/2)|, displaced TOWARDS the bulge.
    //
    // At sweep = PI this collapses to r = step/2 with zero offset — the old
    // semicircle — so the change is a generalisation rather than a rewrite.
    const half = BUMP_SWEEP / 2;
    const r = step / 2 / Math.sin(half);
    const centreOffset = r * Math.abs(Math.cos(half));

    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    const nx = Math.cos(outwardAngle);
    const ny = Math.sin(outwardAngle);

    const arcs = [];
    for (let i = 0; i < count; i++) {
      // Midpoint of this bump's chord, along the edge.
      const along = step * i + step / 2;

      arcs.push({
        cx: x0 + ux * along + nx * centreOffset,
        cy: y0 + uy * along + ny * centreOffset,
        r,
        // ====================================================================
        // THE DIRECTION OF TRAVEL
        // ====================================================================
        // `from` is the TRAILING endpoint of the bump and `to` the LEADING one,
        // so each arc is walked in the same direction the edge is and
        // consecutive bumps share an endpoint exactly.
        //
        // Which way round that is depends on the handedness of `u` and `n`, not
        // on intuition. Every edge below is walked so the outward normal sits on
        // the same side (u x n = -1 throughout), and for that traversal this is
        // the order. Flipping it — which looks equally plausible written down —
        // reverses every arc so bump i ends where bump i-1 started, and the
        // outline becomes a row of teardrops with straight lines cutting the
        // corners. That was verified by rendering both, not by reasoning.
        from: outwardAngle - half,
        to: outwardAngle + half,
        sweep: BUMP_SWEEP,
      });
    }
    return arcs;
  };

  const right = x + width;
  const top = y + height;

  // Walked clockwise starting from the bottom-left, with each edge's bumps
  // pointing away from the rectangle's interior.
  return [
    ...edge(x, y, right, y, -Math.PI / 2), // bottom edge, bulging down
    ...edge(right, y, right, top, 0), // right edge, bulging right
    ...edge(right, top, x, top, Math.PI / 2), // top edge, bulging up
    ...edge(x, top, x, y, Math.PI), // left edge, bulging left
  ];
}

/**
 * Converts one arc to the cubic Bézier control points that approximate it.
 *
 * PDF has no arc operator, so every curve must be expressed as cubics. This
 * uses the standard circular-arc approximation with the magic constant
 * `k = 4/3 * tan(sweep / 4)`, whose accuracy falls off sharply past a quarter
 * turn per segment.
 *
 * The segment count is therefore DERIVED from the sweep rather than fixed. It
 * used to be hard-coded to two, which was right while every arc was a
 * semicircle; a 240-degree cloud bump split in two would be 120 degrees per
 * segment, well outside the range where the approximation holds, and the bumps
 * would come out visibly lopsided in the exported PDF while looking correct on
 * screen.
 *
 * @param {{ cx: number, cy: number, r: number, from: number, to: number }} arc
 * @param {number} [segments] Override. By default, enough for a quarter turn
 *        each, which holds the maximum radial error near 0.03%.
 * @returns {{ start: {x:number,y:number},
 *             curves: { c1:{x,y}, c2:{x,y}, end:{x,y} }[] }}
 */
export function arcToBeziers(arc, segments) {
  const { cx, cy, r, from, to } = arc;
  const parts = segments ?? Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
  const sweep = (to - from) / parts;
  const k = (4 / 3) * Math.tan(sweep / 4);

  const at = (angle) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });

  const curves = [];
  for (let i = 0; i < parts; i++) {
    const a0 = from + sweep * i;
    const a1 = a0 + sweep;
    const p0 = at(a0);
    const p1 = at(a1);

    curves.push({
      // Control points lie along the tangents at each endpoint.
      c1: { x: p0.x - k * r * Math.sin(a0), y: p0.y + k * r * Math.cos(a0) },
      c2: { x: p1.x + k * r * Math.sin(a1), y: p1.y - k * r * Math.cos(a1) },
      end: p1,
    });
  }

  return { start: at(from), curves };
}
