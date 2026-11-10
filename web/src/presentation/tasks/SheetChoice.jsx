/**
 * @typedef {{ documentName: string, pageIndex: number }} SheetPick
 */

/**
 * Picks a drawing and one of its sheets, by name — "A-101 · LEVEL 1 FLOOR
 * PLAN" — for a new task on a sheet or for placing a task that was off one
 * (spec 6.4).
 *
 * @param {object} props
 * @param {string[]} props.drawings The project's drawings, by name.
 * @param {(documentName: string) => { pageIndex: number, label: string }[]} props.sheetsFor
 * @param {SheetPick} props.value
 * @param {(next: SheetPick) => void} props.onChange
 */
export function SheetChoice({ drawings, sheetsFor, value, onChange }) {
  const sheets = value.documentName ? sheetsFor(value.documentName) : [];

  return (
    <div className="sheet-choice">
      <label className="field">
        Drawing
        <select
          value={value.documentName}
          onChange={(event) =>
            onChange({ documentName: event.target.value, pageIndex: sheetsFor(event.target.value)[0]?.pageIndex ?? 0 })
          }
        >
          {drawings.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Sheet
        <select value={value.pageIndex} onChange={(event) => onChange({ ...value, pageIndex: Number(event.target.value) })}>
          {sheets.map(({ pageIndex, label }) => (
            <option key={pageIndex} value={pageIndex}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
