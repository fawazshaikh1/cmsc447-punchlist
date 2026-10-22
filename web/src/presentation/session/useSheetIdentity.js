import { useCallback } from 'react';

import { sheetIdFor } from '../../domain/documents/sheetNames';
import { useSheetScope } from './useSession';

/**
 * The id of one sheet — which file, which page — inside the open project.
 *
 * `sheetIdFor` derives the bare id from the file name so that it is stable
 * across reloads; this places it in the project, so two projects with the
 * same file never share markups (see SheetScope). In browser mode the id is
 * the bare one, unchanged.
 *
 * Everything that names a sheet — the app shell looking up its markups,
 * opening a working copy, exporting — takes the function from here, so they
 * cannot disagree about which sheet is which.
 *
 * @returns {(fileName: string, pageIndex: number) => string}
 */
export function useSheetIdentity() {
  const scope = useSheetScope();
  return useCallback((fileName, pageIndex) => scope.qualify(sheetIdFor(fileName, pageIndex)), [scope]);
}
