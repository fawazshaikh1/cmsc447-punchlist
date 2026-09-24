import { MediaRef } from '../../domain/media/MediaRef';

/** NFR-4: longest edge, in pixels, after downscaling. */
const MAX_EDGE = 1600;

/** JPEG quality. 0.82 is the knee — below it artefacts show on linework. */
const QUALITY = 0.82;

/**
 * Turns whatever the camera or file picker produced into something the app can
 * store and the PDF can embed.
 *
 * ===========================================================================
 * WHY EVERY IMAGE IS RE-ENCODED, EVEN AN ALREADY-SMALL JPEG
 * ===========================================================================
 * Three problems arrive with a photograph, and one pass solves all of them.
 *
 * 1. SIZE. A 12-megapixel iPhone photo is 3–5MB. NFR-4 caps the longest edge at
 *    1600px so a 200-item export stays openable — that is roughly a 90%
 *    reduction, and at the size a photo appears on a drawing it is invisible.
 *
 * 2. FORMAT. An iPhone hands you HEIC. A screenshot might be WebP. PDF can
 *    embed exactly two encodings, JPEG and PNG, so anything else has to be
 *    transcoded or it cannot reach the export at all. Drawing it to a canvas
 *    and re-encoding does that as a side effect.
 *
 * 3. ORIENTATION. A phone held sideways writes an EXIF rotation flag rather
 *    than rotating the pixels. `createImageBitmap` with `imageOrientation:
 *    'from-image'` bakes it in, so the photo is upright everywhere — including
 *    in the PDF, which has no concept of EXIF at all and would otherwise show
 *    every portrait shot on its side.
 *
 * The third is the one that would have been found at a demo rather than in
 * development, because a desktop file picker never produces it.
 */
export class CanvasImageProcessor {
  /**
   * @param {number} [maxEdge] Longest edge in pixels after downscaling.
   * @param {number} [quality] JPEG quality, 0–1.
   */
  constructor(maxEdge = MAX_EDGE, quality = QUALITY) {
    this.maxEdge = maxEdge;
    this.quality = quality;
  }

  /**
   * @param {Blob|File} input Whatever the camera or picker produced.
   * @returns {Promise<{ blob: Blob, width: number, height: number, mimeType: string }>}
   * @throws {Error} with a message written for the user, not the console.
   */
  async normalise(input) {
    if (!input || input.size === 0) {
      throw new Error('That file is empty.');
    }
    if (!input.type.startsWith('image/')) {
      throw new Error(`That is a ${input.type || 'unknown'} file, not an image.`);
    }

    const bitmap = await this.#decode(input);

    try {
      const { width, height } = this.#fit(bitmap.width, bitmap.height);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the image.');

      // White underneath, because JPEG has no alpha. Without this a PNG
      // screenshot with a transparent background comes out with black where the
      // transparency was — which on a white drawing looks like a printing fault.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', this.quality),
      );

      if (!blob) throw new Error('This browser could not compress the image.');

      return { blob, width, height, mimeType: 'image/jpeg' };
    } finally {
      // Bitmaps hold GPU memory until closed. On an iPad, capturing a dozen
      // photos without this is enough to have the tab killed.
      bitmap.close?.();
    }
  }

  /**
   * Stores a normalised image and returns the reference an annotation carries.
   *
   * Combined with `normalise` rather than left to the caller, because doing the
   * two separately invites storing the ORIGINAL by mistake — which would defeat
   * every reason the downscale exists.
   *
   * @param {Blob|File} input
   * @param {import('../../domain/ports/MediaStore').MediaStore} store
   * @returns {Promise<MediaRef>}
   */
  async storeAsRef(input, store) {
    const { blob, width, height, mimeType } = await this.normalise(input);
    const key = await store.put(blob);

    return new MediaRef({ key, mimeType, width, height, byteSize: blob.size });
  }

  // --- internals ----------------------------------------------------------

  async #decode(input) {
    try {
      // `from-image` applies the EXIF rotation. Without it, portrait phone
      // photos land sideways in the PDF — see the class comment.
      return await createImageBitmap(input, { imageOrientation: 'from-image' });
    } catch (cause) {
      // Safari has historically rejected the options bag rather than ignoring
      // it. Retry bare: an upright photo beats no photo.
      try {
        return await createImageBitmap(input);
      } catch {
        throw new Error(
          'This image could not be read. HEIC photos from an iPhone sometimes ' +
            'need to be shared as JPEG first.',
          { cause },
        );
      }
    }
  }

  /** Scales to fit the longest edge, never enlarging a small image. */
  #fit(width, height) {
    const longest = Math.max(width, height);
    if (longest <= this.maxEdge) return { width, height };

    const scale = this.maxEdge / longest;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }
}
