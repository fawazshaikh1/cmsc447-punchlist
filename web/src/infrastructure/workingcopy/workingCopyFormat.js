import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';

/**
 * How a working copy carries our markups — the one place the format is
 * defined, so the exporter that writes it and the reader that reads it cannot
 * drift apart.
 *
 * ===========================================================================
 * THE FORMAT
 * ===========================================================================
 * Two private keys. The PDF specification lets an annotation or the catalog
 * carry keys a viewer does not know, and every viewer ignores them, so
 * Acrobat, Bluebeam and Chrome show the file exactly as before.
 *
 *   on each annotation   /PunchListMarkup <hex string>
 *                        UTF-16 JSON: { v: 1, annotation: <Annotation.toJSON()> }
 *                        Per annotation, not one list for the document, so an
 *                        annotation someone deleted in Acrobat is gone from
 *                        our data too — a list would bring it back.
 *
 *   on the catalog       /PunchListWorkingCopy <ref to a small stream>
 *                        Exists only so a file can be RECOGNISED cheaply.
 *                        Annotation dictionaries are usually packed into
 *                        compressed object streams, where a byte search cannot
 *                        see them; a stream's own dictionary is always written
 *                        in plain text. So "/PunchListWorkingCopy" appears in
 *                        the raw bytes of every working copy, and opening any
 *                        other PDF costs one scan and no parse.
 */

export const MARKUP_KEY = 'PunchListMarkup';
export const DOCUMENT_KEY = 'PunchListWorkingCopy';
export const FORMAT_VERSION = 1;

/** Anything bigger is not something we wrote — a pin's data is a few hundred bytes. */
const MAX_MARKUP_CHARS = 256 * 1024;

const SIGNATURE = new TextEncoder().encode(DOCUMENT_KEY);

/** @param {import('pdf-lib').PDFPage} page */
function annotsOf(page) {
  return page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
}

/** @param {import('pdf-lib').PDFPage} page @returns {number} */
export function annotationCount(page) {
  return annotsOf(page)?.size() ?? 0;
}

/**
 * Stamps every annotation appended to `page` since `since` with the markup it
 * was written for. Writer-agnostic: the exporter calls this around each write,
 * so no writer has to know the format exists.
 *
 * @param {import('pdf-lib').PDFPage} page
 * @param {number} since `annotationCount(page)` before the write.
 * @param {import('../../domain/annotations').Annotation} annotation
 * @returns {number} How many annotation dictionaries were stamped.
 */
export function tagAnnotationsSince(page, since, annotation) {
  const annots = annotsOf(page);
  if (!annots) return 0;

  const payload = PDFHexString.fromText(
    JSON.stringify({ v: FORMAT_VERSION, annotation: annotation.toJSON() }),
  );

  let tagged = 0;
  for (let index = since; index < annots.size(); index++) {
    const dict = annotationAt(annots, index);
    if (!dict) continue;
    dict.set(PDFName.of(MARKUP_KEY), payload);
    tagged += 1;
  }
  return tagged;
}

/** Marks the document as a working copy. Idempotent. @param {import('pdf-lib').PDFDocument} pdfDoc */
export function markDocument(pdfDoc) {
  if (pdfDoc.catalog.has(PDFName.of(DOCUMENT_KEY))) return;

  const marker = pdfDoc.context.stream(
    'Markups exported by Punch List. Each one carries its data under /PunchListMarkup.',
    { Type: DOCUMENT_KEY, Version: FORMAT_VERSION },
  );
  pdfDoc.catalog.set(PDFName.of(DOCUMENT_KEY), pdfDoc.context.register(marker));
}

/** @param {import('pdf-lib').PDFDocument} pdfDoc */
export function unmarkDocument(pdfDoc) {
  const ref = pdfDoc.catalog.get(PDFName.of(DOCUMENT_KEY));
  if (ref instanceof PDFRef) pdfDoc.context.delete(ref);
  pdfDoc.catalog.delete(PDFName.of(DOCUMENT_KEY));
}

/**
 * The markup an annotation dictionary was written for, or null when it is
 * not one of ours, is from a format version we do not read, or is damaged.
 *
 * @param {PDFDict|undefined} dict
 * @returns {object|null} `Annotation.toJSON()` as exported.
 */
export function readMarkup(dict) {
  try {
    const value = dict?.lookupMaybe(PDFName.of(MARKUP_KEY), PDFHexString, PDFString);
    if (!value) return null;

    const text = value.decodeText();
    if (text.length > MAX_MARKUP_CHARS) return null;

    const parsed = JSON.parse(text);
    const annotation = parsed?.annotation;
    if (parsed?.v !== FORMAT_VERSION || !annotation || typeof annotation !== 'object') return null;
    return annotation;
  } catch {
    return null;
  }
}

/**
 * Whether these bytes may be a working copy. A false here is certain; a true
 * means "worth parsing". Runs on every file opened, so it is a plain scan with
 * no allocation proportional to the file.
 *
 * @param {Uint8Array} bytes
 */
export function mightBeWorkingCopy(bytes) {
  const first = SIGNATURE[0];
  const last = bytes.length - SIGNATURE.length;

  outer: for (let start = bytes.indexOf(first); start !== -1 && start <= last; start = bytes.indexOf(first, start + 1)) {
    for (let offset = 1; offset < SIGNATURE.length; offset++) {
      if (bytes[start + offset] !== SIGNATURE[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Removes an annotation from a page and deletes the objects only it used —
 * the annotation itself, its appearance streams, and any image those streams
 * draw. Without this the objects stay in the file unreferenced, and a working
 * copy opened and re-exported five times would carry five copies of every
 * photo.
 *
 * Fonts are left alone: one Helvetica is shared by every text markup.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {PDFArray} annots
 * @param {number} index
 */
export function removeAnnotation(pdfDoc, annots, index) {
  const { context } = pdfDoc;
  const entry = annots.get(index);
  const dict = annotationAt(annots, index);
  annots.remove(index);

  const appearances = dict?.lookupMaybe(PDFName.of('AP'), PDFDict);
  for (const state of ['N', 'R', 'D']) {
    const ref = appearances?.get(PDFName.of(state));
    if (!(ref instanceof PDFRef)) continue;

    const xobjects = dictionaryOf(context.lookup(ref))
      ?.lookupMaybe(PDFName.of('Resources'), PDFDict)
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const value of xobjects?.values() ?? []) {
      if (value instanceof PDFRef && isImage(context, value)) context.delete(value);
    }

    context.delete(ref);
  }

  if (entry instanceof PDFRef) context.delete(entry);
}

/**
 * The annotation dictionary at `index`, or undefined for anything else. A
 * malformed entry — a number, a dangling reference — is skipped rather than
 * allowed to stop the rest of the page being read.
 *
 * @param {PDFArray} annots
 * @param {number} index
 * @returns {PDFDict|undefined}
 */
export function annotationAt(annots, index) {
  try {
    const object = annots.lookup(index);
    return object instanceof PDFDict ? object : undefined;
  } catch {
    return undefined;
  }
}

/** A stream's dictionary, or the object itself when it is already a dictionary. */
function dictionaryOf(object) {
  if (object instanceof PDFDict) return object;
  return object?.dict instanceof PDFDict ? object.dict : undefined;
}

function isImage(context, ref) {
  const dict = dictionaryOf(context.lookup(ref));
  return dict?.get(PDFName.of('Subtype'))?.toString() === '/Image';
}
