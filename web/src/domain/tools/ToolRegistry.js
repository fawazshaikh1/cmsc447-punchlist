import { AnnotationTool } from './AnnotationTool';
import { assertInstanceOf } from '../support/contracts';

/**
 * Holds the available drawing tools, in palette order.
 *
 * The third registry in the codebase, and the last piece needed to make a new
 * markup type a pure addition:
 *
 *   AnnotationRegistry   kind -> how to REBUILD it from storage
 *   MarkerRegistry       kind -> how to DRAW it on screen
 *   ToolRegistry         id   -> how to CREATE it from a gesture
 *   PdfWriterRegistry    kind -> how to WRITE it into an exported PDF
 *
 * Four registries sounds like a lot until you notice that they are the four
 * things any annotation must be able to do, and that a new type touches only
 * its own four files plus four barrel lines. The alternative — a conditional in
 * each of the four consumers — means every new type risks breaking every
 * existing one, and guarantees merge conflicts on a team working in parallel.
 *
 * Unlike the other registries this one preserves INSERTION ORDER, because that
 * order is the palette order the user sees. `domain/tools/index.js` registers
 * them in the sequence the toolbar should show.
 */
export class ToolRegistry {
  /** @type {Map<string, AnnotationTool>} */
  static #tools = new Map();

  constructor() {
    throw new TypeError('ToolRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {AnnotationTool} tool An INSTANCE — tools are stateless, so one
   *        shared instance per tool is correct and avoids re-allocating on
   *        every render.
   */
  static register(tool) {
    assertInstanceOf(tool, AnnotationTool, 'tool');

    const id = tool.getId();
    if (this.#tools.has(id)) {
      // Same dev/production split as the other registries: Vite re-executes
      // modules on save, so throwing here would break hot reload every time
      // somebody edits a tool. In a production bundle each module runs once, so
      // a duplicate genuinely means two tools claiming one id.
      if (!import.meta.env?.DEV) {
        throw new Error(`A tool is already registered with id "${id}".`);
      }
      console.warn(`[ToolRegistry] Re-registering "${id}". Expected during hot reload.`);
    }

    this.#tools.set(id, tool);
  }

  /** @param {string} id @returns {AnnotationTool | null} */
  static resolve(id) {
    return this.#tools.get(id) ?? null;
  }

  /** @returns {AnnotationTool[]} In palette order. */
  static all() {
    return [...this.#tools.values()];
  }

  /** @returns {AnnotationTool} The tool selected when the app opens. */
  static default() {
    const first = this.all()[0];
    if (!first) throw new Error('No tools registered — did domain/tools/index.js get imported?');
    return first;
  }
}
