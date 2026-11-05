import { useCallback, useEffect, useRef, useState } from 'react';

import { ToolRegistry } from '../../domain/tools';
import { afterCreate, escapeTool, holdTool, pressTool } from './ToolLatch';

/**
 * Applies the tool latch to a sheet editor: tools are used once and the app
 * returns to Select, unless a tool is kept on. The rules are ToolLatch's; this
 * hook only remembers which tool is kept and carries the answers out.
 *
 * Which tool is ACTIVE stays the editor's — it may overrule a choice the
 * person's role does not allow — so this reads `editor.toolId` rather than
 * keeping a second copy that could disagree with it.
 *
 * @param {object} editor What useSheetEditor returns: `toolId`, `selectTool`,
 *        `select`, `selectSoon`, `created`, `isDrawing` and `cancel`.
 * @param {object} [options]
 * @param {() => void} [options.onSelectCreated] Called when a markup just
 *        made is selected, so its details can be shown where they are hidden.
 * @returns {{ lockedToolId: string|null, press: (toolId: string) => void, hold: (toolId: string) => void, escape: () => void }}
 */
export function useToolLatch(editor, { onSelectCreated } = {}) {
  const { toolId, selectTool, select, selectSoon, created, isDrawing, cancel } = editor;
  const [lockedToolId, setLockedToolId] = useState(null);
  const defaultToolId = ToolRegistry.default().getId();

  const apply = useCallback(
    (next) => {
      selectTool(next.toolId);
      setLockedToolId(next.lockedToolId);
    },
    [selectTool],
  );

  const press = useCallback(
    (id) => apply(pressTool({ toolId, lockedToolId }, id, { drafting: isDrawing })),
    [apply, toolId, lockedToolId, isDrawing],
  );

  const hold = useCallback(
    (id) => apply(holdTool({ toolId, lockedToolId }, id, { drafting: isDrawing })),
    [apply, toolId, lockedToolId, isDrawing],
  );

  const escape = useCallback(() => {
    const next = escapeTool({ toolId, lockedToolId }, defaultToolId, { drafting: isDrawing });
    if (next.cancelDraft) cancel();
    else select(null);
    apply(next);
  }, [select, cancel, apply, toolId, lockedToolId, defaultToolId, isDrawing]);

  // Each creation is answered once. `seq` grows with every markup made, so a
  // re-render — or this effect re-running because the selection callbacks
  // changed — never sends the person back to Select a second time.
  const answered = useRef(created?.seq ?? 0);
  useEffect(() => {
    if (!created || created.seq <= answered.current) return;
    answered.current = created.seq;

    const next = afterCreate({ toolId, lockedToolId }, defaultToolId);
    apply(next);
    if (next.selectCreated) {
      selectSoon(created.id);
      onSelectCreated?.();
    }
  }, [created, toolId, lockedToolId, defaultToolId, apply, selectSoon, onSelectCreated]);

  return { lockedToolId, press, hold, escape };
}
