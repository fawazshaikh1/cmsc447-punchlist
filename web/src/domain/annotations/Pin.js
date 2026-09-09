import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';
import { Annotation } from './Annotation';
import { AnnotationRegistry } from './AnnotationRegistry';

/** Discriminator for this annotation type. */
export const PIN_KIND = 'pin';

/**
 * Lifecycle of a punch item, using the vocabulary the trades actually use on
 * site. A frozen object rather than a bare set of string literals so the valid
 * values live in one place, and so they serialise as plain strings that match
 * the Go API and the Postgres column with no mapping table on either side.
 */
export const PinStatus = Object.freeze({
  OPEN: 'open',
  READY_FOR_REVIEW: 'ready_for_review',
  CLOSED: 'closed',
});

/** @param {unknown} value @returns {boolean} */
export function isPinStatus(value) {
  return Object.values(PinStatus).includes(value);
}

/**
 * A punch-list item pinned to a location on a drawing sheet.
 *
 * This is the SCRUM-19 deliverable: the thing a user drops by tapping the
 * sheet, whose position must survive zoom, pan, rotation, reload and export. It
 * does that by storing its anchor as a PdfPoint and nothing else — no scale
 * factor, no screen offset, no viewport state.
 *
 * ---------------------------------------------------------------------------
 * IMMUTABILITY
 * ---------------------------------------------------------------------------
 * Instances are frozen; `withStatus`, `withLabel` and `movedTo` return NEW pins
 * rather than mutating. Two reasons that genuinely matter here:
 *
 *   1. React re-renders on reference change, so immutable domain objects and
 *      React's rendering model agree by construction — no defensive copying in
 *      the presentation tier and no "why didn't the UI update" bugs.
 *   2. When offline sync arrives in Sprint 3, a change becomes a VALUE we can
 *      queue, replay and diff against the server's version. Mutable objects
 *      make that materially harder.
 */
export class Pin extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint} position Anchor in PDF user space. NEVER screen pixels.
   * @param {string} label
   * @param {string} status One of PinStatus.
   * @param {Date} createdAt
   */
  constructor(id, sheetId, position, label, status, createdAt) {
    super(id, sheetId, createdAt);

    // The guard that makes the coordinate-space rule real at runtime. Passing a
    // ViewportPoint here — the single most expensive mistake in this project —
    // throws immediately with a message naming both spaces, on the very first
    // click, rather than silently misplacing every pin on retina devices.
    assertInstanceOf(position, PdfPoint, 'Pin position', COORDINATE_SPACE_HINT);

    if (!isPinStatus(status)) {
      throw new RangeError(
        `Pin status must be one of ${Object.values(PinStatus).join(', ')}, received "${status}".`,
      );
    }

    this.position = position;
    this.label = typeof label === 'string' ? label : '';
    this.status = status;
    Object.freeze(this);
  }

  /** @returns {string} */
  getKind() {
    return PIN_KIND;
  }

  /** @returns {PdfPoint} */
  getAnchor() {
    return this.position;
  }

  /** @returns {Record<string, unknown>} */
  serializePayload() {
    return { label: this.label, status: this.status };
  }

  /** Returns a copy with a new status. The original is untouched. */
  withStatus(status) {
    return new Pin(this.id, this.sheetId, this.position, this.label, status, this.createdAt);
  }

  /** Returns a copy with a new label. The original is untouched. */
  withLabel(label) {
    return new Pin(this.id, this.sheetId, this.position, label, this.status, this.createdAt);
  }

  /**
   * Returns a copy moved to a new anchor.
   *
   * Not wired to any UI in Sprint 1 — pins are placed, not dragged — but present
   * because drag-to-reposition is a certainty, and this is the only correct way
   * to express it: it takes a PdfPoint, so a caller physically cannot hand it
   * raw screen pixels without tripping the guard.
   *
   * @param {PdfPoint} position
   * @returns {Pin}
   */
  movedTo(position) {
    return new Pin(this.id, this.sheetId, position, this.label, this.status, this.createdAt);
  }

  /** @param {number} dxPts @param {number} dyPts @returns {Pin} */
  movedBy(dxPts, dyPts) {
    return this.movedTo(new PdfPoint(this.position.x + dxPts, this.position.y + dyPts));
  }

  /**
   * Rebuilds a Pin from storage. Registered with AnnotationRegistry below.
   *
   * Note the defensive reads: `payload` comes off the wire, and the wire is not
   * trustworthy — a hand-edited localStorage row, an older client, or a status
   * value from a future build. We validate and fall back rather than throwing,
   * because one odd row is not a good reason to fail loading an entire sheet.
   *
   * @param {object} dto
   * @returns {Pin}
   */
  static fromJSON(dto) {
    const payload = dto.payload ?? {};
    return new Pin(
      dto.id,
      dto.sheetId,
      new PdfPoint(dto.x, dto.y),
      typeof payload.label === 'string' ? payload.label : '',
      isPinStatus(payload.status) ? payload.status : PinStatus.OPEN,
      new Date(dto.createdAt),
    );
  }
}

// Self-registration. This is what lets AnnotationRegistry.fromJSON build a Pin
// without the repository layer ever importing this file. See AnnotationRegistry
// for the full rationale.
AnnotationRegistry.register(PIN_KIND, Pin.fromJSON);
