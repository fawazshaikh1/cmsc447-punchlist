import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { SheetName, SheetNames } from '../../domain/sheets';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import { UnsavedSheetNames } from './UnsavedSheetNames';

/** The roles that mark drawings up, and so may save what a drawing says. */
const READER_ROLES = new Set(['admin', 'power_collaborator']);

/**
 * What each sheet is called — "A-101 · LEVEL 1 FLOOR PLAN" — for the drawing
 * on screen and, for the punch list, every drawing in the project.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NAMES COME FROM
 * ---------------------------------------------------------------------------
 * In server mode they are loaded with the project. The first time an admin or
 * power collaborator opens a drawing with unnamed pages, their browser reads
 * the title blocks in the background (SheetNameDetector) and saves what it
 * found for those pages only; everyone else then sees the names without
 * reading anything. Until then a page is "Sheet N", as it always was. In
 * browser mode there is nobody to share with, so the reading is kept here.
 *
 * Reading the drawing can fail — a scanned set has no text — and that is
 * never a reason to stop the drawing opening: failures are noted in the
 * console and the pages keep their "Sheet N".
 *
 * @param {object} options
 * @param {string|null} options.documentName The drawing on screen.
 * @param {Blob|null} options.sourceFile Its PDF.
 * @param {number} options.pageCount
 * @param {number} [options.libraryVersion] useLibrary's `version`: when it
 *        changes, names refused because their drawing was still uploading are
 *        saved again.
 * @returns {{
 *   labelFor: (pageIndex: number) => string,
 *   numberFor: (documentName: string, pageIndex: number) => string,
 *   nameFor: (pageIndex: number) => import('../../domain/sheets').SheetName|null,
 *   canRename: boolean,
 *   rename: (pageIndex: number, name: { number: string, title: string }) => Promise<void>,
 * }}
 */
export function useSheetNames({ documentName, sourceFile, pageCount, libraryVersion = 0 }) {
  const { sheetNames: repository, sheetNameDetector: detector } = useServices();
  // Names the server refused because their drawing had not reached the
  // library yet — shown, and saved once it has.
  const [unsaved] = useState(() => new UnsavedSheetNames());
  const project = useContext(SessionContext)?.project ?? null;
  const projectId = project?.id ?? null;
  const role = project?.role ?? null;

  // Filed under the project they were loaded for, so switching projects can
  // never show one project's names on another's drawing of the same name.
  const [state, setState] = useState(() => ({ projectId: null, loaded: !repository, byDrawing: new Map() }));
  const current = state.projectId === projectId ? state : { projectId, loaded: !repository, byDrawing: new Map() };
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });

  useEffect(() => {
    if (!repository || projectId === null) return undefined;
    let live = true;
    repository.listForProject(projectId).then(
      (byDrawing) => {
        if (live) setState({ projectId, loaded: true, byDrawing });
      },
      (cause) => {
        console.warn('[useSheetNames] Could not load the sheet names.', cause);
        if (live) setState({ projectId, loaded: true, byDrawing: new Map() });
      },
    );
    return () => {
      live = false;
    };
  }, [repository, projectId]);

  const namesOf = useCallback(
    (drawing) => current.byDrawing.get(drawing) ?? SheetNames.EMPTY,
    [current.byDrawing],
  );

  // Read the open drawing once per session, after the project's names are in
  // (so pages already named are not read again), and only by someone whose
  // reading may be saved.
  const read = useRef(new Set());
  const mayRead = repository ? READER_ROLES.has(role) : true;
  useEffect(() => {
    if (!documentName || !sourceFile || !pageCount || !current.loaded || !mayRead) return undefined;
    const key = `${projectId}:${documentName}`;
    if (read.current.has(key)) return undefined;
    // Through the ref, not `namesOf`: the names change when this effect's own
    // save lands, and that must not re-run it.
    const stored = latest.current.byDrawing.get(documentName) ?? SheetNames.EMPTY;
    if (stored.missingPages(pageCount).length === 0) return undefined;
    read.current.add(key);

    const controller = new AbortController();
    let finished = false;
    (async () => {
      try {
        const found = await detector.detect(await sourceFile.arrayBuffer(), { signal: controller.signal });
        if (controller.signal.aborted) return;
        const known = latest.current.byDrawing.get(documentName) ?? SheetNames.EMPTY;
        const missing = new Set(known.missingPages(pageCount));
        const fresh = found.filter((name) => missing.has(name.pageIndex));
        if (fresh.length === 0) return;

        const saved = repository
          ? await unsaved.save(repository, { projectId, documentName, known, names: fresh })
          : known.withDetected(fresh);
        setState((previous) => {
          const base = previous.projectId === projectId ? previous : latest.current;
          return { ...base, projectId, byDrawing: new Map(base.byDrawing).set(documentName, saved) };
        });
      } catch (cause) {
        console.warn('[useSheetNames] Could not read the sheet names from this drawing.', cause);
      } finally {
        finished = true;
      }
    })();

    // Leaving before it finished: stop, and forget the attempt so the next
    // visit reads the drawing again rather than never. A finished reading is
    // kept — pages it found nothing on (a scanned sheet) are not read again.
    const attempts = read.current;
    return () => {
      if (finished) return;
      controller.abort();
      attempts.delete(key);
    };
  }, [documentName, sourceFile, pageCount, current.loaded, mayRead, projectId, repository, detector, unsaved]);

  // The library changed here — most often the drawing just read has finished
  // uploading — so names it refused a moment ago can be saved now.
  useEffect(() => {
    if (!repository || projectId === null) return undefined;
    let live = true;
    unsaved.retry(repository, projectId).then((saved) => {
      if (!live || saved.length === 0) return;
      setState((previous) => {
        const base = previous.projectId === projectId ? previous : latest.current;
        const byDrawing = new Map(base.byDrawing);
        for (const [drawing, names] of saved) byDrawing.set(drawing, names);
        return { ...base, projectId, byDrawing };
      });
    });
    return () => {
      live = false;
    };
  }, [repository, projectId, libraryVersion, unsaved]);

  const canRename = Boolean(repository) && role === 'admin';

  const rename = useCallback(
    async (pageIndex, { number, title }) => {
      if (!repository || !documentName) return;
      const saved = await repository.save(projectId, documentName, {
        source: SheetName.SOURCE.EDITED,
        names: [new SheetName({ pageIndex, number, title, source: SheetName.SOURCE.EDITED })],
      });
      setState((previous) => {
        const base = previous.projectId === projectId ? previous : latest.current;
        return { ...base, projectId, byDrawing: new Map(base.byDrawing).set(documentName, saved) };
      });
    },
    [repository, projectId, documentName],
  );

  const open = documentName ? namesOf(documentName) : SheetNames.EMPTY;

  return {
    labelFor: useCallback((pageIndex) => open.labelFor(pageIndex), [open]),
    numberFor: useCallback((drawing, pageIndex) => namesOf(drawing).numberFor(pageIndex), [namesOf]),
    nameFor: useCallback((pageIndex) => open.nameFor(pageIndex), [open]),
    canRename,
    rename,
  };
}
