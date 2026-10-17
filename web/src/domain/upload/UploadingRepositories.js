import { AnnotationRepository } from '../ports/AnnotationRepository';
import { ChangeLogRepository } from '../ports/ChangeLogRepository';
import { ExportHistoryRepository } from '../ports/ExportHistoryRepository';
import { assertInstanceOf } from '../support/contracts';
import { BrowserUploadService } from './BrowserUploadService';

/**
 * Decorators that make the server stores upload browser-saved data before
 * they are first used.
 *
 * ===========================================================================
 * WHY DECORATORS
 * ===========================================================================
 * Every place that reads a sheet — the editor, the export, the working-copy
 * restore — would otherwise have to remember to call the uploader first, and
 * the one that forgot would show a sheet with its old markups missing. Wrapping
 * the stores instead means nothing that reads them knows the upload exists:
 * each of these is a real AnnotationRepository / ChangeLogRepository /
 * ExportHistoryRepository, swapped in by the composition root, and every call
 * waits for that sheet's (or document's) one-time upload before it runs.
 *
 * After the first call per sheet the wait is a resolved promise — the cost of
 * the decoration in steady state is one Map lookup.
 */

export class UploadingAnnotationRepository extends AnnotationRepository {
  /**
   * @param {AnnotationRepository} inner The server store.
   * @param {BrowserUploadService} uploads
   */
  constructor(inner, uploads) {
    super();
    assertInstanceOf(inner, AnnotationRepository, 'inner repository');
    assertInstanceOf(uploads, BrowserUploadService, 'uploads');
    this.inner = inner;
    this.uploads = uploads;
  }

  async listBySheet(sheetId) {
    await this.uploads.ensureSheet(sheetId);
    return this.inner.listBySheet(sheetId);
  }

  async save(annotation) {
    await this.uploads.ensureSheet(annotation.sheetId);
    return this.inner.save(annotation);
  }

  /**
   * By id alone, so there is no sheet to upload first. Every delete follows a
   * read of the sheet it is on, which has already done the upload.
   */
  async delete(id) {
    return this.inner.delete(id);
  }

  async clearSheet(sheetId) {
    await this.uploads.ensureSheet(sheetId);
    return this.inner.clearSheet(sheetId);
  }
}

export class UploadingChangeLogRepository extends ChangeLogRepository {
  /**
   * @param {ChangeLogRepository} inner The server store.
   * @param {BrowserUploadService} uploads
   */
  constructor(inner, uploads) {
    super();
    assertInstanceOf(inner, ChangeLogRepository, 'inner change log');
    assertInstanceOf(uploads, BrowserUploadService, 'uploads');
    this.inner = inner;
    this.uploads = uploads;
  }

  async record(change) {
    await this.uploads.ensureSheet(change.sheetId);
    return this.inner.record(change);
  }

  async listForAnnotation(sheetId, annotationId) {
    await this.uploads.ensureSheet(sheetId);
    return this.inner.listForAnnotation(sheetId, annotationId);
  }

  async latestBySheet(sheetId) {
    await this.uploads.ensureSheet(sheetId);
    return this.inner.latestBySheet(sheetId);
  }
}

export class UploadingExportHistoryRepository extends ExportHistoryRepository {
  /**
   * @param {ExportHistoryRepository} inner The server store.
   * @param {BrowserUploadService} uploads
   */
  constructor(inner, uploads) {
    super();
    assertInstanceOf(inner, ExportHistoryRepository, 'inner export history');
    assertInstanceOf(uploads, BrowserUploadService, 'uploads');
    this.inner = inner;
    this.uploads = uploads;
  }

  async record(exportRecord) {
    await this.uploads.ensureDocument(exportRecord.documentName, Object.keys(exportRecord.annotationIdsBySheet)[0]);
    return this.inner.record(exportRecord);
  }

  async listForDocument(documentName) {
    await this.uploads.ensureDocument(documentName);
    return this.inner.listForDocument(documentName);
  }

  /** The hot one: asked every time a sheet opens. Seals must arrive first. */
  async sealedIdsForSheet(documentName, sheetId) {
    await this.uploads.ensureDocument(documentName, sheetId);
    return this.inner.sealedIdsForSheet(documentName, sheetId);
  }
}
