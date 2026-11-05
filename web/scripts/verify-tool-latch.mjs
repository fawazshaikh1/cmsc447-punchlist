/**
 * Checks how a drawing tool behaves once it has been used.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A TOOL IS USED ONCE, THEN THE APP IS BACK ON SELECT — with the markup
 *    just placed selected, so its details are open, the way Fieldwire opens a
 *    task the moment it is dropped. Stakeholders asked why they had to go
 *    back to the rail for Select after every pin.
 * 2. A TOOL CAN BE KEPT ON for placing several in a row, and every way out of
 *    that — pressing the tool again, pressing another, Escape — releases it.
 * 3. EVERY TOOL HAS A KEY (V P B C A D T I), and a key never does anything
 *    while someone is typing, when it is part of a Ctrl/Cmd/Alt shortcut, or
 *    for a tool the person's role does not offer them.
 *
 * Which tool a role may use is not decided here: the rail and the editor
 * already ask the policy, and these rules only ever move between tools the
 * person was offered.
 *
 * Run with: npm run verify -- tool-latch
 */
import assert from 'node:assert/strict';

import { afterCreate, escapeTool, holdTool, pressTool } from '../src/presentation/tools/ToolLatch.js';
import { HoldGesture } from '../src/presentation/tools/HoldGesture.js';
import { ToolShortcutRegistry, shortcutTarget } from '../src/presentation/tools/index.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// 1. ONE USE, THEN SELECT
// =========================================================================

check('pressing a tool picks it, unlocked', () =>
  assert.deepEqual(pressTool({ toolId: 'select', lockedToolId: null }, 'pin'), { toolId: 'pin', lockedToolId: null }));

check('after a create, an unlocked tool returns to Select and the new markup is selected', () =>
  assert.deepEqual(afterCreate({ toolId: 'pin', lockedToolId: null }, 'select'), {
    toolId: 'select',
    lockedToolId: null,
    selectCreated: true,
  }));

// =========================================================================
// 2. KEEPING A TOOL ON, AND LETTING GO OF IT
// =========================================================================

check('holding a tool locks it', () =>
  assert.deepEqual(holdTool({ toolId: 'select', lockedToolId: null }, 'rectangle'), {
    toolId: 'rectangle',
    lockedToolId: 'rectangle',
  }));

check('after a create, a locked tool stays on and nothing is selected', () =>
  assert.deepEqual(afterCreate({ toolId: 'pin', lockedToolId: 'pin' }, 'select'), {
    toolId: 'pin',
    lockedToolId: 'pin',
    selectCreated: false,
  }));

check('a lock on another tool does not keep this one', () =>
  assert.deepEqual(afterCreate({ toolId: 'cloud', lockedToolId: 'pin' }, 'select'), {
    toolId: 'select',
    lockedToolId: null,
    selectCreated: true,
  }));

check('pressing the locked tool again releases the lock and keeps the tool', () =>
  assert.deepEqual(pressTool({ toolId: 'pin', lockedToolId: 'pin' }, 'pin'), { toolId: 'pin', lockedToolId: null }));

check('Escape returns to Select and releases any lock', () =>
  assert.deepEqual(escapeTool({ toolId: 'pin', lockedToolId: 'pin' }, 'select'), {
    toolId: 'select',
    lockedToolId: null,
    cancelDraft: false,
  }));

check('every answer is frozen', () =>
  assert.ok(Object.isFrozen(pressTool({ toolId: 'select', lockedToolId: null }, 'pin'))));

// =========================================================================
// 2b. WHILE A MARKUP IS BEING DRAWN
// =========================================================================
// Spec 5.1: a draft that is cancelled — Escape mid-drag — leaves the tool as
// it was. Found in the final review: Escape mid-drag switched to Select, the
// half-drawn box froze, and letting go saved it.

check('Escape while a markup is being drawn drops it and keeps the tool and its lock', () =>
  assert.deepEqual(escapeTool({ toolId: 'rectangle', lockedToolId: 'rectangle' }, 'select', { drafting: true }), {
    toolId: 'rectangle',
    lockedToolId: 'rectangle',
    cancelDraft: true,
  }));

check('a tool pressed or held while a markup is being drawn changes nothing', () => {
  const drawing = { toolId: 'rectangle', lockedToolId: null };
  assert.deepEqual(pressTool(drawing, 'select', { drafting: true }), drawing);
  assert.deepEqual(holdTool(drawing, 'cloud', { drafting: true }), drawing);
});

// =========================================================================
// 2c. A FINGER RESTING ON A TOOL
// =========================================================================
// A long press keeps a tool on, and the click a browser sends when that
// finger lifts must not then press the tool again. Found in the final review:
// where no click follows — Android sends a context menu instead, iOS may
// cancel the touch — the next tap on the rail was eaten.

check('an ordinary tap on a tool acts', () => {
  const finger = new HoldGesture();
  finger.press();
  assert.equal(finger.click(), true);
});

check('the click that ends a long press is not a second press', () => {
  const finger = new HoldGesture();
  finger.press();
  finger.held();
  assert.equal(finger.click(), false);
});

check('a long press that ends without a click does not eat the next tap', () => {
  const finger = new HoldGesture();
  finger.press();
  finger.held();
  finger.press();
  assert.equal(finger.click(), true);
});

// =========================================================================
// 3. SHORTCUTS
// =========================================================================

check('V P B C A D T I pick their tools', () => {
  const expected = { v: 'select', p: 'pin', b: 'rectangle', c: 'cloud', a: 'arrow', d: 'ink', t: 'text', i: 'photo' };
  for (const [key, tool] of Object.entries(expected)) assert.equal(ToolShortcutRegistry.toolFor(key), tool, key);
  assert.equal(ToolShortcutRegistry.keyFor('ink'), 'D');
});

const any = { isAvailable: () => true };

check('a shortcut is ignored while typing', () => {
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    assert.equal(shortcutTarget({ key: 'p', target }, any), null, target.tagName);
  }
});

check('Ctrl, Cmd or Alt with a letter is not a tool', () => {
  assert.equal(shortcutTarget({ key: 'c', ctrlKey: true, target: { tagName: 'BODY' } }, any), null);
  assert.equal(shortcutTarget({ key: 'c', metaKey: true, target: { tagName: 'BODY' } }, any), null);
  assert.equal(shortcutTarget({ key: 'c', altKey: true, target: { tagName: 'BODY' } }, any), null);
});

check('a tool the role cannot use is not picked', () => {
  const collaborator = { isAvailable: (id) => id === 'select' || id === 'photo' };
  assert.equal(shortcutTarget({ key: 'b', target: { tagName: 'BODY' } }, collaborator), null);
  assert.equal(shortcutTarget({ key: 'I', target: { tagName: 'BODY' } }, collaborator), 'photo');
});

check('an unregistered key picks nothing', () =>
  assert.equal(shortcutTarget({ key: 'x', target: { tagName: 'BODY' } }, any), null));

// --- run --------------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message.split('\n').join('\n        ')}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} tool latch checks passed.`);
process.exit(failed === 0 ? 0 : 1);
