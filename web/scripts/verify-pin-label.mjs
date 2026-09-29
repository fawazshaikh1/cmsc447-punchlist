/**
 * Checks the description drawn beside a pin.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * A pin's description used to live only in the annotation's `/Contents`, which
 * a viewer shows on hover. That is invisible on paper and gone entirely once
 * the file is flattened, so an issued sheet showed a numbered circle and
 * nothing to say what the item was — or whether it had been done.
 *
 * Reported as: "i need the pin description to show, or else how would we know
 * if that thing is done or verified after completion".
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS SUITE EXISTS TO CATCH
 * ---------------------------------------------------------------------------
 * The label is drawn twice — SVG on the canvas, PDF operators in the export —
 * from one shared layout. The layout returns PDF space, where **Y is up**, and
 * the SVG side negates it.
 *
 * A sign error there is invisible on screen, because the canvas would simply
 * draw the box on the other side of the pin and still look plausible, and wrong
 * in the exported file. That is exactly how the cloud bug survived review.
 * `assignOrdinals` had a sibling problem and the same cure: assert the
 * GEOMETRY, where neither renderer can hide it.
 *
 *     npm run verify:pin-label
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFArray, StandardFonts } from 'pdf-lib';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/rules/index.js';
import {
  PIN_LABEL,
  PIN_RADIUS,
  NO_DESCRIPTION,
  layoutPinLabel,
} from '../src/domain/annotations/geometry/pinLabel.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { FlattenedSheetExporter } from '../src/infrastructure/export/FlattenedSheetExporter.js';
import { PdfLibSheetExporter } from '../src/infrastructure/export/PdfLibSheetExporter.js';

// --- fixtures ---------------------------------------------------------------

const SHEET = 'drawing.pdf#0';

function pin(label, status = PinStatus.OPEN) {
  return new Pin('p1', SHEET, new PdfPoint(300, 400), label, status, new Date('2026-09-24T12:00:00Z'));
}

async function blankSheet() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** Helvetica's real metrics, the same ones the writer measures with. */
let helvetica = null;
async function measurer() {
  if (!helvetica) {
    const doc = await PDFDocument.create();
    helvetica = await doc.embedFont(StandardFonts.Helvetica);
  }
  return (text, size) => helvetica.widthOfTextAtSize(text, size);
}

function decodeStream(stream) {
  const raw = stream?.getContents?.();
  if (!raw) return null;
  const bytes = Buffer.from(raw);
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return bytes.toString('latin1');
  }
}

/** Text drawn anywhere in the file, including inside appearance streams. */
async function textIn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const found = [];

  // Appearance streams first — a NATIVE export keeps its artwork there, not in
  // the page, so reading only page content would find nothing for that mode.
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const text = decodeStream(object);
    if (!text) continue;
    for (const match of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      found.push(match[1].replace(/\\([()\\])/g, '$1'));
    }
    for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      found.push(Buffer.from(match[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
    }
  }

  return found.join('\n');
}

/** The one annotation's /Rect, as numbers. */
async function rectOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const annotation = doc.context.lookup(annots.get(0));
  const rect = annotation.get(PDFName.of('Rect'));
  return Array.from({ length: rect.size() }, (_, i) => rect.get(i).asNumber());
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// --- the checks -------------------------------------------------------------

check('THE REPORTED BUG: the description is drawn on the flattened sheet', async () => {
  const { bytes } = await new FlattenedSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('Cracked tile at corridor entrance')] }],
    author: 'Verifier',
  });

  const text = await textIn(bytes);
  assert.match(text, /Cracked tile at corridor/, 'the words are on the drawing itself');
});

check('the status is drawn too, so "done" is readable without the app', async () => {
  for (const [status, expected] of [
    [PinStatus.OPEN, /OPEN/],
    [PinStatus.READY_FOR_REVIEW, /READY FOR REVIEW/],
    [PinStatus.CLOSED, /CLOSED/],
  ]) {
    const { bytes } = await new FlattenedSheetExporter().exportAnnotated({
      sourceBytes: await blankSheet(),
      pages: [{ pageIndex: 0, annotations: [pin('Re-grout', status)] }],
      author: 'Verifier',
    });
    assert.match(await textIn(bytes), expected, `status ${status} reaches the sheet`);
  }
});

check('a NATIVE export carries the same label', async () => {
  const bytes = await new PdfLibSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('Door binds on frame')] }],
    author: 'Verifier',
  });

  // Both modes draw from one writer, so a difference here would mean the
  // working copy and the issued PDF disagree about what the markup says.
  assert.match(await textIn(bytes), /Door binds on frame/);
});

check('Y IS UP: the first line sits above the last, and the box straddles the pin', async () => {
  const measure = await measurer();
  const layout = layoutPinLabel({
    description: 'A description long enough to need more than one line on the sheet',
    status: 'OPEN',
    measure,
  });

  assert.ok(layout.lines.length > 1, 'this fixture must actually wrap');

  // The trap. Negate the layout's Y anywhere and this reverses.
  for (let i = 1; i < layout.lineBaselines.length; i++) {
    assert.ok(
      layout.lineBaselines[i] < layout.lineBaselines[i - 1],
      `line ${i} must sit BELOW line ${i - 1} in a Y-up space`,
    );
  }

  assert.ok(layout.statusBaseline < layout.lineBaselines.at(-1), 'the status tag is last');
  assert.ok(layout.box.top > 0 && layout.box.bottom < 0, 'the box is centred on the pin');
  assert.equal(layout.box.top, -layout.box.bottom);
  assert.ok(layout.box.left > PIN_RADIUS, 'and clears the pin rather than sitting under it');
});

check('every baseline stays inside the box', async () => {
  const measure = await measurer();

  for (const description of [
    'Short',
    'A medium length description about tiling',
    'A very long description that will certainly need to be wrapped across several lines and then truncated because it simply keeps going well past any reasonable limit',
  ]) {
    const layout = layoutPinLabel({ description, status: 'OPEN', measure });
    const floor = layout.box.bottom;
    const ceiling = layout.box.top;

    for (const baseline of [...layout.lineBaselines, layout.statusBaseline]) {
      assert.ok(baseline < ceiling, `a baseline escaped the top for: ${description}`);
      assert.ok(baseline > floor, `a baseline escaped the bottom for: ${description}`);
    }

    for (const line of layout.lines) {
      assert.ok(
        measure(line, PIN_LABEL.fontSize) <= layout.box.width - PIN_LABEL.padding * 2 + 0.01,
        `a line is wider than its box for: ${description}`,
      );
    }
  }
});

check('a long description is truncated visibly, not silently', async () => {
  const measure = await measurer();
  const layout = layoutPinLabel({
    description:
      'Remove and replace the damaged ceiling grid throughout the east wing, including all hangers, and make good the adjacent finishes to the satisfaction of the architect',
    status: 'OPEN',
    measure,
  });

  assert.equal(layout.lines.length, PIN_LABEL.maxLines);
  // A description silently cut at three lines reads as a complete instruction.
  assert.match(layout.lines.at(-1), /\.\.\.$/, 'the cut is marked');
});

check('the truncation marker is ASCII, so both renderers can draw it', async () => {
  const measure = await measurer();
  const layout = layoutPinLabel({
    description: 'x'.repeat(40) + ' ' + 'y'.repeat(40) + ' ' + 'z'.repeat(40) + ' tail words here',
    status: 'OPEN',
    measure,
  });

  const joined = layout.lines.join('');
  // The PDF writer escapes to ASCII, so a U+2026 would survive on the canvas
  // and vanish in the export — the two disagreeing about the one glyph whose
  // job is to say "there is more".
  assert.ok(!joined.includes('…'), 'no real ellipsis character');
});

check('an item nobody wrote up still says so', async () => {
  const measure = await measurer();
  const layout = layoutPinLabel({ description: '   ', status: 'OPEN', measure });

  assert.deepEqual(layout.lines, [NO_DESCRIPTION]);
  assert.equal(layout.statusText, 'OPEN', 'and its status is still readable');
});

check('the annotation rectangle contains the label', async () => {
  const measure = await measurer();
  const description = 'Cracked tile at the corridor entrance, replace and re-grout';
  const layout = layoutPinLabel({ description, status: 'OPEN', measure });

  const bytes = await new PdfLibSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin(description)] }],
    author: 'Verifier',
  });

  // An annotation whose /Rect is smaller than its artwork is clipped by some
  // viewers, and MISPLACED by the flattener, which maps the appearance's BBox
  // onto the Rect. Either way the description would be lost again.
  const [left, bottom, right, top] = await rectOf(bytes);
  assert.ok(right >= 300 + layout.box.right, 'the rect reaches past the box');
  assert.ok(top >= 400 + layout.box.top, 'and over it');
  assert.ok(bottom <= 400 + layout.box.bottom, 'and under it');
  assert.ok(left <= 300 - PIN_RADIUS, 'while still covering the pin');
});

check('a description with brackets does not break the page', async () => {
  // Drawn with `Tj` inside a content stream, where an unescaped bracket
  // unbalances the stream and takes the whole page with it.
  const nasty = 'Replace (damaged) tile \\ see spec "3.2" — north corridor';

  const { bytes } = await new FlattenedSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin(nasty)] }],
    author: 'Verifier',
  });

  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 2, 'the drawing and its schedule both survived');
  assert.match(await textIn(bytes), /Replace \(damaged\) tile/);
});

check('a character Helvetica cannot encode does not kill the export', async () => {
  const measure = await measurer();

  // Not a bad label — the WHOLE EXPORT. pdf-lib's `widthOfTextAtSize` throws on
  // anything outside WinAnsi, so measuring an unsanitized description took the
  // file down over one emoji pasted into a punch item.
  const layout = layoutPinLabel({
    description: 'Replace “damaged” tile — see spec §3.2… ✅ 你好',
    status: 'OPEN',
    measure,
  });

  const joined = layout.lines.join(' ');
  assert.match(joined, /"damaged"/, 'smart quotes fold to ASCII');
  assert.match(joined, /- see spec/, 'and em dashes to hyphens');
  assert.ok(!/[✀-➿一-鿿]/.test(joined), 'the rest becomes a placeholder');

  // The real assertion: an export containing it completes.
  const { bytes } = await new FlattenedSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [
      {
        pageIndex: 0,
        annotations: [pin('Replace “damaged” tile — spec §3.2 ✅')],
      },
    ],
    author: 'Verifier',
  });
  assert.ok(bytes.length > 0);
});

check('an accented description is drawn properly, not mangled', async () => {
  const measure = await measurer();

  // WinAnsi covers U+00A0-U+00FF, so these are drawable and must NOT be folded
  // to question marks along with everything else.
  const layout = layoutPinLabel({
    description: 'Reparer la facade cote nord',
    status: 'OPEN',
    measure,
  });
  assert.match(layout.lines.join(' '), /Reparer la facade/);

  const accented = layoutPinLabel({ description: 'Café façade', status: 'OPEN', measure });
  assert.match(accented.lines.join(' '), /Café façade/, 'diacritics survive');
});

// --- runner -----------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

console.log(
  failed === 0
    ? `\n${checks.length}/${checks.length} pin label checks passed.`
    : `\n${failed} of ${checks.length} pin label checks FAILED.`,
);

process.exit(failed === 0 ? 0 : 1);
