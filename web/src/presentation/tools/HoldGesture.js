/**
 * What one finger on a tool button meant: a tap, or a long press that kept the
 * tool on (see ToolLatch).
 *
 * A long press is reported by a timer while the finger is still down, and the
 * click the browser sends when it lifts must not then press the tool a second
 * time — that would unlock what the press just locked. So the click after a
 * hold is swallowed.
 *
 * Only THAT click. Not every browser sends one: Android ends a long press
 * with a context menu instead, and iOS may cancel the touch. A flag left set
 * by such a press ate the next tap on the rail, so every new press starts
 * clean, and only the click ending the same press can be swallowed.
 *
 * Plain JavaScript with no DOM, so the rule is checked in Node
 * (verify-tool-latch).
 */
export class HoldGesture {
  #held = false;

  /** A finger went down on a tool. */
  press() {
    this.#held = false;
  }

  /** It stayed down long enough to keep the tool on. */
  held() {
    this.#held = true;
  }

  /**
   * The browser's click for this press.
   *
   * @returns {boolean} Whether it is a tap to act on; false when it only ends
   *          a long press.
   */
  click() {
    const tap = !this.#held;
    this.#held = false;
    return tap;
  }
}
