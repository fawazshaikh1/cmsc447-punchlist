/**
 * Barrel for the annotation model — and, more importantly, the one place that
 * guarantees every annotation subclass has actually been loaded.
 *
 * Subclasses register themselves with AnnotationRegistry as a side effect of
 * being imported. A class that is never imported is never registered, and its
 * stored rows then fail to decode at runtime. Importing every subclass here
 * makes that dependency explicit and greppable instead of accidental.
 *
 * ---------------------------------------------------------------------------
 * ADDING A MARKUP TYPE — the complete checklist
 * ---------------------------------------------------------------------------
 *   1. domain/annotations/YourMarkup.js  (extend Annotation or TwoPointMarkup,
 *                                         call AnnotationRegistry.register)
 *   2. presentation/components/markers/YourMarker.jsx  (MarkerRegistry.register)
 *   3. domain/tools/YourTool.js          (ToolRegistry.register) — or reuse
 *                                         TwoPointTool for a drag-shaped markup
 *   4. infrastructure/export/writers/YourWriter.js  (PdfWriterRegistry.register)
 *   5. one export line in each of the four index.js barrels
 *
 * No switch statements. No schema migration — kind-specific fields live in the
 * `payload` JSONB column. No edits to any existing annotation type.
 */
export { Annotation } from './Annotation';
export { AnnotationRegistry } from './AnnotationRegistry';
export { MarkupStyle } from './MarkupStyle';
export { TwoPointMarkup } from './TwoPointMarkup';
export { SourceAnnotation } from './SourceAnnotation';

export { Pin, PIN_KIND, PinStatus, isPinStatus } from './Pin';
export { RectangleMarkup, RECTANGLE_KIND } from './RectangleMarkup';
export { CloudMarkup, CLOUD_KIND } from './CloudMarkup';
export { ArrowMarkup, ARROW_KIND } from './ArrowMarkup';
export { InkMarkup, INK_KIND } from './InkMarkup';
export { TextMarkup, TEXT_KIND } from './TextMarkup';
