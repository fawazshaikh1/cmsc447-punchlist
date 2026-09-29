import { ToolRegistry } from './ToolRegistry';
import { SelectTool } from './SelectTool';
import { PinTool } from './PinTool';
import { RectangleTool, CloudTool, ArrowTool } from './ShapeTools';
import { InkTool } from './InkTool';
import { TextTool } from './TextTool';
import { PhotoTool } from './PhotoTool';

/**
 * Registers the drawing tools.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS BARREL REGISTERS EXPLICITLY INSTEAD OF SELF-REGISTERING
 * ---------------------------------------------------------------------------
 * The annotation classes and marker components register themselves at the
 * bottom of their own files. Tools deliberately do not, because ToolRegistry
 * preserves INSERTION ORDER and that order is the palette the user sees.
 *
 * Self-registration would make the palette order depend on module import order
 * — which is decided by the bundler, can change when an unrelated import is
 * added, and is invisible in code review. Registering here makes the running
 * order of the toolbar an explicit, reviewable list.
 *
 * >>> The order below IS the palette order. Select is first, so it is the
 * >>> default tool (ToolRegistry.default() returns the first registered).
 *
 * Select leads deliberately. Opening a drawing in a mode that MODIFIES it on
 * the first tap is hostile — a user exploring a 153-page set with a finger
 * would scatter pins across it before working out how to stop. Starting in a
 * mode that only inspects means the first tap is always safe.
 */
ToolRegistry.register(new SelectTool());
ToolRegistry.register(new PinTool());
ToolRegistry.register(new RectangleTool());
ToolRegistry.register(new CloudTool());
ToolRegistry.register(new ArrowTool());
ToolRegistry.register(new InkTool());
ToolRegistry.register(new TextTool());
ToolRegistry.register(new PhotoTool());

export { ToolRegistry } from './ToolRegistry';
export { AnnotationTool } from './AnnotationTool';
export { SelectTool } from './SelectTool';
export { TwoPointTool } from './TwoPointTool';
export { PinTool } from './PinTool';
export { RectangleTool, CloudTool, ArrowTool } from './ShapeTools';
export { InkTool } from './InkTool';
export { TextTool } from './TextTool';
export { PhotoTool } from './PhotoTool';
