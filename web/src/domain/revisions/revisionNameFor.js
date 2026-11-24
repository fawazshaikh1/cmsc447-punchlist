/**
 * The name a revised drawing is stored under (SCRUM-90).
 *
 * Its own file name when that is free — "Set rev B.pdf" says what it is.
 * Revisions often arrive under the SAME name as the set they replace, though,
 * and a project's drawings are told apart by name (sheet ids are built from
 * it), so a taken name becomes "Set (rev 2).pdf", or the next number free.
 *
 * @param {string} fileName As the file arrived.
 * @param {string[]} takenNames Every drawing name already in the project.
 * @returns {string}
 */
export function revisionNameFor(fileName, takenNames) {
  const taken = new Set(takenNames);
  if (!taken.has(fileName)) return fileName;

  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base} (rev ${n})${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}
