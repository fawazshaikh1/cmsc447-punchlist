/**
 * What tool is on after the person does something — the rule that makes every
 * drawing tool one-shot.
 *
 * ===========================================================================
 * WHY A TOOL IS USED ONCE
 * ===========================================================================
 * On a punch walk someone places ONE thing — a pin at the cracked tile — and
 * then wants to look at it: describe it, assign it, add a photo. Leaving the
 * Pin tool armed made the next tap on the sheet another pin, so the first
 * thing every user learned was to go back to the rail for Select. The
 * stakeholders asked why. Fieldwire answers it by opening the task it just
 * placed, and so does this: after a markup is made the app is on Select, with
 * the new markup selected and its details open.
 *
 * For the case where several are wanted in a row — five pins along a corridor
 * — a tool can be KEPT on (double-click, or a long press on a tablet). Every
 * way out of that releases it: pressing the tool again, pressing another
 * tool, or Escape.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE PURE FUNCTIONS
 * ---------------------------------------------------------------------------
 * Which tool is active is owned by the editor (a role may overrule a choice
 * — see useSheetEditor's `canUseTool`). These functions only answer "what
 * next?" from what is true now, so the rule can be checked without React and
 * the hook that applies it holds no rule of its own.
 *
 * @typedef {{ toolId: string, lockedToolId: string|null }} Latch
 *          `toolId` is the tool active NOW; `lockedToolId` the one kept on, if
 *          any.
 */

/**
 * A tool pressed on the rail (or by its shortcut): it becomes active, and no
 * tool is kept on — pressing the kept tool again is how its lock is released.
 *
 * @param {Latch} latch
 * @param {string} toolId
 * @returns {Readonly<Latch>}
 */
export function pressTool(latch, toolId) {
  return Object.freeze({ toolId, lockedToolId: null });
}

/**
 * A tool held — double-clicked, or long-pressed on a touch screen: it becomes
 * active and stays on after each use.
 *
 * @param {Latch} latch
 * @param {string} toolId
 * @returns {Readonly<Latch>}
 */
export function holdTool(latch, toolId) {
  return Object.freeze({ toolId, lockedToolId: toolId });
}

/**
 * A markup was just made with the active tool. Unless that tool is the one
 * kept on, the app goes back to the default tool and the new markup is
 * selected. A kept tool stays, and nothing is selected, so the next tap
 * places the next one without a panel opening in the way.
 *
 * @param {Latch} latch
 * @param {string} defaultToolId Select — `ToolRegistry.default().getId()`.
 * @returns {Readonly<Latch & { selectCreated: boolean }>}
 */
export function afterCreate({ toolId, lockedToolId }, defaultToolId) {
  if (lockedToolId !== null && lockedToolId === toolId) {
    return Object.freeze({ toolId, lockedToolId, selectCreated: false });
  }
  return Object.freeze({ toolId: defaultToolId, lockedToolId: null, selectCreated: true });
}

/**
 * Escape: back to the default tool, and any kept tool is let go.
 *
 * @param {Latch} latch
 * @param {string} defaultToolId
 * @returns {Readonly<Latch>}
 */
export function escapeTool(latch, defaultToolId) {
  return Object.freeze({ toolId: defaultToolId, lockedToolId: null });
}
