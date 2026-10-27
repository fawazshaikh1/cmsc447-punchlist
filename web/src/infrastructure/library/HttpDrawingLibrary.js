import { LibraryDrawing } from '../../domain/library/LibraryDrawing';
import { DrawingLibrary } from '../../domain/ports/DrawingLibrary';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * A project's drawings, on the Go server. TIER 3.
 *
 *   GET    /api/projects/{id}/documents               -> 200 [drawing]
 *   POST   /api/projects/{id}/documents?name=…  PDF   -> 201 new | 200 already there | 409 name taken
 *   GET    /api/projects/{id}/documents/{docId}       -> the PDF
 *   DELETE /api/projects/{id}/documents/{docId}       -> 204
 *
 * See backend/documents.go. The bytes travel as the request body, not JSON:
 * a drawing set is tens of megabytes, and base64 would add a third to that.
 */
export class HttpDrawingLibrary extends DrawingLibrary {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  /** @param {number} projectId */
  #base(projectId) {
    return `/projects/${HttpJsonClient.segment(projectId)}/documents`;
  }

  async list(projectId) {
    const rows = await this.http.getJson(this.#base(projectId));
    return rows.map((dto) => LibraryDrawing.fromJSON(dto));
  }

  async add(projectId, name, pdf) {
    const response = await this.http.request(`${this.#base(projectId)}?name=${HttpJsonClient.segment(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    return LibraryDrawing.fromJSON(await response.json());
  }

  async open(projectId, drawing) {
    const response = await this.http.request(`${this.#base(projectId)}/${HttpJsonClient.segment(drawing.id)}`);
    return response.blob();
  }

  async remove(projectId, drawing) {
    await this.http.request(`${this.#base(projectId)}/${HttpJsonClient.segment(drawing.id)}`, {
      method: 'DELETE',
    });
  }
}
