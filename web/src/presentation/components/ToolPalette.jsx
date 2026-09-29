import { ToolRegistry } from '../../domain/tools';
import { MarkupStyle } from '../../domain/annotations';
import { Icon } from './Icon';

/** Colours a punch walk actually uses. Each one MEANS something. */
const SWATCHES = [
  { color: '#e8342a', title: 'Red — issue' },
  { color: '#d08700', title: 'Amber — review' },
  { color: '#1f9d4d', title: 'Green — accepted' },
  { color: '#1f5fd4', title: 'Blue — note' },
];

/**
 * Tool id to icon name.
 *
 * A lookup rather than a property on the tool, because an icon is a
 * presentation choice and `AnnotationTool` lives in the domain — giving a
 * domain class an SVG name would be the dependency rule backwards. A tool with
 * no entry falls back to a generic mark, so a new tool appears and works
 * immediately; drawing it a glyph is a separate, optional step.
 */
const TOOL_ICONS = {
  select: 'select',
  pin: 'pin',
  rectangle: 'box',
  cloud: 'cloud',
  arrow: 'arrow',
  ink: 'draw',
  text: 'text',
  photo: 'photo',
};

/**
 * The tool rail.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RUNS DOWN THE LEFT RATHER THAN ACROSS THE TOP
 * ---------------------------------------------------------------------------
 * The target device is an iPad held in one hand. A rail on the left edge is
 * where the holding thumb already is; a toolbar across the top means reaching
 * across the drawing to change tools, which on a site means putting the tablet
 * down. It also gives the sheet the full height of the screen, and an
 * architectural sheet is almost always wider than it is tall.
 *
 * ---------------------------------------------------------------------------
 * NOTE WHAT IS ABSENT
 * ---------------------------------------------------------------------------
 * There is no list of tools in this file. It renders `ToolRegistry.all()`,
 * whose contents and order are declared in `domain/tools/index.js`. Photo was
 * the eighth tool and appeared here without this component being edited — the
 * same property the registries give the model, the renderer and the exporter.
 */
export function ToolPalette({
  activeToolId,
  onSelectTool,
  style,
  onChangeStyle,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  sourceCount = 0,
  showSource,
  onToggleSource,
}) {
  return (
    <nav className="tool-rail" aria-label="Markup tools">
      {/* Titles name the specific step, so hovering tells you what you are
          about to reverse rather than just "undo". */}
      <button
        type="button"
        className="tool"
        onClick={onUndo}
        disabled={!canUndo}
        title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
        aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
      >
        <Icon name="undo" size={22} />
        <span className="tool-label">Undo</span>
      </button>

      <button
        type="button"
        className="tool"
        onClick={onRedo}
        disabled={!canRedo}
        title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
        aria-label={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
      >
        <Icon name="redo" size={22} />
        <span className="tool-label">Redo</span>
      </button>

      <div className="rail-divider" />

      <div role="radiogroup" aria-label="Markup tool" style={{ display: 'contents' }}>
        {ToolRegistry.all().map((tool) => {
          const id = tool.getId();
          const isActive = id === activeToolId;

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={isActive ? 'tool active' : 'tool'}
              onClick={() => onSelectTool(id)}
              title={tool.getLabel()}
            >
              <Icon name={TOOL_ICONS[id] ?? 'draw'} size={22} />
              <span className="tool-label">{tool.getLabel()}</span>
            </button>
          );
        })}
      </div>

      <div className="rail-divider" />

      <div className="swatches" role="radiogroup" aria-label="Markup colour">
        {SWATCHES.map(({ color, title }) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === style.color}
            aria-label={title}
            title={title}
            className={color === style.color ? 'swatch active' : 'swatch'}
            style={{ background: color }}
            onClick={() => onChangeStyle(new MarkupStyle(color, style.strokeWidth))}
          />
        ))}
      </div>

      <label className="tool-label muted" htmlFor="stroke-weight" style={{ marginTop: 4 }}>
        Weight
      </label>
      <select
        id="stroke-weight"
        className="rail-select"
        value={style.strokeWidth}
        onChange={(event) =>
          onChangeStyle(new MarkupStyle(style.color, Number(event.target.value)))
        }
      >
        <option value={1}>Thin</option>
        <option value={2}>Med</option>
        <option value={4}>Thick</option>
        <option value={7}>Heavy</option>
      </select>

      {/* Only offered when the file actually has some — a toggle for something
          that does not exist is just noise.
          The title says WHOSE they are, because the first question anyone asked
          on seeing them was "what are these and why are there boxes?" */}
      {sourceCount > 0 && (
        <>
          <div className="rail-divider" />
          <button
            type="button"
            className={showSource ? 'tool active' : 'tool'}
            onClick={onToggleSource}
            aria-pressed={showSource}
            title={
              `${sourceCount} markup${sourceCount === 1 ? ' was' : 's were'} already inside this ` +
              'PDF before you opened it — from whoever sent it, or from a copy you exported ' +
              'earlier. They are read-only and are never exported again.'
            }
          >
            <Icon name="layers" size={22} />
            <span className="tool-label">Existing</span>
          </button>
        </>
      )}
    </nav>
  );
}
