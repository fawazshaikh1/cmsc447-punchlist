import { ToolShortcutRegistry } from './ToolShortcutRegistry';

/** Elements where a letter is text, never a command. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The tool a key press picks, or null when it picks nothing.
 *
 * Nothing, rather than a tool, whenever the letter means something else:
 *   - inside a text field, where P is the letter P — a description typed with
 *     a P in it must not switch tools halfway through the sentence;
 *   - with Ctrl, Cmd or Alt held, where C is copy and Z is undo;
 *   - for a tool the person's role does not offer them, where arming it would
 *     only lead to every tap being refused.
 *
 * Pure: it takes what it needs of a KeyboardEvent, so the rule can be checked
 * without a browser.
 *
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, target?: { tagName?: string, isContentEditable?: boolean } }} event
 * @param {{ isAvailable: (toolId: string) => boolean }} context
 * @returns {string|null}
 */
export function shortcutTarget(event, { isAvailable }) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const target = event.target;
  if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return null;

  const toolId = ToolShortcutRegistry.toolFor(event.key);
  if (toolId === null || !isAvailable(toolId)) return null;
  return toolId;
}
