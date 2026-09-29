import { useMemo } from 'react';

/**
 * Evidence panel for coordinate anchoring.
 *
 * For each annotation it shows the STORED PDF point (which must never change),
 * the SCREEN position it currently maps to (which must change as you zoom), and
 * a round-trip check that converts screen -> PDF -> screen and asserts the
 * result matches what went in.
 *
 * This is not decoration. A spike's deliverable is a DEMONSTRATED answer, and
 * "the pins look right" is not one. This table is what you screenshot for the
 * spike write-up and what you put in front of the stakeholder: zoom from 1x to
 * 4x and the PDF column is visibly frozen while the screen column scales.
 *
 * >>> Delete this, or hide it behind a dev flag, once the spikes are accepted.
 * >>> It is a diagnostic, not a product feature.
 *
 * @param {object} props
 * @param {import('../../domain/ports/DocumentSource').SheetPage} props.page
 * @param {number} props.scale
 * @param {number} props.rotation
 * @param {import('../../domain/annotations/Annotation').Annotation[]} props.annotations
 * @param {string | null} props.selectedId
 * @param {() => void} props.onClear
 */
export function CoordinateInspector({
  page,
  scale,
  rotation,
  annotations,
  selectedId,
  onClear,
}) {
  const transformer = useMemo(
    () => page.createTransformer(scale, rotation),
    [page, scale, rotation],
  );

  const geometry = page.getGeometry();

  const rows = annotations.map((annotation, index) => {
    const pdf = annotation.getAnchor();
    const screen = transformer.toViewportPoint(pdf);
    const roundTripped = transformer.toPdfPoint(screen);

    return {
      id: annotation.id,
      ordinal: index + 1,
      kind: annotation.getKind(),
      pdf,
      screen,
      // 0.01pt tolerance — about 1/7000 inch. Looser would hide a real
      // transform error; tighter would trip on IEEE-754 rounding.
      exact: roundTripped.equals(pdf, 0.01),
    };
  });

  const allExact = rows.every((row) => row.exact);

  return (
    <section className="inspector">
      <header className="inspector-header">
        <h2>Coordinate inspector</h2>
        <span className="muted">
          page {geometry.width}&times;{geometry.height} pts &middot; zoom {scale.toFixed(2)}x
          &middot; rotation {rotation}&deg;
        </span>
        <button type="button" onClick={onClear} disabled={rows.length === 0}>
          Clear pins
        </button>
      </header>

      {rows.length === 0 ? (
        <p className="muted">
          Click the drawing to drop a pin. Then zoom &mdash; the PDF column must not move.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Kind</th>
                <th>Stored PDF point (frozen)</th>
                <th>Screen position @ {scale.toFixed(2)}x</th>
                <th>Round-trip exact?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.id === selectedId ? 'selected' : undefined}>
                  <td>{row.ordinal}</td>
                  <td>{row.kind}</td>
                  <td className="mono">
                    {row.pdf.x.toFixed(2)}, {row.pdf.y.toFixed(2)}
                  </td>
                  <td className="mono">
                    {row.screen.x.toFixed(1)}, {row.screen.y.toFixed(1)}
                  </td>
                  <td className={row.exact ? 'pass' : 'fail'}>{row.exact ? 'yes' : 'NO'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className={allExact ? 'pass' : 'fail'}>
            {allExact
              ? `${rows.length} markup(s) anchored — every coordinate round-trips exactly.`
              : 'A coordinate lost precision on round-trip. This should not happen.'}
          </p>
        </>
      )}
    </section>
  );
}
