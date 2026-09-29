import { ExportRecord } from '../export/ExportRecord';
import { AnnotationRuleRegistry } from '../rules';
import { StaticIdentityProvider } from '../identity/StaticIdentityProvider';
import { ExportHistoryRepository } from '../ports/ExportHistoryRepository';
import { IdGenerator } from '../ports/IdGenerator';
import { IdentityProvider } from '../ports/IdentityProvider';
import { SheetExporter } from '../ports/SheetExporter';
import { assertInstanceOf } from '../support/contracts';
import { AnnotationService } from './AnnotationService';

/**
 * Use case: produce a PDF of the whole drawing set with every markup embedded,
 * and write down that it happened.
 *
 * Sits above AnnotationService and SheetExporter and coordinates them. Kept
 * separate from AnnotationService because it is a genuinely different concern —
 * that class is about one sheet's annotations while a user is working, this one
 * is about the whole document at the moment of handover — and because export
 * will grow (a filter for open items only, a per-trade export, a summary page)
 * without that growth belonging in the editing path.
 *
 * ===========================================================================
 * THE EXPORT IS ALSO THE EVENT THAT CAN SEAL
 * ===========================================================================
 * Exporting flattened is the moment markups stop being a working note and
 * become a document someone else is holding. This service is the only place
 * that knows an export completed and exactly what went into it, so this is
 * where that fact is recorded.
 *
 * It does NOT decide whether to seal. It asks the exporter (`seals()`), because
 * sealing follows from how the markups reached the page and only the exporter
 * knows that. Adding a third export format later means writing an exporter that
 * answers the question for itself — nothing here changes.
 */
export class ExportService {
  /**
   * @param {AnnotationService} annotations
   * @param {SheetExporter} exporter
   * @param {ExportHistoryRepository} exportHistory
   * @param {IdGenerator} ids
   * @param {object} [options]
   * @param {IdentityProvider} [options.identity] Who is issuing the drawing.
   *        Anonymous until sign-in exists; the export record stores whatever it
   *        returns, so real names appear in Sprint 2 with no change here.
   * @param {() => string} [options.now] ISO-8601 clock. Injected so a test can
   *        assert on an exact timestamp instead of matching a pattern.
   */
  constructor(
    annotations,
    exporter,
    exportHistory,
    ids,
    { identity = new StaticIdentityProvider(), now = () => new Date().toISOString() } = {},
  ) {
    assertInstanceOf(annotations, AnnotationService, 'annotations');
    assertInstanceOf(exporter, SheetExporter, 'exporter');
    assertInstanceOf(exportHistory, ExportHistoryRepository, 'exportHistory');
    assertInstanceOf(ids, IdGenerator, 'ids');
    assertInstanceOf(identity, IdentityProvider, 'identity');

    this.annotations = annotations;
    this.exporter = exporter;
    this.exportHistory = exportHistory;
    this.ids = ids;
    this.identity = identity;
    this.now = now;
  }

  /**
   * Whether the file this service produces will make its markups permanent.
   *
   * Exposed so the interface can warn BEFORE the user commits, rather than
   * telling them afterwards. Delegates rather than deciding, for the reason in
   * the class comment.
   */
  seals() {
    return this.exporter.seals();
  }

  /**
   * Gathers every sheet's annotations, writes them into a copy of the original
   * PDF, and — if this export seals — records what was issued.
   *
   * @param {object} request
   * @param {ArrayBuffer} request.sourceBytes The original, unmodified PDF.
   * @param {number} request.pageCount
   * @param {(pageIndex: number) => string} request.sheetIdFor
   *        Maps a page index to its sheet id. Injected rather than assumed
   *        because the id scheme is a presentation concern today
   *        (`filename#pageIndex`) and becomes a database id in Sprint 2 —
   *        this service should not have to change when it does.
   * @param {string} [request.author] Shown as the annotation author in
   *        Acrobat. Defaults to whoever is signed in.
   * @param {string} request.documentName Which drawing set this is. The key the
   *        export history is filed under, so that reopening the same file finds
   *        its seals again.
   * @param {(done: number, total: number) => void} [request.onProgress]
   *        A 153-page set takes long enough that silence reads as a hang.
   * @returns {Promise<{ bytes: Uint8Array, annotatedPages: number, annotationCount: number, flattenedCount: number, flattenedPages: number, sealed: import('../export/ExportRecord').ExportRecord|null }>}
   */
  async exportDocument({
    sourceBytes,
    pageCount,
    sheetIdFor,
    author,
    documentName,
    onProgress,
  }) {
    const actor = this.identity.current();
    // An explicit author still wins, but the default is now the real answer to
    // "who made these marks" rather than a hardcoded product name.
    const attributedTo = author ?? actor.toString();
    const pages = [];
    const annotationIdsBySheet = {};
    let annotationCount = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const sheetId = sheetIdFor(pageIndex);
      const annotations = await this.annotations.listForSheet(sheetId);

      // Only pages that actually carry markups are passed on. On a 153-page set
      // where six sheets were marked, this keeps the exporter's work
      // proportional to the markup rather than to the document.
      if (annotations.length > 0) {
        pages.push({ pageIndex, annotations });
        annotationIdsBySheet[sheetId] = annotations.map((a) => a.id);
        annotationCount += annotations.length;
      }

      onProgress?.(pageIndex + 1, pageCount);
    }

    const produced = await this.exporter.exportAnnotated({
      sourceBytes,
      pages,
      author: attributedTo,
      // Passed through so an exporter can put the drawing set's name on
      // anything it generates. Optional in the contract, and ignored by the
      // native exporter, which adds no pages of its own.
      documentName,
    });

    // Either shape is valid — see SheetExporter. `flattenedCount` counts what
    // was burned into the page, which INCLUDES markups that were already in the
    // file and are therefore not in `annotationCount`.
    const reported = produced instanceof Uint8Array ? null : produced;
    const bytes = reported ? reported.bytes : produced;
    const flattenedCount = reported?.flattenedCount ?? 0;
    const flattenedPages = reported?.flattenedPages ?? 0;

    // ORDER MATTERS: the PDF is produced first, and only a successful export is
    // recorded. Sealing markups for a file that failed to build would lock work
    // the user never actually issued, and nothing in the product could unlock it.
    const sealed = await this.#recordExport({
      documentName,
      actor,
      annotationIdsBySheet,
      annotationCount,
    });

    return {
      bytes,
      annotatedPages: pages.length,
      annotationCount,
      flattenedCount,
      flattenedPages,
      sealed,
    };
  }

  /**
   * What an export WOULD contain, without producing anything.
   *
   * Exists so the confirmation dialog can say "31 markups on 4 sheets will
   * become permanent" instead of a vague warning. A number people recognise as
   * their own work is what makes a warning land; a generic one gets dismissed.
   *
   * Deliberately re-walks the sheets rather than caching a count. The count has
   * to be right at the moment of asking, and a stale one here would understate
   * what the user is about to freeze.
   *
   * @param {object} request
   * @param {number} request.pageCount
   * @param {(pageIndex: number) => string} request.sheetIdFor
   * @returns {Promise<{ annotationCount: number, sheetCount: number, incompleteCount: number }>}
   */
  async summarize({ pageCount, sheetIdFor }) {
    let annotationCount = 0;
    let sheetCount = 0;
    let incompleteCount = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const annotations = await this.annotations.listForSheet(sheetIdFor(pageIndex));
      if (annotations.length === 0) continue;

      sheetCount += 1;
      annotationCount += annotations.length;

      // Counted across the WHOLE set, not just the sheet on screen. A pin with
      // no description three sheets away is precisely the one that gets issued
      // by accident, because nobody is looking at it. New pins cannot be
      // incomplete, so in practice this catches work placed before the rule
      // existed — which is the work most likely to have been forgotten.
      incompleteCount += annotations.filter(
        (annotation) => !AnnotationRuleRegistry.isComplete(annotation),
      ).length;
    }

    return { annotationCount, sheetCount, incompleteCount };
  }

  /**
   * @param {string} documentName
   * @returns {Promise<import('../export/ExportRecord').ExportRecord[]>}
   *          Every past export of this drawing set, newest first.
   */
  async listHistory(documentName) {
    return this.exportHistory.listForDocument(documentName);
  }

  // --- internals ----------------------------------------------------------

  /**
   * Writes the export into the history, and returns it when it sealed anything.
   *
   * Native exports are recorded too, not just flattened ones. They seal
   * nothing, but "this set was exported as a working copy on Tuesday" is part
   * of the same audit story, and recording both means the history answers
   * "what has left this project?" rather than only "what is frozen?".
   */
  async #recordExport({ documentName, actor, annotationIdsBySheet, annotationCount }) {
    if (annotationCount === 0) return null;

    const record = new ExportRecord({
      id: this.ids.next(),
      documentName,
      mode: this.exporter.seals() ? ExportRecord.MODE.FLATTENED : ExportRecord.MODE.NATIVE,
      exportedAt: this.now(),
      // The actor's own description — "this device" today, "J. Rivera (Apex
      // Electrical)" once sign-in exists. Stored as a plain string so the
      // change adds nothing to this shape.
      exportedBy: actor.toString(),
      annotationIdsBySheet,
    });

    await this.exportHistory.record(record);

    return record.seals ? record : null;
  }
}
