import { ItemDetails } from '../details/ItemDetails';
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
 * The thing a user drops by tapping the
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
 *
 * ---------------------------------------------------------------------------
 * DETAILS — TRADE, COMPANY, ASSIGNEE, DUE DATE, AND WHATEVER COMES NEXT
 * ---------------------------------------------------------------------------
 * Everything recorded about the item beyond its description and status lives
 * in one `ItemDetails` value, whose fields are registered in `domain/details`.
 * Pin never names a field: it carries `details` through every copy and stores
 * it under `payload.details`, and that is all.
 *
 * HONEST NOTE ON THE ARCHITECTURE: adding `details` meant editing this class
 * once — the constructor, the three copy methods, and serialization. That was
 * the price of an extension point Pin did not have. It is paid once: every
 * field after the first four is a new file in `domain/details/fields` and one
 * registration line, with no change here.
 */
export class Pin extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint} position Anchor in PDF user space. NEVER screen pixels.
   * @param {string} label
   * @param {string} status One of PinStatus.
   * @param {Date} createdAt
   * @param {ItemDetails} [details] Trade, company, due date and so on. Optional
   *        so a new pin — and every caller written before details existed —
   *        starts with none.
   */
  constructor(id, sheetId, position, label, status, createdAt, details = ItemDetails.EMPTY) {
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

    assertInstanceOf(details, ItemDetails, 'Pin details');

    this.position = position;
    this.label = typeof label === 'string' ? label : '';
    this.status = status;
    this.details = details;
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

  /**
   * `details` is left out entirely when there are none, so a pin nobody has
   * assigned stores byte-for-byte what it stored before details existed — and
   * an older build reading it sees nothing new.
   *
   * @returns {Record<string, unknown>}
   */
  serializePayload() {
    const payload = { label: this.label, status: this.status };
    if (!this.details.isEmpty()) payload.details = this.details.toJSON();
    return payload;
  }

  /** Returns a copy with a new status. The original is untouched. */
  withStatus(status) {
    return new Pin(
      this.id, this.sheetId, this.position, this.label, status, this.createdAt, this.details,
    );
  }

  /** Returns a copy with a new label. The original is untouched. */
  withLabel(label) {
    return new Pin(
      this.id, this.sheetId, this.position, label, this.status, this.createdAt, this.details,
    );
  }

  /**
   * Returns a copy with one detail changed — `withDetail('trade', 'Drywall')`.
   *
   * Returns THIS pin, not a copy, when the cleaned value is what is already
   * stored. The panel relies on that to tell an edit from someone tabbing
   * through a field, so it records no undo step and no history for nothing.
   *
   * The capability the properties panel looks for: any annotation type that
   * implements `withDetail` and carries `details` gets the registered fields,
   * with no change to the panel.
   *
   * @param {string} key A key registered with ItemFieldRegistry.
   * @param {unknown} value As entered. Cleaned by the field; rejected with a
   *        RangeError if the field says it is invalid.
   * @returns {Pin}
   */
  withDetail(key, value) {
    const details = this.details.with(key, value);
    if (details === this.details) return this;

    return new Pin(
      this.id, this.sheetId, this.position, this.label, this.status, this.createdAt, details,
    );
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
    return new Pin(
      this.id, this.sheetId, position, this.label, this.status, this.createdAt, this.details,
    );
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
      // Absent on every pin saved before details existed, which reads as none.
      ItemDetails.fromJSON(payload.details),
    );
  }
}

// Self-registration. This is what lets AnnotationRegistry.fromJSON build a Pin
// without the repository layer ever importing this file. See AnnotationRegistry
// for the full rationale.
AnnotationRegistry.register(PIN_KIND, Pin.fromJSON);
