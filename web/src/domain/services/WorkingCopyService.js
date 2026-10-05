import { AnnotationRegistry } from '../annotations/AnnotationRegistry';
import { NullChangeLog } from '../audit/NullChangeLog';
import { EditPolicy } from '../policy/EditPolicy';
import { AnnotationRepository } from '../ports/AnnotationRepository';
import { ChangeLogRepository } from '../ports/ChangeLogRepository';
import { WorkingCopyReader } from '../ports/WorkingCopyReader';
import { assertInstanceOf } from '../support/contracts';

/**
 * Opening a PDF: brings back the markups a working copy carries, as live,
 * selectable markups, before the drawing is shown.
 *
 * ===========================================================================
 * WHICH COPY WINS
 * ===========================================================================
 * A markup can exist twice — once in the file, once in this browser's storage
 * from an earlier session with the same file. Each one embedded in the file is
 * decided on its own, by its id:
 *
 *   already stored on this sheet   the stored one wins: it is the newer, and
 *                                  the user may have edited it since. The
 *                                  file's copy is taken out so it is not drawn
 *                                  underneath, out of date.
 *   deleted on this sheet          stays deleted. Reopening a file must not
 *                                  resurrect what somebody removed.
 *   new to this device             restored — a teammate's working copy opens
 *                                  editable, not just the user's own.
 *   cannot be rebuilt              left in the file, untouched: an unknown
 *                                  kind from a newer build, or junk. It shows
 *                                  read-only like any comment we did not write,
 *                                  and it survives the next export.
 *   a photo whose image is not     left in the file too. The picture lives in
 *   on this device                 that annotation's appearance; taking it out
 *                                  for a markup that would export as a "photo
 *                                  missing" placeholder would destroy it.
 *
 * Restored markups are written straight to the repository rather than through
 * EditorService: opening a file is not an edit. There is nothing for the user
 * to undo, no policy to ask, and no history to write.
 */
export class WorkingCopyService {
  /**
   * @param {WorkingCopyReader} reader
   * @param {AnnotationRepository} repository
   * @param {object} [options]
   * @param {ChangeLogRepository} [options.changeLog] Where deletions are
   *        remembered. Without one, nothing counts as deleted.
   * @param {{ get(key: string): Promise<Blob|null> }} [options.media] Checked
   *        before a photo is restored. Without one, no photo is restored —
   *        leaving it in the file is the choice that cannot lose it.
   */
  constructor(reader, repository, { changeLog = new NullChangeLog(), media = null } = {}) {
    assertInstanceOf(reader, WorkingCopyReader, 'reader');
    assertInstanceOf(repository, AnnotationRepository, 'repository');
    assertInstanceOf(changeLog, ChangeLogRepository, 'changeLog');

    this.reader = reader;
    this.repository = repository;
    this.changeLog = changeLog;
    this.media = media;
  }

  /**
   * @param {ArrayBuffer} bytes The PDF as the user opened it.
   * @param {(pageIndex: number) => string} sheetIdFor The id each page has in
   *        THIS file — never the id it had in the file it was exported from.
   * @returns {Promise<{ bytes: ArrayBuffer, restored: number }>} The bytes to
   *          view and export from, and how many markups became live.
   */
  async open(bytes, sheetIdFor) {
    /** @type {Map<string, Set<string>>} ids already stored, per sheet */
    const stored = new Map();
    let restored = 0;

    const storedOn = async (sheetId) => {
      if (!stored.has(sheetId)) {
        const existing = await this.repository.listBySheet(sheetId);
        stored.set(sheetId, new Set(existing.map((annotation) => annotation.id)));
      }
      return stored.get(sheetId);
    };

    try {
      const view = await this.reader.read(bytes, async ({ pageIndex, data }) => {
        const sheetId = sheetIdFor(pageIndex);
        const annotation = rebuild(data, sheetId);
        if (!annotation) return false;

        const ids = await storedOn(sheetId);
        if (ids.has(annotation.id)) return true;
        if (await this.#wasDeleted(sheetId, annotation.id)) return true;
        if (!(await this.#hasItsMedia(annotation))) return false;

        await this.repository.save(annotation);
        ids.add(annotation.id);
        restored += 1;
        return true;
      });

      return { bytes: view, restored };
    } catch (error) {
      // The drawing still opens. Restoring markups is a convenience layered on
      // top of opening a file; a PDF the reader chokes on must not become a
      // PDF the user cannot look at.
      console.warn('[punchlist] Could not restore markups from this file.', error);
      return { bytes, restored };
    }
  }

  async #wasDeleted(sheetId, annotationId) {
    const history = await this.changeLog.listForAnnotation(sheetId, annotationId);
    return history.some((record) => record.intent === EditPolicy.INTENT.DELETE);
  }

  /** A capability check, like the panel's: anything carrying `media` has bytes to find. */
  async #hasItsMedia(annotation) {
    const key = annotation.media?.key;
    if (!key) return true;
    if (!this.media) return false;

    try {
      return Boolean(await this.media.get(key));
    } catch {
      return false;
    }
  }
}

/**
 * The stored shape, re-homed onto this file's sheet. Null for anything that
 * cannot be rebuilt — an unregistered kind, or data that fails a constructor's
 * checks — because a bad markup must not stop the good ones loading.
 */
function rebuild(data, sheetId) {
  if (!data || typeof data !== 'object') return null;

  try {
    return AnnotationRegistry.tryFromJSON({ ...data, sheetId });
  } catch {
    return null;
  }
}
