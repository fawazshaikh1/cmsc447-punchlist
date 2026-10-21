import { AnnotationRegistry } from '../annotations/AnnotationRegistry';
import { NullChangeLog } from '../audit/NullChangeLog';
import { documentNameOf } from '../documents/sheetNames';
import { EditPolicy } from '../policy/EditPolicy';
import { AnnotationRepository } from '../ports/AnnotationRepository';
import { ChangeLogRepository } from '../ports/ChangeLogRepository';
import { WorkingCopyReader } from '../ports/WorkingCopyReader';
import { SheetScope } from '../projects/SheetScope';
import { assertInstanceOf } from '../support/contracts';

/**
 * Opening a PDF: brings back the markups a working copy carries, as live,
 * selectable markups, before the drawing is shown.
 *
 * ===========================================================================
 * A RETURNED WORKING COPY IS THE SAME DRAWING
 * ===========================================================================
 * The working copy of `A-101.pdf` comes back from the architect as
 * `A-101-marked-up.pdf`. It is opened AS `A-101.pdf`: its pages are that
 * drawing's sheets, and its markups are the same markups, not copies of them.
 * So on the server the punch items everyone else sees are the ones on screen,
 * and an edit made here reaches them — rather than forking into a second set
 * of items under a second file name that only this person ever opens.
 *
 * Which drawing a file came from is read from its markups: each one carries
 * the sheet it was exported from. A file with none of our markups is its own
 * drawing, under its own name.
 *
 * A copy opened in a DIFFERENT project is a copy: its markups get ids of
 * their own there (the original id plus the project), so the two projects
 * never touch each other's items, and reopening the file again finds the
 * copies rather than making more.
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
   * @param {object} naming
   * @param {string} naming.fileName What the file is called on this device.
   * @param {(documentName: string, pageIndex: number) => string} naming.sheetIdFor
   *        How a page of a drawing is named here — scoped to the open project.
   * @returns {Promise<{ bytes: ArrayBuffer, restored: number, failed: number, documentName: string }>}
   *          The bytes to view and export from; how many markups became live;
   *          how many could not be (they stay in the file, read-only); and the
   *          drawing the file is — its own name, or the one it is a working
   *          copy of.
   */
  async open(bytes, { fileName, sheetIdFor }) {
    /** @type {Map<string, Set<string>>} ids already stored, per sheet */
    const stored = new Map();
    let restored = 0;
    let failed = 0;
    /** Settled by the first markup the file hands over: see the class comment. */
    let documentName = null;

    const storedOn = async (sheetId) => {
      if (!stored.has(sheetId)) {
        const existing = await this.repository.listBySheet(sheetId);
        stored.set(sheetId, new Set(existing.map((annotation) => annotation.id)));
      }
      return stored.get(sheetId);
    };

    try {
      const view = await this.reader.read(bytes, async ({ pageIndex, data }) => {
        // The first markup that names its drawing settles it for the rest; a
        // damaged one before it must not decide where everything goes.
        documentName ??= documentNameOf(data?.sheetId);
        const sheetId = sheetIdFor(documentName ?? fileName, pageIndex);

        // One markup that cannot be restored must not take the others down
        // with it: it stays in the file, drawn read-only, and is counted.
        try {
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
        } catch (error) {
          console.warn('[punchlist] Could not restore a markup from this file.', error);
          failed += 1;
          return false;
        }
      });

      return { bytes: view, restored, failed, documentName: documentName ?? fileName };
    } catch (error) {
      // The drawing still opens. Restoring markups is a convenience layered on
      // top of opening a file; a PDF the reader chokes on must not become a
      // PDF the user cannot look at.
      console.warn('[punchlist] Could not restore markups from this file.', error);
      return { bytes, restored, failed, documentName: documentName ?? fileName };
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
 * The stored shape, re-homed onto the sheet it opens on. Null for anything
 * that cannot be rebuilt — an unregistered kind, or data that fails a
 * constructor's checks — because a bad markup must not stop the good ones
 * loading.
 *
 * Re-homed into a different project, it is a copy, and gets an id of its own
 * there: ids are unique across a whole server, and the original still belongs
 * to the project it came from. The new id is derived, not random, so opening
 * the same file again finds the copy instead of making another.
 */
function rebuild(data, sheetId) {
  if (!data || typeof data !== 'object') return null;

  const from = SheetScope.projectOf(data.sheetId ?? '');
  const to = SheetScope.projectOf(sheetId);
  const id = from === to || typeof data.id !== 'string' ? data.id : `${data.id}~${to === null ? 'local' : `p${to}`}`;

  try {
    return AnnotationRegistry.tryFromJSON({ ...data, id, sheetId });
  } catch {
    return null;
  }
}
