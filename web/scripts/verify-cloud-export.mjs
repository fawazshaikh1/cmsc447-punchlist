/**
 * Checks that an exported revision cloud is drawn whole.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * A cloud's appearance is a form XObject, and a form XObject draws nothing
 * outside its /BBox. The issued PDF paints that same appearance into the page,
 * so whatever falls outside the box is simply gone — found on the live site,
 * where a cloud came out of "Issue PDF" with the bulges on its left and right
 * sides cut off flat while the screen showed them whole.
 *
 * So for clouds of every proportion — wide, tall, square, tiny — every point
 * of the scalloped path the writer strokes, widened by the stroke, must lie
 * inside the annotation's /Rect, and the appearance's /BBox must be that /Rect.
 *
 * Run with: npm run verify -- cloud
 */
import assert from 'node:assert/strict';

import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';

import '../src/domain/annotations/index.js';
import { CloudMarkup } from '../src/domain/annotations/CloudMarkup.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import { arcToBeziers, scallopArcs } from '../src/domain/annotations/geometry/scallops.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { PdfWriterRegistry } from '../src/infrastructure/export/PdfWriterRegistry.js';
import '../src/infrastructure/export/writers/index.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/** Exports one cloud onto a fresh page and reads back what was written. */
async function exportCloud(x0, y0, x1, y1, strokeWidth = 2) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([2592, 1728]);
  const cloud = new CloudMarkup(
    'c1',
    'p1:a.pdf#0',
    new PdfPoint(x0, y0),
    new PdfPoint(x1, y1),
    new MarkupStyle(MarkupStyle.DEFAULT_COLOR, strokeWidth),
    new Date(Date.UTC(2026, 10, 1)),
  );
  await PdfWriterRegistry.write(cloud, { pdfDoc, page, author: 'verify' });

  const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
  const annot = annots.lookup(annots.size() - 1);
  const numbers = (array) => array.asArray().map((n) => n.asNumber());
  const rect = numbers(annot.lookup(PDFName.of('Rect'), PDFArray));
  const appearance = annot.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const bbox = numbers(appearance.dict.lookup(PDFName.of('BBox'), PDFArray));
  return { cloud, rect, bbox, strokeWidth: cloud.style.strokeWidth };
}

/** Points along every Bézier the writer strokes — the outline as drawn. */
function outline(cloud) {
  const points = [];
  for (const arc of scallopArcs(cloud.getBounds(), cloud.getArcRadius())) {
    let from = arcToBeziers(arc).start;
    for (const { c1, c2, end } of arcToBeziers(arc).curves) {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      from = end;
    }
  }
  return points;
}

/** How far the drawn outline, stroke included, pokes out of the /Rect on each side. */
function overhang({ cloud, rect, strokeWidth }) {
  const [left, bottom, right, top] = rect;
  const half = strokeWidth / 2;
  const worst = { left: 0, bottom: 0, right: 0, top: 0 };
  for (const p of outline(cloud)) {
    worst.left = Math.max(worst.left, left - (p.x - half));
    worst.bottom = Math.max(worst.bottom, bottom - (p.y - half));
    worst.right = Math.max(worst.right, p.x + half - right);
    worst.top = Math.max(worst.top, p.y + half - top);
  }
  return worst;
}

const SHAPES = [
  ['the cloud from the live site (wide, shallow)', [880, 900, 1120, 1045]],
  ['a tall, narrow cloud', [300, 200, 360, 700]],
  ['a long, flat cloud', [200, 300, 1400, 350]],
  ['a square cloud', [500, 500, 700, 700]],
  ['a tiny cloud', [40, 40, 52, 47]],
];

for (const [name, [x0, y0, x1, y1]] of SHAPES) {
  check(`${name}: every scallop is inside the clip box`, async () => {
    const written = await exportCloud(x0, y0, x1, y1);
    const out = overhang(written);
    for (const [side, by] of Object.entries(out)) {
      assert.ok(by <= 1e-6, `the ${side} scallops are clipped by ${by.toFixed(2)} pt (Rect ${written.rect.join(' ')})`);
    }
  });
}

check('a heavy stroke is not clipped either', async () => {
  const written = await exportCloud(300, 200, 360, 700, 8);
  const out = overhang(written);
  assert.ok(Object.values(out).every((by) => by <= 1e-6), JSON.stringify(out));
});

check('the appearance is clipped to exactly the annotation rectangle', async () => {
  const { rect, bbox } = await exportCloud(880, 900, 1120, 1045);
  assert.deepEqual(bbox, rect);
});

check('the clip box stays snug — no more than the stroke and 2 pt of air around the scallops', async () => {
  const written = await exportCloud(880, 900, 1120, 1045);
  const pts = outline(written.cloud);
  const extent = {
    left: Math.min(...pts.map((p) => p.x)),
    bottom: Math.min(...pts.map((p) => p.y)),
    right: Math.max(...pts.map((p) => p.x)),
    top: Math.max(...pts.map((p) => p.y)),
  };
  const [left, bottom, right, top] = written.rect;
  const slack = written.strokeWidth + 2 + 0.5;
  assert.ok(extent.left - left <= slack && extent.bottom - bottom <= slack, 'too much room bottom-left');
  assert.ok(right - extent.right <= slack && top - extent.top <= slack, 'too much room top-right');
});

// --- run --------------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message.split('\n').join('\n        ')}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} cloud export checks passed.`);
process.exit(failed === 0 ? 0 : 1);
