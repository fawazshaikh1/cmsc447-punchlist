import { useEffect, useRef } from 'react';

/**
 * Paints a single PDF page. **This is SCRUM-18's deliverable.**
 *
 * Intentionally the dumbest component in the application: it holds no state,
 * handles no clicks, and knows nothing about annotations. All it does is ask
 * the page to draw itself whenever the view changes.
 *
 * Interaction lives entirely in the SVG overlay stacked on top (see
 * AnnotationLayer), which keeps "pixels" and "meaning" in separate components
 * that can be reasoned about — and broken — independently.
 *
 * @param {object} props
 * @param {import('../../domain/ports/DocumentSource').SheetPage} props.page
 * @param {number} props.scale
 * @param {number} props.rotation
 */
export function SheetCanvas({ page, scale, rotation }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handle = page.render(canvas, scale, rotation);

    // Cancel on cleanup. Without this, holding the zoom button queues several
    // renders against the same canvas; they complete out of order and the
    // sheet ends up painted at a stale scale.
    //
    // Note we do NOT await `handle.completed` anywhere — see the comment in
    // PdfJsSheetPage.render about that promise not settling in pdfjs-dist 6.3.
    return () => handle.cancel();
  }, [page, scale, rotation]);

  // `display: block` removes the inline-element baseline gap, which would
  // otherwise offset the absolutely-positioned overlay by a few pixels. A few
  // pixels of drift between what is drawn and what is clicked is exactly the
  // bug this whole design exists to rule out.
  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}
