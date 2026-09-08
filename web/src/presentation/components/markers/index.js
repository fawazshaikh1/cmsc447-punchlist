/**
 * Loads every marker component so each registers itself with MarkerRegistry.
 *
 * Registration is an import side effect, so it has to happen somewhere
 * deliberate and greppable rather than by accident.
 *
 * >>> ADDING A MARKUP TYPE: add its export line below.
 */
export { MarkerRegistry } from './MarkerRegistry';

export { PinMarker } from './PinMarker';
export { RectangleMarker } from './RectangleMarker';
export { CloudMarker } from './CloudMarker';
export { ArrowMarker } from './ArrowMarker';
export { InkMarker } from './InkMarker';
export { TextMarker } from './TextMarker';
