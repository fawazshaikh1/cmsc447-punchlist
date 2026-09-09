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
 * Distributes scallop arcs evenly around a rectangle's perimeter.
 *
 * Each returned entry is a semicircular arc bulging OUTWARD from the rectangle.
 * The arcs are laid out corner to corner along each edge, with the count per
 * edge rounded so that the scallops are evenly spaced rather than leaving a
 * ragged partial bump at one corner.
 *
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 *        Normalised bounds — x,y is the bottom-left corner.
 * @param {number} radius Nominal scallop radius in PDF points.
 * @returns {{ cx: number, cy: number, r: number, from: number, to: number }[]}
 *          `from`/`to` are angles in radians, measured counter-clockwise from
 *          the positive X axis, and always span exactly PI (a semicircle).
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

    // Each scallop spans a diameter along the edge. At least one, so a short
    // side still gets a bump rather than a flat segment.
    const count = Math.max(1, Math.round(length / (nominalRadius * 2)));
    const step = length / count;
    const r = step / 2;

    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;

    const arcs = [];
    for (let i = 0; i < count; i++) {
      const centreDistance = step * i + r;
      arcs.push({
        cx: x0 + ux * centreDistance,
        cy: y0 + uy * centreDistance,
        r,
        // A semicircle centred on the outward normal bulges away from the box.
        from: outwardAngle - Math.PI / 2,
        to: outwardAngle + Math.PI / 2,
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
 * `k = 4/3 * tan(sweep / 4)`; splitting each semicircle into two quarter-arcs
 * keeps the maximum radial error near 0.03% — far below anything visible on a
 * printed drawing.
 *
 * @param {{ cx: number, cy: number, r: number, from: number, to: number }} arc
 * @param {number} [segments] Quarter-arcs to split into. Two is ample.
 * @returns {{ start: {x:number,y:number},
 *             curves: { c1:{x,y}, c2:{x,y}, end:{x,y} }[] }}
 */
export function arcToBeziers(arc, segments = 2) {
  const { cx, cy, r, from, to } = arc;
  const sweep = (to - from) / segments;
  const k = (4 / 3) * Math.tan(sweep / 4);

  const at = (angle) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });

  const curves = [];
  for (let i = 0; i < segments; i++) {
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
