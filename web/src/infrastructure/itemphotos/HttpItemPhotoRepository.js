import { ItemPhoto } from '../../domain/itemphotos';
import { ItemPhotoRepository } from '../../domain/ports/ItemPhotoRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Item photos, from the Go API (backend/item_photos.go).
 *
 *   GET    /api/annotations/{id}/photos        [photo]
 *   POST   /api/annotations/{id}/photos        { id, media, caption }
 *   GET    /api/projects/{id}/item-photos      { item id: [photo] }
 *   DELETE /api/item-photos/{id}               (404 tolerated)
 */
export class HttpItemPhotoRepository extends ItemPhotoRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   * @param {() => string} [newId] A photo's id is chosen here, so sending it
   *        twice — a retry on a weak site connection — attaches it once.
   */
  constructor(baseUrl, fetchFn, newId = () => globalThis.crypto.randomUUID()) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
    this.newId = newId;
  }

  async listFor(annotationId) {
    const rows = await this.http.getJson(`/annotations/${HttpJsonClient.segment(annotationId)}/photos`);
    return (Array.isArray(rows) ? rows : []).map((row) => ItemPhoto.fromJSON(row)).filter(Boolean);
  }

  async listForProject(projectId) {
    const byItem = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/item-photos`);
    const photos = new Map();
    for (const [annotationId, rows] of Object.entries(byItem ?? {})) {
      const list = (Array.isArray(rows) ? rows : []).map((row) => ItemPhoto.fromJSON(row)).filter(Boolean);
      if (list.length > 0) photos.set(annotationId, list);
    }
    return photos;
  }

  async add({ annotation, media, caption = '' }) {
    const row = await this.http.sendJson('POST', `/annotations/${HttpJsonClient.segment(annotation.id)}/photos`, {
      id: this.newId(),
      media: media.toJSON(),
      caption: String(caption).trim(),
    });
    const photo = ItemPhoto.fromJSON(row);
    if (!photo) throw new Error('The photo was saved, but the server described it in a way this app cannot read.');
    return photo;
  }

  async remove(photo) {
    await this.http.request(`/item-photos/${HttpJsonClient.segment(photo.id)}`, { method: 'DELETE' }, [404]);
  }
}
