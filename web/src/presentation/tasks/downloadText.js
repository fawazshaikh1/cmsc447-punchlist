/**
 * Hands text to the browser as a file to save — the Tasks tab's CSV.
 *
 * The object URL is revoked a moment later rather than at once: revoking it
 * in the same tick as the click races the browser's own read of it (see the
 * same note in useExport).
 *
 * @param {string} text
 * @param {string} fileName
 * @param {string} type e.g. 'text/csv;charset=utf-8'
 */
export function downloadText(text, fileName, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
