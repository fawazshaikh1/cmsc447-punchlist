import { PIN_KIND, PinStatus } from '../../../domain/annotations';
import { MarkerRegistry } from './MarkerRegistry';
import { PinLabel } from './PinLabel';

/** Trade-standard colour language: red open, amber pending, green closed. */
const STATUS_COLOUR = {
  [PinStatus.OPEN]: '#e8342a',
  [PinStatus.READY_FOR_REVIEW]: '#e2960b',
  [PinStatus.CLOSED]: '#1f9d4d',
};

const RADIUS = 11;

/**
 * The status wording on the label. Must match STATUS_TAG in pinWriter — the
 * canvas and the export are meant to show the same words, and this is the one
 * string the shared layout module cannot supply, because how a status READS is
 * a presentation choice while the layout is a geometric one.
 */
const STATUS_TAG = {
  [PinStatus.OPEN]: 'OPEN',
  [PinStatus.READY_FOR_REVIEW]: 'READY FOR REVIEW',
  [PinStatus.CLOSED]: 'CLOSED',
};

/**
 * Draws a punch-item pin.
 *
 * ---------------------------------------------------------------------------
 * NOTE THE UNITS
 * ---------------------------------------------------------------------------
 * `x` and `y` arrive in the OVERLAY'S SVG coordinate space, which is PDF points
 * with the Y axis flipped and rotation already applied. The radius is therefore
 * also in PDF points — deliberate, because it means the pin scales with the
 * drawing as the user zooms, staying constant relative to the SHEET rather than
 * to the screen. That matches how a physical markup behaves.
 *
 * If a later requirement wants constant on-screen size instead ("pins must stay
 * tappable when zoomed right out"), that is a change to THIS COMPONENT ALONE:
 * divide RADIUS by the current scale. No other file needs to know.
 *
 * @param {object} props
 * @param {import('../../../domain/annotations/Pin').Pin} props.annotation
 * @param {number} props.x
 * @param {number} props.y
 * @param {number} props.ordinal 1-based display number.
 * @param {boolean} props.isSelected
 * @param {(annotation: object) => void} props.onSelect
 */
function PinMarker({ annotation: pin, x, y, ordinal, isSelected, onSelect }) {
  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Punch item ${ordinal}${pin.label ? `: ${pin.label}` : ''}, status ${pin.status}`}
      onClick={(event) => {
        // Without this, the click ALSO reaches the overlay's own handler and
        // immediately drops a second pin underneath the one being selected.
        event.stopPropagation();
        onSelect(pin);
      }}
    >
      {/*
        Drawn BEFORE the circle so the pin sits on top of the leader line
        rather than having it run across the disc — the same order pinWriter
        uses, for the same reason.
      */}
      <PinLabel
        description={pin.label}
        status={STATUS_TAG[pin.status] ?? pin.status}
        colour={STATUS_COLOUR[pin.status]}
      />

      <circle
        r={RADIUS}
        fill={STATUS_COLOUR[pin.status]}
        fillOpacity={0.9}
        stroke={isSelected ? '#111' : '#fff'}
        strokeWidth={isSelected ? 3 : 2}
      />
      <text
        y={RADIUS * 0.35}
        textAnchor="middle"
        fontSize={RADIUS}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        fill="#fff"
        // The marker is one click target; the label must not swallow the event
        // or become separately selectable text.
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {ordinal}
      </text>
    </g>
  );
}

// Self-registration, mirroring how Pin registers with AnnotationRegistry.
MarkerRegistry.register(PIN_KIND, PinMarker);

export { PinMarker };
