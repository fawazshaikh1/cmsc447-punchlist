import { RectangleMarkup } from '../annotations/RectangleMarkup';
import { CloudMarkup } from '../annotations/CloudMarkup';
import { ArrowMarkup } from '../annotations/ArrowMarkup';
import { TwoPointTool } from './TwoPointTool';

/**
 * The three drag-shaped tools.
 *
 * Grouped in one file precisely BECAUSE each is four lines — splitting them
 * across three files would be more ceremony than content. They stay together
 * only while they remain this trivial; the moment one grows behaviour of its
 * own (snapping, constrained aspect ratio, multi-segment arrows) it moves to
 * its own file, and nothing else has to change when it does.
 *
 * Every one of them inherits the complete press/drag/release interaction,
 * degenerate-gesture rejection, style handling and immutable draft rebuilding
 * from TwoPointTool. This file is the evidence that the abstraction paid off.
 */

export class RectangleTool extends TwoPointTool {
  getId() {
    return 'rectangle';
  }

  getLabel() {
    return 'Box';
  }

  createMarkup(...args) {
    return new RectangleMarkup(...args);
  }
}

export class CloudTool extends TwoPointTool {
  getId() {
    return 'cloud';
  }

  getLabel() {
    return 'Cloud';
  }

  createMarkup(...args) {
    return new CloudMarkup(...args);
  }
}

export class ArrowTool extends TwoPointTool {
  getId() {
    return 'arrow';
  }

  getLabel() {
    return 'Arrow';
  }

  createMarkup(...args) {
    return new ArrowMarkup(...args);
  }
}
