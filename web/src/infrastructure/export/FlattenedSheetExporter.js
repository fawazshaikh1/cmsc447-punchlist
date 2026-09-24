import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts } from 'pdf-lib';

import { SheetExporter } from '../../domain/ports/SheetExporter';
import { PunchListRegistry, assignOrdinals } from '../../domain/punchlist';
import { PdfWriterRegistry } from './PdfWriterRegistry';
import { PunchListPageWriter } from './PunchListPageWriter';
import { ensureDefaultFontResource } from './pdfPrimitives';
import './writers';

/**
 * SheetExporter that BURNS markups into the page instead of attaching them as
 * annotations. TIER 3.
 *
 * ===========================================================================
 * WHY THIS EXISTS — when "correct" is not the same as "visible"
 * ===========================================================================
 * `PdfLibSheetExporter` writes native PDF annotations. That is the better
 * artefact: the architect can select a markup, reply to it, mark it resolved,
 * and see it listed in the Comments panel. It is what the product should
 * default to.
 *
 * But an annotation is a REQUEST to a viewer, and every viewer honours that
 * request differently. Some regenerate appearances and ignore the one supplied.
 * Some are strict about entries others tolerate. Chasing per-viewer behaviour
 * is a game with no end, and while it is being chased the user cannot show
 * anybody their work.
 *
 * Flattened output is not a request. The markup becomes part of the page's
 * content stream — the same mechanism that draws the walls and the door
 * schedule. **If a viewer can display the drawing at all, it displays the
 * markups**, because by that point there is no distinction between them.
 *
 * ---------------------------------------------------------------------------
 * THE TRADE, STATED PLAINLY
 * ---------------------------------------------------------------------------
 *   native      selectable, repliable, listed in Comments, editable, and
 *               subject to each viewer's interpretation
 *   flattened   permanent, unselectable, invisible to the Comments panel,
 *               and visible absolutely everywhere
 *
 * Neither is "the right one". A markup set going back to the design team for
 * response wants native. A punch list going to a client, a subcontractor, or a
 * printer wants flattened, because the only thing that matters there is that
 * the marks are on the page.
 *
 * ---------------------------------------------------------------------------
 * HOW IT REUSES THE WRITERS
 * ---------------------------------------------------------------------------
 * It does NOT reimplement any drawing. It runs the exact same six writers, then
 * takes the appearance stream each one produced and paints it into the page
 * with a `Do` operator instead of hanging it off an annotation.
 *
 * That means a new markup type gets flattened export for free the moment it has
 * a writer — no second implementation to keep in sync, and no possibility of
 * the two exports disagreeing about what a cloud looks like.
 */
export class FlattenedSheetExporter extends SheetExporter {
  /**
   * @param {object} [options]
   * @param {import('../../domain/ports/MediaStore').MediaStore} [options.media]
   *        Where photo bytes are read from during export. Optional so an
   *        exporter with no photos to embed needs no wiring — a drawing marked
   *        up with boxes and clouds exports identically without it.
   * @param {PunchListPageWriter|null} [options.punchList]
   *        Appends the schedule of punch items. On by default, because
   *        flattening is precisely what destroys the descriptions — see
   *        PunchListPageWriter. Pass `null` for a plan-only PDF.
   */
  constructor({ media = null, punchList = new PunchListPageWriter() } = {}) {
    super();
    this.media = media;
    this.punchList = punchList;
  }

  /**
   * Yes — this is the exporter that makes markups permanent.
   *
   * Flattening burns each markup's appearance into the page's own content
   * stream and then removes the annotation object. What the architect opens is
   * a picture of the drawing as it stood at that moment: there is no annotation
   * left to select, move or delete, in any viewer.
   *
   * Because the app's copy can no longer be reconciled with the file that was
   * issued, those markups stop being editable here. SealedByExportPolicy
   * enforces that, on the strength of this one line.
   *
   * @returns {boolean}
   */
  seals() {
    return true;
  }

  /**
   * @param {import('../../domain/ports/SheetExporter').ExportRequest} request
   * @returns {Promise<{ bytes: Uint8Array, flattenedCount: number, flattenedPages: number }>}
   */
  async exportAnnotated({ sourceBytes, pages, author, documentName }) {
    const pdfDoc = await PDFDocument.load(sourceBytes.slice(0), { updateMetadata: false });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    ensureDefaultFontResource(pdfDoc, font);

    const pageCount = pdfDoc.getPageCount();

    // Numbered ONCE, up front, and shared by the writer that draws the pin and
    // the schedule that describes it. Two independent counts would be two
    // chances to disagree, and a schedule row pointing at the wrong mark on the
    // drawing is worse than no schedule at all.
    const ordinals = assignOrdinals(pages);

    // PASS 1 — add our markups as annotations, using the ordinary writers.
    for (const { pageIndex, annotations } of pages) {
      if (pageIndex < 0 || pageIndex >= pageCount) continue;
      const page = pdfDoc.getPage(pageIndex);
      // A sequential `for` rather than `forEach`, because one writer is async:
      // the photo writer reads bytes and embeds an image. `forEach` cannot await,
      // so the annotations would be scheduled and the document saved before any
      // of them had finished — an export with every photo missing.
      //
      // Sequential rather than Promise.all on purpose: pdf-lib's document is
      // mutable shared state, and appending to /Annots from several concurrent
      // writers is not something it promises to survive. Photos are few per
      // sheet, so the lost parallelism is not worth the risk.
      for (let index = 0; index < annotations.length; index++) {
        const annotation = annotations[index];

        await PdfWriterRegistry.write(annotation, {
          pdfDoc,
          page,
          author,
          font,
          index,
          // The number this markup carries among others of ITS OWN kind, across
          // the whole document. A pin numbered by its position in the sheet's
          // annotation list was numbered by how many boxes happened to be drawn
          // first — see assignOrdinals.
          ordinal: ordinals.get(annotation),
          // How a writer reaches image bytes. A function rather than the
          // store itself, so a writer cannot delete or overwrite media
          // while exporting — it can only read.
          loadMedia: (key) => this.media?.get(key) ?? Promise.resolve(null),
        });
      }
    }

    // PASS 2 — burn EVERY annotation on EVERY page into the page content.
    //
    // =======================================================================
    // WHY EVERY ANNOTATION, NOT JUST THE ONES WE ADDED
    // =======================================================================
    // The first version flattened only our own markups and left the source
    // file's annotations alone, on the reasoning that they were not ours to
    // touch. That produced a file that was HALF flattened, and it caused a
    // genuinely confusing bug report:
    //
    //   A user exported natively, re-opened that export, drew more markups,
    //   and exported flattened. The new markups appeared in Acrobat. The old
    //   ones — still annotations from the earlier export — did not. So
    //   "flattened export" looked like it was still dropping drawings and
    //   text, when in fact it had never touched them.
    //
    // "Flattened" has to mean what the word says: nothing is left for a viewer
    // to interpret. After this pass the file contains no markup annotations at
    // all, so there is nothing left that Acrobat can decline to render.
    //
    // The one exception is an annotation with no appearance stream — a /Text
    // sticky note, whose icon the viewer draws itself. There is no artwork to
    // burn in, so it stays. Our own pins are /Stamp precisely so that they DO
    // carry artwork and can be flattened.

    // How many annotations were actually burned into the page — OURS plus any
    // that were already in the file. The caller needs this to tell the truth
    // about an export, and the two counts are not interchangeable: re-opening
    // a previously exported drawing gives a file with markups in it and none of
    // them ours. See the note on the return.
    let flattenedTotal = 0;
    let flattenedPages = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pdfDoc.getPage(pageIndex);
      const refs = existingAnnotationRefs(page);
      if (refs.length === 0) continue;

      const operators = [];
      const flattened = [];

      for (const ref of refs) {
        const annotation = pdfDoc.context.lookup(ref);
        const appearance = appearanceStreamRef(pdfDoc, annotation);
        if (!appearance) continue;

        // Registered as a page resource, then invoked. `q`/`Q` save and restore
        // the graphics state so one markup's colour or line width cannot leak
        // into the next, or into the drawing itself.
        //
        // The `cm` between them is essential — see appearanceMatrix. Without it,
        // an annotation whose appearance is drawn in form-local coordinates
        // lands at the page origin instead of at its own position.
        const name = addXObjectToPage(pdfDoc, page, appearance);
        const [a, b, c, d, e, f] = appearanceMatrix(pdfDoc, annotation, appearance);
        operators.push(
          `q ${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)} cm /${name} Do Q`,
        );
        flattened.push(ref);
      }

      if (operators.length > 0) {
        appendContentStream(pdfDoc, page, operators.join('\n'));
        // Removed only after being painted — leaving them would draw every
        // markup twice, once as content and once as an annotation.
        removeAnnotations(page, flattened);
        flattenedTotal += flattened.length;
        flattenedPages += 1;
      }
    }

    // PASS 3 — append the punch list schedule.
    //
    // AFTER pass 2, deliberately. The schedule pages carry no annotations, so
    // flattening would skip them anyway, but appending last also keeps the
    // numbering above from depending on pages that did not exist when it ran.
    await this.punchList?.append(pdfDoc, PunchListRegistry.collect(pages, ordinals), {
      documentName,
      issuedBy: author,
    });

    // ======================================================================
    // WHY THIS RETURNS AN OBJECT WHERE THE CONTRACT SAYS Uint8Array
    // ======================================================================
    // `SheetExporter` accepts either, and `ExportService` normalises. Widening
    // it that way rather than changing the contract outright means
    // PdfLibSheetExporter still returns bare bytes and was not touched.
    //
    // The count matters because of a real fault: export a working copy, reopen
    // it, and press Issue. The markups are all THERE — but they are the file's
    // annotations now, not ours, so our own count is zero and the app reported
    // "no markups yet" while refusing to flatten a drawing covered in them.
    // This is the number that makes the difference visible to the caller.
    return {
      bytes: await pdfDoc.save(),
      flattenedCount: flattenedTotal,
      flattenedPages,
    };
  }
}

/** Formats a matrix component for a content stream. */
function fmt(value) {
  return Number.isFinite(value) ? Number(value).toFixed(5) : '0';
}

/** Reads a numeric array entry, or null. */
function numbers(dict, key) {
  const value = dict?.get?.(PDFName.of(key));
  if (!(value instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < value.size(); i++) out.push(Number(value.get(i).asNumber?.() ?? value.get(i).value?.() ?? NaN));
  return out.every(Number.isFinite) ? out : null;
}

/**
 * The matrix that places an annotation's appearance stream on the page.
 *
 * ===========================================================================
 * BUG THIS FIXES — the only misplaced markup was the one we did not author
 * ===========================================================================
 * Flattening originally emitted a bare `q /Name Do Q`, which draws a form
 * XObject in whatever coordinates its own content stream uses. That happens to
 * be correct for OUR annotations, because our writers deliberately set
 * `BBox === Rect` and draw in page coordinates (see createAppearance). So every
 * markup the app produced landed perfectly.
 *
 * It is NOT correct in general. Most tools draw an appearance in FORM-LOCAL
 * coordinates — a BBox of `[0 0 w h]` with the artwork at the origin — and rely
 * on the viewer mapping that box onto the annotation's `/Rect`. Flatten one of
 * those with a bare `Do` and it snaps to the page origin.
 *
 * That is exactly what was reported: a drawing marked up elsewhere, then
 * flattened here, came out with one box translated down and to the left by
 * roughly its own `/Rect` offset — while every markup drawn in this app was
 * fine. The bug was invisible for as long as we only ever flattened our own
 * work.
 *
 * ---------------------------------------------------------------------------
 * THE ALGORITHM (PDF 32000-1 §12.5.5)
 * ---------------------------------------------------------------------------
 *   1. Map the four corners of /BBox through the form's /Matrix.
 *   2. Take the bounding box of those transformed corners.
 *   3. Compute matrix A that maps that bounding box onto /Rect.
 *
 * `Do` applies the form's own /Matrix itself, so only A is emitted here as a
 * `cm`. For our own annotations BBox equals Rect and Matrix is identity, so A
 * comes out as the identity matrix and nothing changes — which is why this fix
 * cannot regress anything that was already working.
 */
function appearanceMatrix(pdfDoc, annotation, appearanceRef) {
  const IDENTITY = [1, 0, 0, 1, 0, 0];

  const rawRect = numbers(annotation, 'Rect');
  const stream = pdfDoc.context.lookup(appearanceRef);
  const bbox = numbers(stream?.dict, 'BBox');
  if (!rawRect || !bbox) return IDENTITY;

  // A /Rect is not guaranteed to be given lower-left first.
  const rect = [
    Math.min(rawRect[0], rawRect[2]),
    Math.min(rawRect[1], rawRect[3]),
    Math.max(rawRect[0], rawRect[2]),
    Math.max(rawRect[1], rawRect[3]),
  ];

  const m = numbers(stream?.dict, 'Matrix') ?? IDENTITY;

  // Step 1 and 2: the transformed BBox's bounding box.
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);

  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const by0 = Math.min(...ys);
  const by1 = Math.max(...ys);

  // Step 3: scale that box to the Rect, then translate it into place.
  // A degenerate box would divide by zero; fall back to no scaling, which at
  // least positions the artwork correctly.
  const sx = bx1 - bx0 === 0 ? 1 : (rect[2] - rect[0]) / (bx1 - bx0);
  const sy = by1 - by0 === 0 ? 1 : (rect[3] - rect[1]) / (by1 - by0);

  return [sx, 0, 0, sy, rect[0] - bx0 * sx, rect[1] - by0 * sy];
}

/** Object references currently in a page's `/Annots`. */
function existingAnnotationRefs(page) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return [];
  const refs = [];
  for (let i = 0; i < annots.size(); i++) refs.push(annots.get(i));
  return refs;
}

/** The `/AP /N` reference of an annotation, or null when it has none. */
function appearanceStreamRef(pdfDoc, annotation) {
  const ap = annotation?.get?.(PDFName.of('AP'));
  if (!ap) return null;
  const apDict = pdfDoc.context.lookup(ap, PDFDict);
  return apDict?.get(PDFName.of('N')) ?? null;
}

let xobjectCounter = 0;

/**
 * Registers a form XObject in a page's resources and returns the name to
 * invoke it with.
 *
 * The name is unique per export run. Reusing a name that the source document
 * already defines would silently replace part of the drawing with a markup.
 */
function addXObjectToPage(pdfDoc, page, streamRef) {
  let resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
  if (!resources) {
    resources = pdfDoc.context.obj({});
    page.node.set(PDFName.of('Resources'), resources);
  }

  let xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) {
    xobjects = pdfDoc.context.obj({});
    resources.set(PDFName.of('XObject'), xobjects);
  }

  const name = `PLMarkup${xobjectCounter++}`;
  xobjects.set(PDFName.of(name), streamRef);
  return name;
}

/** Removes specific annotation references from a page. */
function removeAnnotations(page, refs) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  // Walked backwards so removing by index does not shift the ones still to
  // be checked.
  for (let i = annots.size() - 1; i >= 0; i--) {
    if (refs.includes(annots.get(i))) annots.remove(i);
  }
}

/**
 * Appends operators to a page as an additional content stream.
 *
 * =========================================================================
 * WHY NOT `page.pushOperators`
 * =========================================================================
 * pdf-lib's operator API validates its argument is a real `PDFOperator`
 * instance, so raw operator text is rejected. Building PDFOperator objects for
 * every path segment of a freehand stroke would be slow and pointless — we
 * already hold exactly the operators we want, as text, in the appearance
 * streams the writers produced.
 *
 * A page's `/Contents` may legally be an ARRAY of streams which the viewer
 * concatenates, so appending one more is both spec-sanctioned and the least
 * invasive way to add to a page. The original stream objects are not rewritten,
 * only referenced alongside the new one.
 *
 * ---------------------------------------------------------------------------
 * THE q/Q SANDWICH
 * ---------------------------------------------------------------------------
 * The streams are concatenated as if they were one, so a graphics state left
 * unbalanced by the drawing would leak into our markups — and worse, an
 * unbalanced state of OURS would corrupt the drawing. Wrapping the original in
 * `q` … `Q` and our additions in their own `q` … `Q` makes each side immune to
 * the other regardless of how the source document was authored.
 */
function appendContentStream(pdfDoc, page, operatorText) {
  const before = pdfDoc.context.register(pdfDoc.context.stream('q'));
  const after = pdfDoc.context.register(pdfDoc.context.stream(`Q\nq\n${operatorText}\nQ`));

  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = pdfDoc.context.lookup(contents);

  if (resolved instanceof PDFArray) {
    resolved.insert(0, before);
    resolved.push(after);
    return;
  }

  // A single stream: promote it to an array of three.
  page.node.set(PDFName.of('Contents'), pdfDoc.context.obj([before, contents, after]));
}

