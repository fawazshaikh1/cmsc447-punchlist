import { TwoPointMarkup } from './TwoPointMarkup';
import { AnnotationRegistry } from './AnnotationRegistry';

export const RECTANGLE_KIND = 'rectangle';

/**
 * A rectangular box drawn around an area of the drawing.
 *
 * The most-used markup on a punch walk: "everything inside this box is wrong".
 * Exports to a native PDF `/Square` annotation, so it opens as a real,
 * selectable markup in Acrobat rather than as flattened pixels.
 *
 * Note how little this file contains. Position, style, bounds normalisation,
 * degeneracy checking, serialisation and the drag interaction all come from
 * TwoPointMarkup and TwoPointTool. That is the whole argument for the base
 * class — and the reason a fifth or sixth markup type costs almost nothing.
 */
export class RectangleMarkup extends TwoPointMarkup {
  getKind() {
    return RECTANGLE_KIND;
  }

  /** @param {object} dto @returns {RectangleMarkup} */
  static fromJSON(dto) {
    return new RectangleMarkup(...TwoPointMarkup.argsFromJSON(dto));
  }
}

AnnotationRegistry.register(RECTANGLE_KIND, RectangleMarkup.fromJSON);
