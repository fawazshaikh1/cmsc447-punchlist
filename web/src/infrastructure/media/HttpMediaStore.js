import { MediaStore } from '../../domain/ports/MediaStore';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Photographs on the Go server (SCRUM-45). TIER 3.
 *
 *   PUT    /api/media/{key}?project=ID   body: the image
 *   GET    /api/media/{key}              -> the image | 404 | 403
 *   DELETE /api/media/{key}
 *
 * The key is made here, `photo_<uuid>` like the browser store's, so a photo
 * keeps the same key wherever it is stored — which is what lets a photo saved
 * in this browser before server mode be uploaded under the key its markup
 * already records (see UploadingMediaStore).
 *
 * The server keeps each photo with its project and checks, on every read,
 * that the person asking is on it. The project is the open one, asked for at
 * the moment of upload rather than fixed at construction, because the store
 * is made once and the project is chosen after signing in.
 */
export class HttpMediaStore extends MediaStore {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {object} options
   * @param {() => number|null} options.projectOf The open project's id.
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, { projectOf }, fetchFn) {
    super();
    if (typeof projectOf !== 'function') throw new TypeError('HttpMediaStore needs projectOf().');
    this.http = new HttpJsonClient(baseUrl, fetchFn);
    this.projectOf = projectOf;
  }

  async put(blob) {
    const key = `photo_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    await this.upload(key, blob);
    return key;
  }

  /**
   * Stores bytes under a key that already exists elsewhere — a photo saved in
   * this browser before it reached the server. Safe to repeat.
   *
   * @param {string} key
   * @param {Blob} blob
   */
  async upload(key, blob) {
    const projectId = this.projectOf();
    if (!projectId) throw new Error('Open a project before adding photos.');

    await this.http.request(`/media/${HttpJsonClient.segment(key)}?project=${HttpJsonClient.segment(projectId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
  }

  async get(key) {
    // Unknown, or on a project this person is not on: either way there is
    // no photo to show here, and the port promises null, not an error.
    const response = await this.http.request(`/media/${HttpJsonClient.segment(key)}`, {}, [403, 404]);
    if (!response.ok) return null;
    return response.blob();
  }

  async remove(key) {
    await this.http.request(`/media/${HttpJsonClient.segment(key)}`, { method: 'DELETE' }, [404]);
  }
}
