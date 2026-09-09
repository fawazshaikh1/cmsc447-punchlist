import { PdfPoint } from '../geometry/PdfPoint';
import { enforceContract, abstractMethod, assertInstanceOf } from '../support/contracts';

/**
 * Base class for anything a user can place on a sheet.
 *
 * Sprint 1 ships exactly one subclass (Pin). Sprint 2 adds rectangle, cloud and
 * arrow markups. Those arrive as NEW FILES — nothing in this class, in the
 * repository layer, in the Go API, or in the database schema has to change to
 * accommodate them. That is the whole point of the design.
 *
 * ---------------------------------------------------------------------------
 * STORAGE SHAPE (see `toJSON`)
 * ---------------------------------------------------------------------------
 * Deliberately flat and primitive so it maps 1:1 onto a Postgres row and onto
 * the Go API's JSON, with no nested object graph to keep in sync across three
 * languages:
 *
 *     { id, sheetId, kind, createdAt, x, y, payload }
 *
 * `payload` is the extension point. Kind-specific fields live there, so a new
 * annotation type needs NO DATABASE MIGRATION — model it as `jsonb` in
 * Postgres. The fields every annotation shares (id, sheet, position, time) stay
 * as real indexed columns because we query and sort on them.
 *
 * INVARIANT: `getAnchor()` always returns a PdfPoint. A subclass that stores
 * screen pixels there has broken the application, so the constructor guard in
 * every subclass rejects anything else.
 */
export class Annotation {
  /** Methods a concrete annotation must provide. @see enforceContract */
  static REQUIRED = ['getKind', 'getAnchor', 'serializePayload', 'movedBy'];

  /**
   * @param {string} id       Client-generated. See IdGenerator for why.
   * @param {string} sheetId  The sheet this annotation belongs to.
   * @param {Date}   createdAt
   */
  constructor(id, sheetId, createdAt) {
    enforceContract(this, new.target, Annotation);

    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Annotation requires a non-empty string id.');
    }
    if (typeof sheetId !== 'string' || sheetId.length === 0) {
      throw new TypeError('Annotation requires a non-empty string sheetId.');
    }

    this.id = id;
    this.sheetId = sheetId;
    this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  }

  /**
   * Subtype discriminator, e.g. 'pin'. Must match the key this class registers
   * under in AnnotationRegistry.
   * @returns {string}
   */
  getKind() {
    return abstractMethod('Annotation', 'getKind');
  }

  /**
   * The single point this annotation hangs from, in PDF user space.
   *
   * For a pin this is the pin tip. For a rectangle it will be one corner, with
   * the extent carried in that subclass's own payload. Requiring one anchor on
   * every annotation lets generic code — sorting, culling to the visible
   * region, "jump to this item" — work without knowing the subtype.
   *
   * @returns {PdfPoint}
   */
  getAnchor() {
    return abstractMethod('Annotation', 'getAnchor');
  }

  /**
   * Kind-specific fields for the `payload` column.
   * @returns {Record<string, unknown>}
   */
  serializePayload() {
    return abstractMethod('Annotation', 'serializePayload');
  }

  /**
   * Returns a copy translated by a delta in PDF points.
   *
   * =========================================================================
   * WHY A DELTA RATHER THAN A NEW ANCHOR
   * =========================================================================
   * A pin has one point, a box has two, a freehand stroke has hundreds. There
   * is no single "new position" that means the same thing for all of them, but
   * "shift everything by this much" is unambiguous for every type — so the base
   * class can define drag-to-move once, generically, and the layer above never
   * needs to know what shape it is moving.
   *
   * HONEST NOTE ON THE ARCHITECTURE: this method was added AFTER the five
   * markup types existed, and adding it to `REQUIRED` meant implementing it in
   * four places (Pin, TwoPointMarkup, InkMarkup, TextMarkup). That is a real
   * cost and worth being straight about — the "new types are pure additions"
   * property only holds once the base contract is complete, and moving is
   * fundamental enough that it should have been there from the start.
   *
   * Every future markup type gets it for free, because the contract now says
   * so and `enforceContract` refuses a subclass that omits it.
   *
   * @param {number} dxPts
   * @param {number} dyPts Positive is UP — this is PDF user space.
   * @returns {Annotation} A new instance. The original is untouched.
   */
  movedBy(dxPts, dyPts) {
    return abstractMethod('Annotation', 'movedBy', dxPts, dyPts);
  }

  /**
   * Produces the storage/wire representation.
   *
   * NOT overridable in practice: subclasses customise only `serializePayload`,
   * so the shared envelope can never drift between annotation types. That is
   * what lets the repository and the Go API treat every annotation identically.
   *
   * @returns {{ id: string, sheetId: string, kind: string, createdAt: string,
   *             x: number, y: number, payload: Record<string, unknown> }}
   */
  toJSON() {
    const anchor = this.getAnchor();
    assertInstanceOf(anchor, PdfPoint, `${this.getKind()}.getAnchor() result`);

    return {
      id: this.id,
      sheetId: this.sheetId,
      kind: this.getKind(),
      // ISO string, not a Date object, so this survives a JSON round-trip
      // through localStorage and through the Go API unchanged.
      createdAt: this.createdAt.toISOString(),
      x: anchor.x,
      y: anchor.y,
      payload: this.serializePayload(),
    };
  }
}
