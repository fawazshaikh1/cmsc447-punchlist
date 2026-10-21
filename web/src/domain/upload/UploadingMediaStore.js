import { MediaStore } from '../ports/MediaStore';
import { assertInstanceOf } from '../support/contracts';

/**
 * Photos on the server, with this browser's older photos uploaded the first
 * time they are needed (SCRUM-45, SCRUM-54).
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Before the server kept photos, every photo lived in the browser that took
 * it. Its markup reached the server, but the picture did not — so a teammate
 * opening the sheet saw "This photo is not on this device", and an export
 * from any other device left the photo out. A broken tablet lost them all.
 *
 * Now new photos go straight to the server. And a photo the server does not
 * have, but this browser does, is uploaded under its existing key the first
 * time anything asks for it — opening the sheet is enough — so the photos
 * people already took migrate themselves, with no step for anyone to forget.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE SERVER CANNOT BE REACHED
 * ---------------------------------------------------------------------------
 * A photo this browser has is still shown from here: a dropped connection
 * should not blank out pictures sitting on the device. The upload is simply
 * tried again the next time.
 */
export class UploadingMediaStore extends MediaStore {
  /**
   * @param {MediaStore} server Must also offer `upload(key, blob)`.
   * @param {MediaStore} local This browser's store.
   */
  constructor(server, local) {
    super();
    assertInstanceOf(server, MediaStore, 'server media store');
    assertInstanceOf(local, MediaStore, 'local media store');
    if (typeof server.upload !== 'function') {
      throw new TypeError('The server media store must be able to upload under an existing key.');
    }
    this.server = server;
    this.local = local;
    /** @type {Set<string>} keys uploaded this session */
    this.uploaded = new Set();
  }

  async put(blob) {
    return this.server.put(blob);
  }

  async get(key) {
    let fromServer = null;
    let serverFailed = false;
    try {
      fromServer = await this.server.get(key);
    } catch {
      serverFailed = true;
    }
    if (fromServer) return fromServer;

    const here = await this.#local(key);
    if (here && !serverFailed && !this.uploaded.has(key)) {
      this.uploaded.add(key);
      try {
        await this.server.upload(key, here);
      } catch {
        // Not allowed here, or not now: the picture is still shown from this
        // device, and the next session tries again.
        this.uploaded.delete(key);
      }
    }
    return here;
  }

  async remove(key) {
    await this.server.remove(key);
  }

  async #local(key) {
    try {
      return await this.local.get(key);
    } catch {
      return null;
    }
  }
}
