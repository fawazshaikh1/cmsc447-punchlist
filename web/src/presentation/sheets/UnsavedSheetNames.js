import { SheetName } from '../../domain/sheets';

/**
 * Sheet names read from a drawing that the server has not taken yet.
 *
 * An admin who opens a new drawing from their device starts two things at
 * once: the PDF uploads to the project's library, and its title blocks are
 * read. Reading a few pages can finish first, and the server refuses names
 * for a drawing it does not have yet. Dropping them then meant nobody saw
 * the names until another session read the drawing again.
 *
 * So a refused save is shown anyway — the names are true, only not yet
 * shared — and owed: `retry` saves them once the drawing has reached the
 * library. A power collaborator's drawing kept on their device is never
 * added, so theirs stay owed and on their screen for the session, which is
 * all that can be done with them.
 *
 * No React here, so the rule is checked in Node (verify-sheet-names).
 */
export class UnsavedSheetNames {
  /** @type {Map<string, { projectId: number|string, documentName: string, names: SheetName[] }>} */
  #owed = new Map();

  /**
   * Saves names read from a drawing, or keeps them owed when the server
   * will not take them yet.
   *
   * @param {import('../../domain/ports/SheetNameRepository').SheetNameRepository} repository
   * @param {object} reading
   * @param {number|string} reading.projectId
   * @param {string} reading.documentName
   * @param {import('../../domain/sheets').SheetNames} reading.known What the
   *        drawing's sheets were already called.
   * @param {SheetName[]} reading.names What was read, for pages without a name.
   * @returns {Promise<import('../../domain/sheets').SheetNames>} What the sheets
   *          are called now: as the server saved them, or, while it will not,
   *          as read.
   */
  async save(repository, { projectId, documentName, known, names }) {
    const key = keyOf(projectId, documentName);
    try {
      const saved = await repository.save(projectId, documentName, { source: SheetName.SOURCE.DETECTED, names });
      this.#owed.delete(key);
      return saved;
    } catch {
      this.#owed.set(key, { projectId, documentName, names });
      return known.withDetected(names);
    }
  }

  /**
   * Tries again every save still owed in this project. One the server still
   * refuses stays owed.
   *
   * @param {import('../../domain/ports/SheetNameRepository').SheetNameRepository} repository
   * @param {number|string} projectId
   * @returns {Promise<Array<[string, import('../../domain/sheets').SheetNames]>>}
   *          Each drawing whose names were saved now, with what the server
   *          says its sheets are called.
   */
  async retry(repository, projectId) {
    const saved = [];
    for (const [key, owed] of [...this.#owed]) {
      if (owed.projectId !== projectId) continue;
      try {
        const names = await repository.save(projectId, owed.documentName, {
          source: SheetName.SOURCE.DETECTED,
          names: owed.names,
        });
        this.#owed.delete(key);
        saved.push([owed.documentName, names]);
      } catch {
        // Still refused — owed until the next try.
      }
    }
    return saved;
  }
}

function keyOf(projectId, documentName) {
  return `${projectId}:${documentName}`;
}
