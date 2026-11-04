import { ToolShortcutRegistry } from './ToolShortcutRegistry';

/**
 * Tools in the hand: which one is on after it is used (ToolLatch) and which
 * key picks each one. Imported once by App.jsx, before anything reads a key.
 *
 * The keys are the ones drawing programs have taught everyone — V to select,
 * the first letter of the tool otherwise — with B for the box (as in Bluebeam)
 * and D for freehand drawing, I for image.
 *
 * No stylesheet is imported here: the verify suites load this file in Node.
 */
ToolShortcutRegistry.register('select', 'V');
ToolShortcutRegistry.register('pin', 'P');
ToolShortcutRegistry.register('rectangle', 'B');
ToolShortcutRegistry.register('cloud', 'C');
ToolShortcutRegistry.register('arrow', 'A');
ToolShortcutRegistry.register('ink', 'D');
ToolShortcutRegistry.register('text', 'T');
ToolShortcutRegistry.register('photo', 'I');

export { afterCreate, escapeTool, holdTool, pressTool } from './ToolLatch';
export { ToolShortcutRegistry } from './ToolShortcutRegistry';
export { shortcutTarget } from './shortcutTarget';
export { useToolLatch } from './useToolLatch';
export { useToolShortcuts } from './useToolShortcuts';
