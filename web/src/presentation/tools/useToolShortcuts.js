import { useEffect } from 'react';

import { ToolRegistry } from '../../domain/tools';
import { shortcutTarget } from './shortcutTarget';

/**
 * Picks a tool from the keyboard — V Select, P Pin, B Box and so on, as
 * registered in `presentation/tools/index.js`. A shortcut goes through the
 * latch exactly like a press on the rail, so a kept tool is let go the same
 * way.
 *
 * @param {object} options
 * @param {object} options.editor What useSheetEditor returns; its
 *        `canUseTool` decides which tools this person may pick.
 * @param {{ press: (toolId: string) => void }} options.latch From useToolLatch.
 */
export function useToolShortcuts({ editor, latch }) {
  const { canUseTool } = editor;
  const { press } = latch;

  useEffect(() => {
    const isAvailable = (toolId) => {
      const tool = ToolRegistry.resolve(toolId);
      return tool !== null && canUseTool(tool);
    };

    const onKeyDown = (event) => {
      const toolId = shortcutTarget(event, { isAvailable });
      if (toolId === null) return;
      event.preventDefault();
      press(toolId);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canUseTool, press]);
}
