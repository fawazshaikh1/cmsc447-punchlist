import { ToolRegistry } from '../../domain/tools';
import { MarkupStyle } from '../../domain/annotations';

/** Colours a punch walk actually uses. */
const SWATCHES = [
  { color: '#e8342a', title: 'Red — issue' },
  { color: '#e2960b', title: 'Amber — review' },
  { color: '#1f9d4d', title: 'Green — accepted' },
  { color: '#1f5fd4', title: 'Blue — note' },
];

/**
 * Tool and colour picker.
 *
 * ---------------------------------------------------------------------------
 * NOTE WHAT IS ABSENT
 * ---------------------------------------------------------------------------
 * There is no list of tools in this file. It renders `ToolRegistry.all()`,
 * whose contents and order are declared in `domain/tools/index.js`. Registering
 * a seventh tool there makes it appear here with no edit to this component —
 * which is the same property the four registries give the model, the renderer,
 * the deserialiser and the exporter.
 *
 * The palette is presentation only: it reports which tool id and style the user
 * chose and holds no state of its own.
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
    <div className="tool-palette">
      <div className="tool-group">
        {/* Titles name the specific step, so hovering tells you what you are
            about to reverse rather than just "undo". */}
        <button
          type="button"
          className="tool"
          onClick={onUndo}
          disabled={!canUndo}
          title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className="tool"
          onClick={onRedo}
          disabled={!canRedo}
          title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
        >
          ↷ Redo
        </button>
      </div>

      <div className="tool-group" role="radiogroup" aria-label="Markup tool">
        {ToolRegistry.all().map((tool) => (
          <button
            key={tool.getId()}
            type="button"
            role="radio"
            aria-checked={tool.getId() === activeToolId}
            className={tool.getId() === activeToolId ? 'tool active' : 'tool'}
            onClick={() => onSelectTool(tool.getId())}
          >
            {tool.getLabel()}
          </button>
        ))}
      </div>

      <div className="tool-group" role="radiogroup" aria-label="Markup colour">
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

      {/* Only offered when the file actually has some — a toggle for something
          that does not exist is just noise on the toolbar.
          The label says WHOSE they are, because the first question anyone asked
          on seeing them was "what are these and why are there boxes?" */}
      {sourceCount > 0 && (
        <label
          className="stroke-picker"
          title={
            'Markups that were already inside this PDF file before you opened it — ' +
            'from whoever sent it, or from a copy you exported earlier. ' +
            'They are read-only and are already in the file, so they are never exported again.'
          }
        >
          <input type="checkbox" checked={showSource} onChange={onToggleSource} />
          Show {sourceCount} markup{sourceCount === 1 ? '' : 's'} already in this file
        </label>
      )}

      <label className="stroke-picker">
        Weight
        <select
          value={style.strokeWidth}
          onChange={(event) =>
            onChangeStyle(new MarkupStyle(style.color, Number(event.target.value)))
          }
        >
          <option value={1}>Thin</option>
          <option value={2}>Medium</option>
          <option value={4}>Thick</option>
          <option value={7}>Heavy</option>
        </select>
      </label>
    </div>
  );
}
