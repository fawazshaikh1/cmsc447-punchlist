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
 *
 * Which tool a role may use is not decided here: the rail and the editor
 * already ask the policy, and these rules only ever move between tools the
 * person was offered.
 *
 * Run with: npm run verify -- tool-latch
 */
import assert from 'node:assert/strict';

import { afterCreate, escapeTool, holdTool, pressTool } from '../src/presentation/tools/ToolLatch.js';

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
  assert.deepEqual(escapeTool({ toolId: 'pin', lockedToolId: 'pin' }, 'select'), { toolId: 'select', lockedToolId: null }));

check('every answer is frozen', () =>
  assert.ok(Object.isFrozen(pressTool({ toolId: 'select', lockedToolId: null }, 'pin'))));

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
