/**
 * A pointer to a stored image, and everything about it EXCEPT the bytes.
 *
 * ===========================================================================
 * WHY THE BYTES ARE NOT IN HERE
 * ===========================================================================
 * An annotation's DTO goes to `localStorage`, which is about 5MB for the whole
 * origin — shared across every sheet of every drawing. One photo from an iPad
 * is 3 to 5MB before downscaling. Putting image data in the annotation would
 * blow that budget on the first photo of the first walk, and the failure would
 * arrive as a quota error in the middle of saving a punch item.
 *
 * So the annotation carries a KEY, and the bytes live in a MediaStore sized for
 * binary data. The annotation DTO stays a few hundred bytes whether it points
 * at a thumbnail or a 12-megapixel photograph.
 *
 * That split is also the Sprint 2 shape. NFR-5 says files live in S3 and are
 * never served from the application server, so the row in Postgres will hold an
 * S3 key and the browser will fetch the image directly with a pre-signed URL.
 * The key IS that key. Nothing about this class changes when the store moves.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DIMENSIONS ARE STORED
 * ---------------------------------------------------------------------------
 * The sheet has to lay a photo out before the image has loaded, and the PDF
 * writer has to size a rectangle without decoding anything. Both need the
 * aspect ratio up front. Reading it from the file each time would mean an async
 * decode inside a render and inside an export loop — so it is measured once, at
 * capture, and carried.
 */
export class MediaRef {
  /**
   * @param {object} fields
   * @param {string} fields.key Opaque handle the MediaStore understands.
   * @param {string} fields.mimeType e.g. 'image/jpeg'. Decides how pdf-lib
   *        embeds it, so it must be accurate rather than assumed.
   * @param {number} fields.width Pixel width AFTER downscaling.
   * @param {number} fields.height Pixel height after downscaling.
   * @param {number} [fields.byteSize] For showing the user what an export will
   *        cost them before they commit to it.
   */
  constructor({ key, mimeType, width, height, byteSize = 0 }) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('MediaRef requires a non-empty string key.');
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new RangeError(
        `MediaRef requires positive finite dimensions — received ${width}x${height}.`,
      );
    }

    this.key = key;
    this.mimeType = mimeType;
    this.width = width;
    this.height = height;
    this.byteSize = byteSize;
    Object.freeze(this);
  }

  /** Height divided by width. The one number layout and export both need. */
  get aspectRatio() {
    return this.height / this.width;
  }

  /**
   * Whether pdf-lib can embed this directly.
   *
   * PDF supports exactly two image encodings without transcoding: JPEG (DCT)
   * and PNG (Flate). A HEIC straight off an iPhone is neither, which is why the
   * capture path re-encodes everything to JPEG rather than trusting the file it
   * was handed.
   */
  get isEmbeddable() {
    return this.mimeType === 'image/jpeg' || this.mimeType === 'image/png';
  }

  toJSON() {
    return {
      key: this.key,
      mimeType: this.mimeType,
      width: this.width,
      height: this.height,
      byteSize: this.byteSize,
    };
  }

  /** @param {ReturnType<MediaRef['toJSON']>} dto */
  static fromJSON(dto) {
    return new MediaRef(dto);
  }
}
