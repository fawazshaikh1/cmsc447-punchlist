import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — where image bytes live.
 *
 * ===========================================================================
 * A SEPARATE STORE, NOT A COLUMN
 * ===========================================================================
 * Annotations and photographs have nothing in common operationally. An
 * annotation is a few hundred bytes of JSON, read on every sheet open, edited
 * all day. A photograph is megabytes of opaque binary, written once and read
 * only when someone looks at it.
 *
 * Keeping them in one store would mean the worst of both: the annotation reads
 * drag image data along with them, and the image writes fight for the same
 * quota. So they are two ports, and each gets an implementation suited to what
 * it holds.
 *
 * ---------------------------------------------------------------------------
 * THE SPRINT 2 SWAP THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 *     - new IndexedDbMediaStore()
 *     + new S3MediaStore('/api')
 *
 * NFR-5 requires that files live in S3 and never pass through the application
 * server. `S3MediaStore` is written against this contract and unwired, the same
 * arrangement as HttpAnnotationRepository and SessionIdentityProvider.
 *
 * ---------------------------------------------------------------------------
 * WHY `get` RETURNS A BLOB AND NOT A URL
 * ---------------------------------------------------------------------------
 * A URL is a presentation concern with a lifetime — an object URL has to be
 * revoked or it leaks, and a pre-signed S3 URL expires. The domain should not
 * have to know which kind it is holding or when it goes stale.
 *
 * A Blob is just bytes. The presentation layer turns it into a URL and owns
 * revoking it; the exporter turns it into an ArrayBuffer. Neither has to change
 * when the store moves to S3.
 */
export class MediaStore {
  static REQUIRED = ['put', 'get', 'remove'];

  constructor() {
    enforceContract(this, new.target, MediaStore);
  }

  /**
   * Stores bytes and returns the key that gets them back.
   *
   * The store chooses the key, not the caller. An S3 implementation wants a
   * path it controls; a local one wants a UUID. A caller that invented keys
   * would constrain both.
   *
   * @param {Blob} blob
   * @returns {Promise<string>} the key
   */
  async put(blob) {
    return abstractMethod('MediaStore', 'put', blob);
  }

  /**
   * @param {string} key
   * @returns {Promise<Blob|null>} null when the key is unknown — a missing
   *          photo must render as a placeholder, not throw during a render.
   */
  async get(key) {
    return abstractMethod('MediaStore', 'get', key);
  }

  /**
   * @param {string} key
   * @returns {Promise<void>} Deleting an unknown key succeeds quietly; the
   *          caller's intent is "make sure this is gone".
   */
  async remove(key) {
    return abstractMethod('MediaStore', 'remove', key);
  }
}
