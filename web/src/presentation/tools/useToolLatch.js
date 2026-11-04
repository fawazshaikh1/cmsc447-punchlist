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
 *        `select`, `selectSoon` and `created`.
 * @returns {{ lockedToolId: string|null, press: (toolId: string) => void, hold: (toolId: string) => void, escape: () => void }}
 */
export function useToolLatch(editor) {
  const { toolId, selectTool, select, selectSoon, created } = editor;
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
    (id) => apply(pressTool({ toolId, lockedToolId }, id)),
    [apply, toolId, lockedToolId],
  );

  const hold = useCallback(
    (id) => apply(holdTool({ toolId, lockedToolId }, id)),
    [apply, toolId, lockedToolId],
  );

  const escape = useCallback(() => {
    select(null);
    apply(escapeTool({ toolId, lockedToolId }, defaultToolId));
  }, [select, apply, toolId, lockedToolId, defaultToolId]);

  // Each creation is answered once. `seq` grows with every markup made, so a
  // re-render — or this effect re-running because the selection callbacks
  // changed — never sends the person back to Select a second time.
  const answered = useRef(created?.seq ?? 0);
  useEffect(() => {
    if (!created || created.seq <= answered.current) return;
    answered.current = created.seq;

    const next = afterCreate({ toolId, lockedToolId }, defaultToolId);
    apply(next);
    if (next.selectCreated) selectSoon(created.id);
  }, [created, toolId, lockedToolId, defaultToolId, apply, selectSoon]);

  return { lockedToolId, press, hold, escape };
}
