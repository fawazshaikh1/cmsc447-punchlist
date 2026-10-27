import { useCallback, useState } from 'react';

import { belongsInLibrary, canChangeLibrary } from '../../domain/library';
import { useServices } from '../ServiceContainer';
import { useSession } from '../session/useSession';

const IDLE = Object.freeze({ busy: null, notice: null, error: null });

/**
 * Opening drawings through the project's library (FR-10).
 *
 * Two ways in, one way the drawing is then handled:
 *
 *   from this device   `openFromDisk(file)` — the drawing opens at once, and
 *                      an admin's copy is then saved to the project, so the
 *                      next person (or the next device) opens it from the list
 *   from the library   `openFromLibrary(drawing)` — the PDF is fetched and
 *                      opened exactly as if it had been picked from disk, so
 *                      its sheets, markups and seals are the ones already made
 *
 * The save happens AFTER the drawing has opened, from what useSheetDocument
 * says it opened: a file pdf.js cannot read never reaches the server, and a
 * working copy (which opens as the drawing it came from) is not stored as
 * that drawing — see belongsInLibrary.
 *
 * Does nothing extra in browser mode, where there is no project to keep
 * drawings in: `openFromDisk` is then just `openFile`.
 *
 * @param {object} options
 * @param {(file: File) => Promise<{fileName: string, documentName: string, sourceFile: File}|null>} options.openFile
 *        useSheetDocument's.
 */
export function useLibrary({ openFile }) {
  const { library } = useServices();
  const { project } = useSession();
  const active = Boolean(library && project);

  /** Bumped whenever the library changes here, so lists showing it re-read. */
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState(IDLE);

  /**
   * Saves a drawing just opened from this device to the project — or, for
   * someone who may not, says it stays on this device.
   */
  const offer = useCallback(
    async ({ fileName, documentName, sourceFile }) => {
      if (!canChangeLibrary(project.role)) {
        setStatus({
          ...IDLE,
          notice:
            `${fileName} is open on this device only. A project admin can add it to ${project.name} ` +
            'so everyone on the project can open it.',
        });
        return;
      }
      setStatus({ ...IDLE, busy: `Saving ${fileName} to ${project.name}…` });
      try {
        const drawing = await library.add(project.id, documentName, sourceFile);
        setStatus({
          ...IDLE,
          notice: `${drawing.name} is saved to ${project.name}. Anyone on the project can open it from Drawings, on any device.`,
        });
        setVersion((v) => v + 1);
      } catch (cause) {
        setStatus({ ...IDLE, error: `${fileName} is open, but was not saved to the project: ${messageOf(cause)}` });
      }
    },
    [library, project],
  );

  const openFromDisk = useCallback(
    async (file) => {
      setStatus(IDLE);
      const opened = await openFile(file);
      if (opened && active && belongsInLibrary(opened)) await offer(opened);
    },
    [openFile, active, offer],
  );

  const openFromLibrary = useCallback(
    async (drawing) => {
      if (!active) return;
      setStatus({ ...IDLE, busy: `Opening ${drawing.name}…` });
      try {
        const pdf = await library.open(project.id, drawing);
        await openFile(new File([pdf], drawing.name, { type: 'application/pdf' }));
        setStatus(IDLE);
      } catch (cause) {
        setStatus({ ...IDLE, error: `Could not open ${drawing.name}: ${messageOf(cause)}` });
      }
    },
    [active, library, project, openFile],
  );

  const changed = useCallback(() => setVersion((v) => v + 1), []);

  return { active, version, changed, openFromDisk, openFromLibrary, ...status };
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
