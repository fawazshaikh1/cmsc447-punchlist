/**
 * @typedef {object} TouchPoint
 * @property {number} pointerId
 * @property {string} pointerType 'touch', 'mouse' or 'pen'.
 * @property {number} x clientX
 * @property {number} y clientY
 */

/**
 * @typedef {object} ArbiterCallbacks
 * @property {(first: TouchPoint) => void} onRelease A held first touch turned
 *           out to be a one-finger gesture: replay its pointerdown so the sheet
 *           starts drawing, placing or selecting exactly as it would have.
 * @property {() => void} onCancelDrawing A one-finger gesture was already under
 *           way when a second finger landed: abandon it.
 * @property {(a: TouchPoint, b: TouchPoint) => void} onPinchStart
 * @property {(a: TouchPoint, b: TouchPoint) => void} onPinchMove
 * @property {() => void} onPinchEnd
 */

const STATE = Object.freeze({
  IDLE: 'idle',
  HOLDING: 'holding',
  DRAWING: 'drawing',
  PINCHING: 'pinching',
  DRAINING: 'draining',
});

/**
 * Decides whether a touch on the sheet is a one-finger gesture — draw, place,
 * select — or the start of a two-finger pinch or pan.
 *
 * ===========================================================================
 * THE PROBLEM
 * ===========================================================================
 * The two fingers of a pinch never land together; the first arrives tens of
 * milliseconds early. The sheet acts on pointerdown, and for a pin pointerdown
 * opens "What needs fixing?" — so a naive pinch with the Pin tool selected
 * would pop that dialog every single time, and with a drawing tool would leave
 * a stray stroke.
 *
 * So a first TOUCH is held back for a moment (HOLD_MS) instead of passed on.
 * It is released as an ordinary one-finger gesture as soon as anything shows
 * it is one: the hold runs out, the finger moves past a few pixels, or it
 * lifts (a tap). If a second finger lands first, the held touch is dropped
 * and it becomes a pinch — nothing was ever drawn.
 *
 * A one-finger gesture already under way when a second finger lands is
 * cancelled rather than finished, so a slow pinch leaves no stroke either.
 *
 * Mouse and pen are never held: they cannot pinch, and drawing with them must
 * not gain any delay.
 *
 * Plain state machine, no DOM: every method takes a point and says whether
 * the event should be kept from the sheet (`true`) or passed through.
 */
export class TouchGestureArbiter {
  /** Long enough for a second finger to land, short enough to feel instant. */
  static HOLD_MS = 120;

  /** Movement that is a deliberate drag rather than a fingertip settling. */
  static SLOP_PX = 8;

  /**
   * @param {ArbiterCallbacks} callbacks
   * @param {object} [timers] Injectable so the timing can be checked without waiting.
   * @param {(fn: () => void, ms: number) => unknown} [timers.setTimer]
   * @param {(handle: unknown) => void} [timers.clearTimer]
   */
  constructor(callbacks, { setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) } = {}) {
    this.callbacks = callbacks;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.#reset();
  }

  /** The current state, for checks and debugging. */
  get state() {
    return this.#state;
  }

  #state;
  /** @type {Map<number, TouchPoint>} */
  #touches;
  /** @type {TouchPoint|null} */
  #held;
  #timer;
  /** @type {number[]} the two pointer ids being pinched with */
  #pinchIds;

  #reset() {
    this.#state = STATE.IDLE;
    this.#touches = new Map();
    this.#held = null;
    this.#timer = null;
    this.#pinchIds = [];
  }

  /** @param {TouchPoint} point @returns {boolean} true to keep it from the sheet */
  down(point) {
    if (point.pointerType !== 'touch') return false;
    this.#touches.set(point.pointerId, point);

    switch (this.#state) {
      case STATE.IDLE:
        this.#state = STATE.HOLDING;
        this.#held = point;
        this.#timer = this.setTimer(() => this.#releaseHeld(), TouchGestureArbiter.HOLD_MS);
        return true;

      case STATE.HOLDING:
        this.#cancelTimer();
        this.#held = null;
        return this.#startPinch();

      case STATE.DRAWING:
        this.callbacks.onCancelDrawing();
        return this.#startPinch();

      case STATE.DRAINING:
        // One finger stayed down after a pinch and another has joined it:
        // carry on pinching from here rather than making the user lift both.
        if (this.#touches.size === 2) return this.#startPinch();
        return true;

      default:
        // A third finger during a pinch is ignored.
        return true;
    }
  }

  /** @param {TouchPoint} point @returns {boolean} */
  move(point) {
    if (point.pointerType !== 'touch' || !this.#touches.has(point.pointerId)) return false;

    if (this.#state === STATE.HOLDING) {
      const start = this.#held;
      const moved = Math.hypot(point.x - start.x, point.y - start.y);
      if (moved <= TouchGestureArbiter.SLOP_PX) return true;

      // A real drag: hand it over now. The release replays the pointerdown;
      // this move is let through after it.
      this.#releaseHeld();
      this.#touches.set(point.pointerId, point);
      return false;
    }

    this.#touches.set(point.pointerId, point);

    if (this.#state === STATE.PINCHING) {
      const [a, b] = this.#pair();
      if (a && b) this.callbacks.onPinchMove(a, b);
      return true;
    }

    return this.#state === STATE.DRAINING;
  }

  /**
   * A finger lifted — or the browser cancelled it, which is handled the same
   * way except that a held touch is dropped rather than turned into a tap.
   *
   * @param {TouchPoint} point
   * @param {{ cancelled?: boolean }} [options]
   * @returns {boolean}
   */
  up(point, { cancelled = false } = {}) {
    if (point.pointerType !== 'touch' || !this.#touches.has(point.pointerId)) return false;

    switch (this.#state) {
      case STATE.HOLDING:
        this.#cancelTimer();
        if (cancelled) {
          this.#reset();
          return true;
        }
        // A tap: replay its pointerdown, then let this pointerup through.
        this.#releaseHeld();
        this.#reset();
        return false;

      case STATE.DRAWING:
        this.#reset();
        return false;

      case STATE.PINCHING:
        this.#touches.delete(point.pointerId);
        // An extra finger lifting does not end the pinch it was ignored by.
        if (!this.#pinchIds.includes(point.pointerId)) return true;
        this.callbacks.onPinchEnd();
        this.#state = this.#touches.size > 0 ? STATE.DRAINING : STATE.IDLE;
        if (this.#state === STATE.IDLE) this.#reset();
        return true;

      case STATE.DRAINING:
        this.#touches.delete(point.pointerId);
        if (this.#touches.size === 0) this.#reset();
        return true;

      default:
        return false;
    }
  }

  #startPinch() {
    this.#state = STATE.PINCHING;
    this.#pinchIds = [...this.#touches.keys()].slice(0, 2);
    const [a, b] = this.#pair();
    this.callbacks.onPinchStart(a, b);
    return true;
  }

  #releaseHeld() {
    this.#cancelTimer();
    const held = this.#held;
    if (!held || this.#state !== STATE.HOLDING) return;

    this.#held = null;
    this.#state = STATE.DRAWING;
    this.callbacks.onRelease(held);
  }

  #cancelTimer() {
    if (this.#timer !== null) this.clearTimer(this.#timer);
    this.#timer = null;
  }

  /** The two fingers of the pinch, in the order they landed. */
  #pair() {
    return this.#pinchIds.map((id) => this.#touches.get(id));
  }
}
