import { Comment } from '../../domain/comments/Comment';
import { CommentRepository } from '../../domain/ports/CommentRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Comments kept by the Go API as change records (backend/comments.go).
 *
 *   POST /api/sheets/{sheet}/changes               { intent: 'comment', detail, replyTo }
 *   GET  /api/annotations/{id}/changes             the item's history; comments kept
 *   GET  /api/projects/{id}/comments/counts        { markup id: comments }
 */
export class HttpCommentRepository extends CommentRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   * @param {() => string} [newId] A fresh record id; injectable for tests.
   */
  constructor(baseUrl, fetchFn, newId = () => globalThis.crypto.randomUUID()) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
    this.newId = newId;
  }

  async listFor(annotationId) {
    const rows = await this.http.getJson(`/annotations/${HttpJsonClient.segment(annotationId)}/changes`);
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.intent === 'comment')
      .map((row) => {
        try {
          return Comment.fromRecord(row);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async post({ sheetId, annotationId, text, replyTo = '' }) {
    const record = {
      id: this.newId(),
      annotationId,
      sheetId,
      intent: 'comment',
      // Replaced by the server with whoever is signed in.
      actor: {},
      at: new Date().toISOString(),
      detail: String(text).trim(),
    };
    if (replyTo) record.replyTo = replyTo;
    await this.http.postJson(`/sheets/${HttpJsonClient.segment(sheetId)}/changes`, record);
  }

  async counts(projectId) {
    const byId = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/comments/counts`);
    return new Map(Object.entries(byId ?? {}).filter(([, count]) => Number.isInteger(count)));
  }
}
