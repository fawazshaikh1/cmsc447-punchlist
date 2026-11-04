import { SheetName } from '../../domain/sheets/SheetName';
import { SheetNames } from '../../domain/sheets/SheetNames';
import { SheetNameRepository } from '../../domain/ports/SheetNameRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Sheet names kept by the Go API (backend/sheet_names.go).
 *
 *   GET /api/projects/{id}/sheet-names           { drawing: [names] }
 *   PUT /api/projects/{id}/sheet-names/{drawing} { source, names } -> [names]
 */
export class HttpSheetNameRepository extends SheetNameRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async listForProject(projectId) {
    const byDrawing = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/sheet-names`);
    return new Map(Object.entries(byDrawing ?? {}).map(([drawing, rows]) => [drawing, namesFrom(rows)]));
  }

  async save(projectId, documentName, { source, names }) {
    const rows = await this.http.sendJson(
      'PUT',
      `/projects/${HttpJsonClient.segment(projectId)}/sheet-names/${HttpJsonClient.segment(documentName)}`,
      {
        source,
        // Only what the server stores; it decides the source of each row.
        names: names.map(({ pageIndex, number, title }) => ({ pageIndex, number, title })),
      },
    );
    return namesFrom(rows);
  }
}

/** @param {unknown} rows @returns {SheetNames} */
function namesFrom(rows) {
  return new SheetNames((Array.isArray(rows) ? rows : []).map((row) => SheetName.fromJSON(row)));
}
