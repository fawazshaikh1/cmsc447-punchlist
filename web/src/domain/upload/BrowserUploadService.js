import { AnnotationRegistry } from '../annotations/AnnotationRegistry';
import { ChangeRecord } from '../audit/ChangeRecord';
import { ExportRecord } from '../export/ExportRecord';
import { Actor } from '../identity/Actor';
import { EditNotPermittedError } from '../policy/EditNotPermittedError';
import { EditPolicy } from '../policy/EditPolicy';
import { SheetScope } from '../projects/SheetScope';
import { AnnotationRepository } from '../ports/AnnotationRepository';
import { ChangeLogRepository } from '../ports/ChangeLogRepository';
import { ExportHistoryRepository } from '../ports/ExportHistoryRepository';
import { UploadLedger } from '../ports/UploadLedger';
import { assertInstanceOf } from '../support/contracts';

/**
 * @typedef {object} Stores
 * @property {AnnotationRepository} annotations
 * @property {ChangeLogRepository} changeLog
 * @property {ExportHistoryRepository} exports
 */

/**
 * Copies what a browser saved locally up to the server, once, the first time
 * server mode touches it.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Until SCRUM-41 every markup lived in the browser that drew it. Switching the
 * app to the server would otherwise make all of that work vanish from view —
 * still in the browser, but never read again. So each sheet's markups and
 * history, and each document's export records, are uploaded the first time
 * they are needed, and the browser copy is left in place as a backup.
 *
 * ===========================================================================
 * WHICH COPY WINS
 * ===========================================================================
 *   markup already on the server     the server's. It may have been edited
 *                                    there since — by this user on another
 *                                    device, or by a teammate.
 *   markup deleted on the server     stays deleted. The server's history
 *                                    records the delete.
 *   history and export records       always sent. Both are append-only and
 *                                    the server ignores an id it already has,
 *                                    so sending one twice is harmless.
 *
 * An issued markup stays issued: its export record is uploaded before the
 * server is asked which markups are sealed (see the Uploading* decorators,
 * which call in here before every read).
 *
 * ---------------------------------------------------------------------------
 * ONCE, AND ONLY ONCE AT A TIME
 * ---------------------------------------------------------------------------
 * A sheet opening reads its markups, its history and its seals at the same
 * moment. All three ask for the same upload, so the work is shared: the first
 * caller starts it and the others wait on the same promise. A finished upload
 * is recorded in the ledger so later sessions skip it. A failed one is NOT
 * recorded and is tried again on the next read.
 */
export class BrowserUploadService {
  /**
   * @param {object} deps
   * @param {Stores} deps.local Where the browser saved things.
   * @param {Stores} deps.server Where they are going. Must be the UNDECORATED
   *        server stores — the uploader writes through these directly.
   * @param {UploadLedger} deps.ledger
   */
  constructor({ local, server, ledger }) {
    for (const [side, stores] of [['local', local], ['server', server]]) {
      assertInstanceOf(stores?.annotations, AnnotationRepository, `${side}.annotations`);
      assertInstanceOf(stores?.changeLog, ChangeLogRepository, `${side}.changeLog`);
      assertInstanceOf(stores?.exports, ExportHistoryRepository, `${side}.exports`);
    }
    assertInstanceOf(ledger, UploadLedger, 'ledger');

    this.local = local;
    this.server = server;
    this.ledger = ledger;

    /** @type {Map<string, Promise<number>>} uploads in flight or done this session */
    this.inFlight = new Map();
  }

  /**
   * Makes sure this sheet's browser-saved markups and history are on the
   * server. Resolves with how many markups were uploaded (0 after the first
   * time).
   *
   * @param {string} sheetId
   * @returns {Promise<number>}
   */
  ensureSheet(sheetId) {
    // Keyed by the BARE id — what the browser filed it under — so a drawing's
    // browser markups go up once, into the first project that opens it, and
    // are not copied again into every other project with the same file.
    return this.#once(`sheet:${SheetScope.localIdOf(sheetId)}`, () => this.#uploadSheet(sheetId));
  }

  /**
   * Makes sure this document's browser-saved export records are on the
   * server — which is what keeps a markup issued from this browser locked.
   *
   * @param {string} documentName
   * @param {string} [sheetId] Any sheet of the document as the server names
   *        it — which says which project the records belong in.
   * @returns {Promise<number>} How many export records were sent.
   */
  ensureDocument(documentName, sheetId) {
    const scope = sheetId ? scopeOf(sheetId) : SheetScope.NONE;
    return this.#once(`document:${documentName}`, () => this.#uploadDocument(documentName, scope));
  }

  #once(key, work) {
    if (this.ledger.has(key)) return Promise.resolve(0);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const started = (async () => {
      try {
        const count = await work();
        this.ledger.add(key);
        return count;
      } catch (error) {
        // REFUSED is not FAILED. The signed-in person's role does not let
        // them write what this browser holds — a collaborator cannot add a
        // pin — and asking again will not change that. The read goes ahead,
        // nothing is recorded, and a later session (the project's admin, on
        // this browser) uploads it.
        if (error instanceof EditNotPermittedError) return 0;
        throw error;
      }
    })();

    this.inFlight.set(key, started);
    // A failure is forgotten so the next read tries again, rather than this
    // session believing it is done.
    started.catch(() => this.inFlight.delete(key));
    return started;
  }

  async #uploadSheet(sheetId) {
    // The browser filed everything under the bare id; the server wants it
    // under the project's. See SheetScope.
    const localId = SheetScope.localIdOf(sheetId);
    const local = (await this.local.annotations.listBySheet(localId)).map((a) => onSheet(a, sheetId));
    const localHistory = await this.local.changeLog.latestBySheet(localId);
    if (local.length === 0 && localHistory.size === 0) return 0;

    const onServer = new Set((await this.server.annotations.listBySheet(sheetId)).map((a) => a.id));

    let uploaded = 0;
    for (const annotation of local) {
      if (onServer.has(annotation.id)) continue;
      if (await this.#deletedOnServer(sheetId, annotation.id)) continue;

      await this.server.annotations.save(annotation);
      uploaded += 1;
    }

    // History for every markup this browser knows about — including ones
    // deleted here, whose last record is the delete itself.
    const ids = new Set([...local.map((a) => a.id), ...localHistory.keys()]);
    for (const id of ids) {
      const records = await this.local.changeLog.listForAnnotation(localId, id);
      // Oldest first, so a server that orders by arrival still reads in order.
      for (const record of [...records].reverse()) {
        await this.server.changeLog.record(changeOnSheet(record, sheetId));
      }
    }

    return uploaded;
  }

  async #uploadDocument(documentName, scope) {
    const records = await this.local.exports.listForDocument(documentName);
    for (const record of [...records].reverse()) await this.server.exports.record(exportInScope(record, scope));
    return records.length;
  }

  async #deletedOnServer(sheetId, annotationId) {
    const history = await this.server.changeLog.listForAnnotation(sheetId, annotationId);
    return history.some((record) => record.intent === EditPolicy.INTENT.DELETE);
  }
}

// --- moving browser records into a project ----------------------------------
// Each returns the record unchanged when nothing needs to move, which is
// always the case without projects.

/** @param {string} sheetId */
function scopeOf(sheetId) {
  const projectId = SheetScope.projectOf(sheetId);
  return projectId === null ? SheetScope.NONE : SheetScope.forProject(projectId);
}

function onSheet(annotation, sheetId) {
  if (annotation.sheetId === sheetId) return annotation;
  return AnnotationRegistry.fromJSON({ ...annotation.toJSON(), sheetId });
}

function changeOnSheet(record, sheetId) {
  if (record.sheetId === sheetId) return record;
  return ChangeRecord.fromJSON({ ...record.toJSON(), sheetId }, Actor);
}

/** An export's sheets, renamed into the project. */
function exportInScope(record, scope) {
  if (scope.projectId === null) return record;
  const dto = record.toJSON();
  const bySheet = Object.fromEntries(
    Object.entries(dto.annotationIdsBySheet).map(([id, ids]) => [scope.qualify(SheetScope.localIdOf(id)), ids]),
  );
  return ExportRecord.fromJSON({ ...dto, annotationIdsBySheet: bySheet });
}
