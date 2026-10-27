import { ProjectRole } from '../projects/ProjectRole';

/**
 * Who may change a project's library (FR-10.4): only its admin adds or
 * deletes drawings — a drawing set is the project's record, not one person's.
 * Everyone on the project may open them.
 *
 * Wording for the interface, not security: the server refuses the change from
 * anyone else regardless (backend/documents.go).
 *
 * @param {string} role The person's role on the open project.
 * @returns {boolean}
 */
export function canChangeLibrary(role) {
  return role === ProjectRole.ADMIN;
}

/**
 * Whether a drawing that was just opened from this device should be offered
 * to the library.
 *
 * Only a drawing opened as itself: a returned working copy opens as the
 * drawing it was exported from (see WorkingCopyService), and its bytes are
 * not that drawing's — adding them would store a second, different file for
 * the same sheets.
 *
 * @param {{fileName: string|null, documentName: string|null}} opened
 * @returns {boolean}
 */
export function belongsInLibrary({ fileName, documentName }) {
  return Boolean(fileName) && fileName === documentName;
}
