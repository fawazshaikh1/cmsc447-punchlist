/**
 * Checks pinch-zoom and two-finger pan (SCRUM-48): the decision between "one
 * finger, draw" and "two fingers, zoom", and the arithmetic that keeps the
 * drawing under the fingers.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A PINCH NEVER DRAWS. The fingers of a pinch land tens of milliseconds
 *    apart; the first must not place a pin (and open "What needs fixing?") or
 *    start a stroke before the second arrives.
 * 2. ONE FINGER STILL WORKS EXACTLY AS BEFORE — a tap places, a drag draws —
 *    and a mouse or pen gains no delay at all.
 * 3. ZOOMING KEEPS ITS PLACE: the spot between the fingers is the spot
 *    between the fingers after the sheet is redrawn bigger.
 *
 * The timer is faked, so "the hold runs out" is a function call, not a wait.
 *
 * Run with: npm run verify -- pinch
 */
import assert from 'node:assert/strict';

import { TouchGestureArbiter } from '../src/presentation/gestures/TouchGestureArbiter.js';
import { anchorOn, previewTransform, scrollToKeep } from '../src/presentation/gestures/pinchGeometry.js';
import { clampScale, MAX_SCALE, MIN_SCALE } from '../src/presentation/gestures/zoomLimits.js';

/** An arbiter with a hand-driven timer and a log of everything it decided. */
function harness() {
  const log = [];
  let pending = null;
  const arbiter = new TouchGestureArbiter(
    {
      onRelease: (p) => log.push(['release', p.pointerId]),
      onCancelDrawing: () => log.push(['cancel']),
      onPinchStart: (a, b) => log.push(['pinchStart', a.pointerId, b.pointerId]),
      onPinchMove: (a, b) => log.push(['pinchMove', a.x, b.x]),
      onPinchEnd: () => log.push(['pinchEnd']),
    },
    {
      setTimer: (fn) => (pending = fn),
      clearTimer: () => (pending = null),
    },
  );
  return {
    arbiter,
    log,
    /** The hold runs out. */
    elapse: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    timerPending: () => pending !== null,
  };
}

const touch = (pointerId, x = 100, y = 100) => ({ pointerId, pointerType: 'touch', x, y });

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// PART 1 — a pinch never draws
// =========================================================================

check('THE CORE CASE: two fingers landing together start a pinch and nothing else', () => {
  const { arbiter, log, elapse } = harness();

  assert.equal(arbiter.down(touch(1, 100, 100)), true, 'first finger held back from the sheet');
  assert.equal(arbiter.down(touch(2, 200, 100)), true);
  elapse(); // even if the timer somehow fired late

  assert.deepEqual(log, [['pinchStart', 1, 2]], 'no release — no pin dialog, no stroke');
  assert.equal(arbiter.state, 'pinching');
});

check('a slow pinch cancels the one-finger gesture that had already started', () => {
  const { arbiter, log, elapse } = harness();
  arbiter.down(touch(1));
  elapse(); // held long enough to count as one finger
  arbiter.down(touch(2, 300, 100));

  assert.deepEqual(log, [['release', 1], ['cancel'], ['pinchStart', 1, 2]]);
});

check('every movement of either finger during a pinch is kept from the sheet', () => {
  const { arbiter, log } = harness();
  arbiter.down(touch(1, 100, 100));
  arbiter.down(touch(2, 200, 100));

  assert.equal(arbiter.move(touch(1, 90, 100)), true);
  assert.equal(arbiter.move(touch(2, 260, 100)), true);
  assert.deepEqual(log.slice(1), [['pinchMove', 90, 200], ['pinchMove', 90, 260]]);
});

check('lifting one finger ends the pinch; the other finger cannot start drawing', () => {
  const { arbiter, log } = harness();
  arbiter.down(touch(1));
  arbiter.down(touch(2, 200));

  assert.equal(arbiter.up(touch(2, 200)), true);
  assert.equal(arbiter.move(touch(1, 400, 400)), true, 'the remaining finger is ignored');
  assert.equal(arbiter.up(touch(1, 400, 400)), true);

  assert.deepEqual(log.map(([kind]) => kind), ['pinchStart', 'pinchEnd']);
  assert.equal(arbiter.state, 'idle');
});

check('putting a finger back down after lifting one carries on pinching', () => {
  const { arbiter, log } = harness();
  arbiter.down(touch(1));
  arbiter.down(touch(2, 200));
  arbiter.up(touch(2, 200));
  arbiter.down(touch(3, 250));

  assert.deepEqual(log.map(([kind, ...ids]) => [kind, ...ids]).at(-1), ['pinchStart', 1, 3]);
});

check('a third finger is ignored, and lifting it does not end the pinch', () => {
  const { arbiter, log } = harness();
  arbiter.down(touch(1));
  arbiter.down(touch(2, 200));
  assert.equal(arbiter.down(touch(3, 300)), true);
  assert.equal(arbiter.up(touch(3, 300)), true);

  assert.equal(arbiter.state, 'pinching');
  assert.deepEqual(log.map(([kind]) => kind), ['pinchStart']);
});

// =========================================================================
// PART 2 — one finger works as before
// =========================================================================

check('a tap is released the moment it lifts — a pin is placed without waiting', () => {
  const { arbiter, log, timerPending } = harness();
  arbiter.down(touch(1));

  assert.equal(arbiter.up(touch(1)), false, 'the pointerup reaches the sheet');
  assert.deepEqual(log, [['release', 1]], 'its pointerdown was replayed first');
  assert.equal(timerPending(), false);
  assert.equal(arbiter.state, 'idle');
});

check('holding still past the hold time hands the touch over to the sheet', () => {
  const { arbiter, log, elapse } = harness();
  arbiter.down(touch(1));
  elapse();

  assert.deepEqual(log, [['release', 1]]);
  assert.equal(arbiter.move(touch(1, 300, 300)), false, 'drawing proceeds normally');
  assert.equal(arbiter.up(touch(1, 300, 300)), false);
});

check('a deliberate drag is handed over at once, without waiting for the hold', () => {
  const { arbiter, log, timerPending } = harness();
  arbiter.down(touch(1, 100, 100));

  assert.equal(arbiter.move(touch(1, 103, 102)), true, 'fingertip settling is not a drag');
  assert.deepEqual(log, []);

  assert.equal(arbiter.move(touch(1, 140, 100)), false, 'past the slop: let through');
  assert.deepEqual(log, [['release', 1]]);
  assert.equal(timerPending(), false);
});

check('a mouse or a pen is never held back', () => {
  const { arbiter, log } = harness();
  for (const pointerType of ['mouse', 'pen']) {
    const p = { pointerId: 9, pointerType, x: 1, y: 1 };
    assert.equal(arbiter.down(p), false);
    assert.equal(arbiter.move({ ...p, x: 50 }), false);
    assert.equal(arbiter.up(p), false);
  }
  assert.deepEqual(log, []);
});

check('a touch the browser cancels while held is dropped, not turned into a tap', () => {
  const { arbiter, log } = harness();
  arbiter.down(touch(1));
  assert.equal(arbiter.up(touch(1), { cancelled: true }), true);
  assert.deepEqual(log, []);
  assert.equal(arbiter.state, 'idle');
});

// =========================================================================
// PART 3 — zooming keeps its place
// =========================================================================

check('the spot between the fingers is still there after the sheet doubles in size', () => {
  // A 1000x800 sheet whose top-left is on screen at (40, 60); fingers centred
  // at (540, 460) — the middle of the sheet.
  const before = { left: 40, top: 60, width: 1000, height: 800 };
  const fingers = { x: 540, y: 460 };
  const anchor = anchorOn(before, fingers);
  assert.deepEqual(anchor, { u: 0.5, v: 0.5 });

  // Redrawn at twice the size, still with its top-left at (40, 60) before
  // any scrolling: the middle is now at (1040, 860).
  const after = { left: 40, top: 60, width: 2000, height: 1600 };
  const { dx, dy } = scrollToKeep(after, anchor, fingers);
  assert.deepEqual({ dx, dy }, { dx: 500, dy: 400 }, 'scroll right and down by exactly the growth');
});

check('two-finger panning with no zoom scrolls by exactly how far the fingers moved', () => {
  const sheet = { left: 0, top: 0, width: 1000, height: 800 };
  const anchor = anchorOn(sheet, { x: 300, y: 300 });
  // Fingers dragged 120 left and 50 up; the sheet should follow them.
  const { dx, dy } = scrollToKeep(sheet, anchor, { x: 180, y: 250 });
  assert.deepEqual({ dx, dy }, { dx: 120, dy: 50 });
});

check('the preview scales about where the fingers started and follows them', () => {
  const preview = previewTransform({ x: 140, y: 160 }, { x: 150, y: 150 }, 1.5, { left: 40, top: 60 });
  assert.equal(preview.transformOrigin, '100px 100px');
  assert.equal(preview.transform, 'translate(10px, -10px) scale(1.5)');
});

check('zoom stays between 25% and 800%, rounded so a pinch back to start is no change', () => {
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(50), MAX_SCALE);
  assert.equal(clampScale(1.23456789), 1.2346);
  assert.equal(clampScale((1 * 300) / 300), 1);
  assert.equal(clampScale(Number.NaN), 1, 'a degenerate pinch (zero distance) does not break the view');
});

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

console.log(`\n${checks.length - failed}/${checks.length} pinch-zoom checks passed.`);
process.exit(failed === 0 ? 0 : 1);
