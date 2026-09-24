import { PIN_LABEL, layoutPinLabel } from '../../../domain/annotations/geometry/pinLabel';

/**
 * The description box drawn beside a pin on the canvas.
 *
 * ===========================================================================
 * THE TWIN OF pinLabelOps
 * ===========================================================================
 * This paints in SVG what `pinLabelOps` paints in PDF operators, from the SAME
 * layout — `layoutPinLabel` in the domain. Neither file decides where anything
 * goes; both ask.
 *
 * That is the whole point. The last time a markup was drawn from separate code
 * on each side, the two drifted and the bug was invisible on screen and wrong
 * in the exported file, which is the worst possible place to find it.
 *
 * ---------------------------------------------------------------------------
 * Y IS FLIPPED HERE
 * ---------------------------------------------------------------------------
 * The layout returns PDF user space, where Y increases UPWARD. This overlay
 * uses the same units with the axis inverted, so every Y from the layout is
 * NEGATED on the way in. Each one is negated at the point of use and nowhere
 * else, so there is no half-converted coordinate anywhere in this file.
 */

/**
 * Measures text the way the PDF writer does.
 *
 * pdf-lib measures with Helvetica's real metrics. A canvas asked for Helvetica
 * gets Arial on Windows, whose advance widths are the same by design — so the
 * two wrap at the same word in all but pathological cases.
 *
 * The canvas is created once and reused: creating one per measurement makes
 * dragging a pin allocate a canvas per frame.
 */
let measuringContext = null;

function measure(text, size) {
  if (!measuringContext) {
    measuringContext = document.createElement('canvas').getContext('2d');
  }
  if (!measuringContext) return text.length * size * 0.5;

  measuringContext.font = `${size}px Helvetica, Arial, sans-serif`;
  return measuringContext.measureText(text).width;
}

/**
 * @param {object} props
 * @param {string} props.description
 * @param {string} props.status Short tag, e.g. "OPEN".
 * @param {string} props.colour Status colour, as CSS.
 */
export function PinLabel({ description, status, colour }) {
  const layout = layoutPinLabel({ description, status, measure });
  const { box } = layout;

  return (
    // One group, not separately interactive: the label belongs to the pin's
    // click target, so tapping the description selects the item rather than
    // doing nothing or starting a text selection.
    <g style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <rect
        x={box.left}
        // SVG rects are positioned from their TOP edge, and the layout's `top`
        // is above the centre in a Y-up space — so it negates to the smaller
        // (upper) screen coordinate.
        y={-box.top}
        width={box.width}
        height={box.height}
        rx={PIN_LABEL.cornerRadius}
        fill="#fff"
        fillOpacity={0.94}
        stroke={colour}
        strokeWidth={PIN_LABEL.borderWidth}
      />

      {/* Leader, from the pin's edge to the box. */}
      <line
        x1={box.left - PIN_LABEL.gap}
        y1={0}
        x2={box.left}
        y2={0}
        stroke={colour}
        strokeWidth={PIN_LABEL.borderWidth}
      />

      {layout.lines.map((line, index) => (
        <text
          key={index}
          x={layout.textLeft}
          y={-layout.lineBaselines[index]}
          fontSize={PIN_LABEL.fontSize}
          fontFamily="Helvetica, Arial, sans-serif"
          fill="#1a2128"
        >
          {line}
        </text>
      ))}

      {layout.statusText ? (
        <text
          x={layout.textLeft}
          y={-layout.statusBaseline}
          fontSize={PIN_LABEL.statusSize}
          fontFamily="Helvetica, Arial, sans-serif"
          fontWeight={700}
          fill={colour}
        >
          {layout.statusText}
        </text>
      ) : null}
    </g>
  );
}
