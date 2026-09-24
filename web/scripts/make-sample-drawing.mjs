/**
 * Generates a realistic, unmarked architectural drawing set for testing.
 *
 * ===========================================================================
 * WHY THIS IS GENERATED RATHER THAN DOWNLOADED
 * ===========================================================================
 * Real construction documents are a firm's copyrighted work product, and the
 * ones that circulate freely are usually already covered in someone else's
 * markups — which is the one thing a test file must not have, because the app
 * reads existing annotations and shows them as "already in this file".
 *
 * Generating it also means the set is reproducible, has a known page count, and
 * has exactly zero annotation objects: every drawing call below writes to the
 * page content stream, never to /Annots. The script asserts that at the end.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES IT A USEFUL TEST FILE
 * ---------------------------------------------------------------------------
 *   - ARCH D (36x24in), the real sheet size. Big enough that zoom and pan
 *     actually matter, and that the coordinate anchoring is worth proving.
 *   - Four sheets, so the sheet picker is exercised.
 *   - Fine linework at several weights, which is what makes a pale interface
 *     compete with the drawing and a dark one recede.
 *   - Dense small text in the title block and schedule, so the render quality
 *     at low zoom is honest.
 *
 * Run: node scripts/make-sample-drawing.mjs
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

// ARCH D landscape, in points (72 per inch).
const W = 36 * 72;
const H = 24 * 72;

const MARGIN = 36;
const TITLE_W = 250;

const BLACK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.72, 0.72, 0.72);
const POCHE = rgb(0.25, 0.25, 0.25);

const CLIENT = 'UMBC FACILITIES MANAGEMENT';
const ISSUED = '2026-09-24';

const doc = await PDFDocument.create();
const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

// --- small helpers ----------------------------------------------------------

const line = (page, x1, y1, x2, y2, thickness = 0.75, color = BLACK) =>
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });

const box = (page, x, y, w, h, thickness = 0.75, color = BLACK) =>
  page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: thickness });

const text = (page, value, x, y, size = 8, font = regular, color = BLACK) =>
  page.drawText(value, { x, y, size, font, color });

const centred = (page, value, cx, y, size = 8, font = regular, color = BLACK) =>
  text(page, value, cx - font.widthOfTextAtSize(value, size) / 2, y, size, font, color);

/** A wall drawn as two lines with a filled cavity — standard plan poché. */
function wall(page, x, y, w, h) {
  page.drawRectangle({ x, y, width: w, height: h, color: POCHE });
}

/** A door opening with its swing arc, approximated by a polyline. */
function door(page, hingeX, hingeY, size, startAngle, sweep) {
  const steps = 12;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const a = ((startAngle + (sweep * i) / steps) * Math.PI) / 180;
    const p = { x: hingeX + size * Math.cos(a), y: hingeY + size * Math.sin(a) };
    if (prev) line(page, prev.x, prev.y, p.x, p.y, 0.5, GREY);
    prev = p;
  }
  // The leaf itself, at the open position.
  const a0 = (startAngle * Math.PI) / 180;
  line(page, hingeX, hingeY, hingeX + size * Math.cos(a0), hingeY + size * Math.sin(a0), 1.2);
}

/** A grid bubble: a circle with a letter or number, on a leader line. */
function gridBubble(page, cx, cy, label, r = 16) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: BLACK, borderWidth: 0.75 });
  centred(page, label, cx, cy - 3.5, 10, bold);
}

/** A dimension string with tick marks and a value. */
function dimension(page, x1, y1, x2, y2, label) {
  line(page, x1, y1, x2, y2, 0.5, GREY);
  const tick = 4;
  line(page, x1 - tick, y1 - tick, x1 + tick, y1 + tick, 0.75, GREY);
  line(page, x2 - tick, y2 - tick, x2 + tick, y2 + tick, 0.75, GREY);

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const horizontal = Math.abs(y2 - y1) < 1;

  if (horizontal) centred(page, label, mx, my + 4, 7.5, regular, GREY);
  else text(page, label, mx + 4, my - 3, 7.5, regular, GREY);
}

/** Room name, number and area, stacked and centred. */
function room(page, cx, cy, name, number, area) {
  centred(page, name, cx, cy + 6, 11, bold);
  centred(page, number, cx, cy - 8, 8, regular, GREY);
  if (area) centred(page, area, cx, cy - 20, 7, regular, GREY);
}

function northArrow(page, cx, cy) {
  page.drawCircle({ x: cx, y: cy, size: 26, borderColor: BLACK, borderWidth: 0.75 });
  // A simple filled triangle pointing up.
  line(page, cx, cy + 20, cx - 9, cy - 14, 1.2);
  line(page, cx, cy + 20, cx + 9, cy - 14, 1.2);
  line(page, cx - 9, cy - 14, cx + 9, cy - 14, 1.2);
  line(page, cx, cy + 20, cx, cy - 14, 0.5, GREY);
  centred(page, 'N', cx, cy + 30, 10, bold);
}

function graphicScale(page, x, y) {
  const seg = 36; // 1/2 inch on the sheet
  for (let i = 0; i < 4; i++) {
    page.drawRectangle({
      x: x + i * seg,
      y,
      width: seg,
      height: 7,
      color: i % 2 === 0 ? BLACK : rgb(1, 1, 1),
      borderColor: BLACK,
      borderWidth: 0.5,
    });
  }
  text(page, '0', x - 2, y - 11, 7, regular, GREY);
  text(page, `8'`, x + 2 * seg - 4, y - 11, 7, regular, GREY);
  text(page, `16'`, x + 4 * seg - 6, y - 11, 7, regular, GREY);
  text(page, `SCALE: 1/8" = 1'-0"`, x, y + 12, 7.5, regular, GREY);
}

/** Sheet border, title block and revision table. Every sheet gets one. */
function titleBlock(page, sheetNumber, sheetName) {
  box(page, MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2, 1.5);
  box(page, MARGIN + 6, MARGIN + 6, W - MARGIN * 2 - 12, H - MARGIN * 2 - 12, 0.5, GREY);

  const tx = W - MARGIN - TITLE_W;
  line(page, tx, MARGIN + 6, tx, H - MARGIN - 6, 1);

  let y = H - MARGIN - 46;

  text(page, 'UMBC', tx + 16, y, 22, bold);
  y -= 16;
  text(page, 'FACILITIES MANAGEMENT', tx + 16, y, 7.5, regular, GREY);

  y -= 26;
  line(page, tx, y, W - MARGIN, y, 0.5, GREY);

  y -= 22;
  text(page, 'PROJECT', tx + 16, y, 6.5, regular, GREY);
  y -= 14;
  text(page, 'RETREAT CENTER', tx + 16, y, 11, bold);
  y -= 13;
  text(page, 'BUILDING B', tx + 16, y, 11, bold);
  y -= 14;
  text(page, '1000 HILLTOP CIRCLE', tx + 16, y, 7.5, regular, GREY);
  y -= 11;
  text(page, 'BALTIMORE, MD 21250', tx + 16, y, 7.5, regular, GREY);

  y -= 24;
  line(page, tx, y, W - MARGIN, y, 0.5, GREY);

  y -= 20;
  text(page, 'CLIENT', tx + 16, y, 6.5, regular, GREY);
  y -= 13;
  text(page, CLIENT, tx + 16, y, 8);

  y -= 24;
  line(page, tx, y, W - MARGIN, y, 0.5, GREY);

  // Revision table — empty, because this is the unmarked issue.
  y -= 18;
  text(page, 'REVISIONS', tx + 16, y, 6.5, regular, GREY);
  y -= 12;
  const colX = [tx + 16, tx + 46, tx + 100];
  text(page, 'NO.', colX[0], y, 6, regular, GREY);
  text(page, 'DATE', colX[1], y, 6, regular, GREY);
  text(page, 'DESCRIPTION', colX[2], y, 6, regular, GREY);
  y -= 4;
  for (let i = 0; i < 5; i++) {
    line(page, tx + 12, y, W - MARGIN - 12, y, 0.4, LIGHT);
    y -= 15;
  }
  line(page, tx + 12, y + 11, W - MARGIN - 12, y + 11, 0.4, LIGHT);

  y -= 10;
  line(page, tx, y, W - MARGIN, y, 0.5, GREY);

  y -= 20;
  text(page, 'ISSUED FOR CONSTRUCTION', tx + 16, y, 7.5, bold);
  y -= 13;
  text(page, ISSUED, tx + 16, y, 7.5, regular, GREY);
  y -= 13;
  text(page, 'PROJECT NO. 2026-0418', tx + 16, y, 7.5, regular, GREY);
  y -= 13;
  text(page, 'DRAWN BY: JMP   CHECKED BY: RS', tx + 16, y, 7.5, regular, GREY);

  // Sheet name and number, bottom right — the largest text on the sheet.
  const blockY = MARGIN + 20;
  line(page, tx, blockY + 86, W - MARGIN, blockY + 86, 0.75, GREY);
  text(page, 'SHEET TITLE', tx + 16, blockY + 70, 6.5, regular, GREY);
  text(page, sheetName, tx + 16, blockY + 54, 12, bold);
  line(page, tx, blockY + 42, W - MARGIN, blockY + 42, 0.75, GREY);
  text(page, 'SHEET NUMBER', tx + 16, blockY + 28, 6.5, regular, GREY);
  text(page, sheetNumber, tx + 16, blockY, 26, bold);
}

/** The drawing area available on any sheet, left of the title block. */
const AREA = {
  x: MARGIN + 30,
  y: MARGIN + 30,
  w: W - MARGIN * 2 - TITLE_W - 60,
  h: H - MARGIN * 2 - 60,
};

// ===========================================================================
// SHEET 1 & 2 — floor plans
// ===========================================================================

function floorPlan(page, level) {
  // Building footprint, centred in the drawing area.
  const bw = 1500;
  const bh = 940;
  const bx = AREA.x + (AREA.w - bw) / 2;
  const by = AREA.y + (AREA.h - bh) / 2 - 10;

  const T = 14; // exterior wall thickness
  const P = 9; // partition thickness

  // --- structural grid ------------------------------------------------------
  const colsX = [bx, bx + 300, bx + 620, bx + 940, bx + 1220, bx + bw];
  const rowsY = [by, by + 300, by + 620, by + bh];

  colsX.forEach((x, i) => {
    line(page, x, by - 70, x, by + bh + 70, 0.4, LIGHT);
    gridBubble(page, x, by + bh + 92, String(i + 1));
    gridBubble(page, x, by - 92, String(i + 1));
  });

  rowsY.forEach((y, i) => {
    line(page, bx - 70, y, bx + bw + 70, y, 0.4, LIGHT);
    gridBubble(page, bx - 92, y, 'ABCD'[i]);
    gridBubble(page, bx + bw + 92, y, 'ABCD'[i]);
  });

  // --- exterior envelope ----------------------------------------------------
  wall(page, bx, by, bw, T); // south
  wall(page, bx, by + bh - T, bw, T); // north
  wall(page, bx, by, T, bh); // west
  wall(page, bx + bw - T, by, T, bh); // east

  // --- corridor spine -------------------------------------------------------
  const corrTop = by + 560;
  const corrBot = by + 420;
  wall(page, bx + T, corrTop, bw - T * 2, P);
  wall(page, bx + T, corrBot - P, bw - T * 2, P);

  // Corridor openings (gaps drawn as white over the partition).
  const opening = (x, y, w, h) => page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });
  opening(bx + 180, corrTop, 90, P);
  opening(bx + 700, corrTop, 90, P);
  opening(bx + 1080, corrTop, 90, P);
  opening(bx + 360, corrBot - P, 90, P);
  opening(bx + 880, corrBot - P, 90, P);

  // --- north side rooms -----------------------------------------------------
  wall(page, bx + 430, corrTop + P, P, by + bh - T - (corrTop + P));
  wall(page, bx + 900, corrTop + P, P, by + bh - T - (corrTop + P));
  wall(page, bx + 1200, corrTop + P, P, by + bh - T - (corrTop + P));

  // --- south side rooms -----------------------------------------------------
  wall(page, bx + 300, by + T, P, corrBot - P - (by + T));
  wall(page, bx + 620, by + T, P, corrBot - P - (by + T));
  wall(page, bx + 1080, by + T, P, corrBot - P - (by + T));

  // --- doors ----------------------------------------------------------------
  door(page, bx + 225, corrTop, 62, 0, 90);
  door(page, bx + 745, corrTop, 62, 0, 90);
  door(page, bx + 1125, corrTop, 62, 0, 90);
  door(page, bx + 405, corrBot - P, 62, 0, -90);
  door(page, bx + 925, corrBot - P, 62, 0, -90);

  // --- glazing on the south elevation --------------------------------------
  for (let i = 0; i < 9; i++) {
    const wx = bx + 60 + i * 155;
    page.drawRectangle({ x: wx, y: by + 3, width: 96, height: T - 6, color: rgb(1, 1, 1) });
    line(page, wx, by + T / 2, wx + 96, by + T / 2, 0.75, GREY);
  }

  // --- room labels ----------------------------------------------------------
  const lvl = level === 1 ? '1' : '2';

  room(page, bx + 215, corrTop + 190, 'CONFERENCE', `${lvl}01`, `412 SF`);
  room(page, bx + 665, corrTop + 190, 'OPEN OFFICE', `${lvl}02`, `1,180 SF`);
  room(page, bx + 1050, corrTop + 190, 'BREAK ROOM', `${lvl}03`, `366 SF`);
  room(page, bx + 1360, corrTop + 190, 'STAIR B', `${lvl}04`, '');

  room(page, bx + 150, corrBot - 210, 'RECEPTION', `${lvl}10`, `284 SF`);
  room(page, bx + 460, corrBot - 210, 'OFFICE', `${lvl}11`, `196 SF`);
  room(page, bx + 850, corrBot - 210, 'OPEN WORKSTATIONS', `${lvl}12`, `940 SF`);
  room(page, bx + 1290, corrBot - 210, 'STORAGE', `${lvl}13`, `210 SF`);

  centred(page, 'CORRIDOR', bx + bw / 2, (corrTop + corrBot) / 2 - 4, 10, bold);
  centred(page, `${lvl}00`, bx + bw / 2, (corrTop + corrBot) / 2 - 18, 8, regular, GREY);

  // --- dimensions -----------------------------------------------------------
  dimension(page, bx, by - 40, bx + 300, by - 40, `25'-0"`);
  dimension(page, bx + 300, by - 40, bx + 620, by - 40, `26'-8"`);
  dimension(page, bx + 620, by - 40, bx + 940, by - 40, `26'-8"`);
  dimension(page, bx + 940, by - 40, bx + 1220, by - 40, `23'-4"`);
  dimension(page, bx + 1220, by - 40, bx + bw, by - 40, `23'-4"`);
  dimension(page, bx - 40, by, bx - 40, by + 300, `25'-0"`);
  dimension(page, bx - 40, by + 300, bx - 40, by + 620, `26'-8"`);
  dimension(page, bx - 40, by + 620, bx - 40, by + bh, `26'-8"`);

  // --- sheet furniture ------------------------------------------------------
  const titleY = AREA.y - 4;
  text(page, `LEVEL ${level} FLOOR PLAN`, AREA.x, titleY + 16, 16, bold);
  line(page, AREA.x, titleY + 10, AREA.x + 260, titleY + 10, 1.5);
  text(page, `1`, AREA.x + 268, titleY + 16, 11, bold);
  text(page, `SCALE 1/8" = 1'-0"`, AREA.x + 282, titleY + 16, 8, regular, GREY);

  northArrow(page, AREA.x + AREA.w - 60, AREA.y + AREA.h - 60);
  graphicScale(page, AREA.x + 460, titleY + 14);
}

// ===========================================================================
// SHEET 3 — elevations
// ===========================================================================

function elevations(page) {
  const draw = (ox, oy, w, h, label, floors) => {
    // Ground line, heavier than the building outline.
    line(page, ox - 40, oy, ox + w + 40, oy, 2);
    box(page, ox, oy, w, h, 1.2);

    for (let f = 1; f < floors; f++) {
      const fy = oy + (h / floors) * f;
      line(page, ox, fy, ox + w, fy, 0.5, GREY);
      text(page, `LEVEL ${f + 1}`, ox + w + 8, fy - 3, 7, regular, GREY);
      line(page, ox + w, fy, ox + w + 6, fy, 0.5, GREY);
    }
    text(page, 'LEVEL 1', ox + w + 8, oy - 3, 7, regular, GREY);
    text(page, 'T.O. PARAPET', ox + w + 8, oy + h - 3, 7, regular, GREY);

    // Window bays.
    const bays = 9;
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < bays; i++) {
        const bw2 = w / bays;
        const wx = ox + i * bw2 + bw2 * 0.18;
        const wy = oy + (h / floors) * f + (h / floors) * 0.28;
        page.drawRectangle({
          x: wx,
          y: wy,
          width: bw2 * 0.64,
          height: (h / floors) * 0.44,
          borderColor: BLACK,
          borderWidth: 0.6,
        });
        line(page, wx, wy + (h / floors) * 0.22, wx + bw2 * 0.64, wy + (h / floors) * 0.22, 0.4, LIGHT);
      }
    }

    centred(page, label, ox + w / 2, oy - 34, 12, bold);
    line(page, ox + w / 2 - 110, oy - 40, ox + w / 2 + 110, oy - 40, 1.2);
  };

  const w = 980;
  draw(AREA.x + 60, AREA.y + AREA.h - 380, w, 300, 'SOUTH ELEVATION', 2);
  draw(AREA.x + 60, AREA.y + 120, w, 300, 'NORTH ELEVATION', 2);

  const titleY = AREA.y - 4;
  text(page, 'EXTERIOR ELEVATIONS', AREA.x, titleY + 16, 16, bold);
  line(page, AREA.x, titleY + 10, AREA.x + 300, titleY + 10, 1.5);
  graphicScale(page, AREA.x + 460, titleY + 14);
}

// ===========================================================================
// SHEET 4 — a schedule, for testing markup over dense tabular text
// ===========================================================================

function schedule(page) {
  const cols = [
    { label: 'DOOR', w: 70 },
    { label: 'ROOM SERVED', w: 230 },
    { label: 'WIDTH', w: 80 },
    { label: 'HEIGHT', w: 80 },
    { label: 'TYPE', w: 90 },
    { label: 'MATERIAL', w: 150 },
    { label: 'FIRE RATING', w: 110 },
    { label: 'HARDWARE SET', w: 130 },
    { label: 'REMARKS', w: 260 },
  ];

  const rows = [
    ['101A', 'CONFERENCE 101', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '20 MIN', 'HW-3', 'CARD READER'],
    ['101B', 'CONFERENCE 101', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '—', 'HW-1', ''],
    ['102A', 'OPEN OFFICE 102', `6'-0"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-7', 'PAIR, NARROW STILE'],
    ['103A', 'BREAK ROOM 103', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '—', 'HW-1', ''],
    ['104A', 'STAIR B 104', `3'-0"`, `7'-0"`, 'F', 'HOLLOW METAL', '90 MIN', 'HW-9', 'SELF-CLOSING, LABELED'],
    ['110A', 'RECEPTION 110', `3'-6"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-5', ''],
    ['111A', 'OFFICE 111', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '—', 'HW-1', ''],
    ['112A', 'OPEN WORKSTATIONS 112', `6'-0"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-7', 'PAIR'],
    ['113A', 'STORAGE 113', `3'-0"`, `7'-0"`, 'F', 'HOLLOW METAL', '45 MIN', 'HW-4', ''],
    ['201A', 'CONFERENCE 201', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '20 MIN', 'HW-3', 'CARD READER'],
    ['202A', 'OPEN OFFICE 202', `6'-0"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-7', 'PAIR, NARROW STILE'],
    ['203A', 'BREAK ROOM 203', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '—', 'HW-1', ''],
    ['204A', 'STAIR B 204', `3'-0"`, `7'-0"`, 'F', 'HOLLOW METAL', '90 MIN', 'HW-9', 'SELF-CLOSING, LABELED'],
    ['210A', 'RECEPTION 210', `3'-6"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-5', ''],
    ['211A', 'OFFICE 211', `3'-0"`, `7'-0"`, 'F', 'SOLID CORE WD', '—', 'HW-1', ''],
    ['212A', 'OPEN WORKSTATIONS 212', `6'-0"`, `7'-0"`, 'D', 'ALUM / GLASS', '—', 'HW-7', 'PAIR'],
    ['213A', 'STORAGE 213', `3'-0"`, `7'-0"`, 'F', 'HOLLOW METAL', '45 MIN', 'HW-4', ''],
  ];

  const tableW = cols.reduce((sum, c) => sum + c.w, 0);
  const rowH = 26;
  const x0 = AREA.x + (AREA.w - tableW) / 2;
  let y = AREA.y + AREA.h - 120;

  text(page, 'DOOR SCHEDULE', x0, y + 40, 16, bold);
  line(page, x0, y + 34, x0 + 220, y + 34, 1.5);

  // Header.
  page.drawRectangle({ x: x0, y, width: tableW, height: rowH, color: rgb(0.9, 0.9, 0.88) });
  let cx = x0;
  for (const col of cols) {
    box(page, cx, y, col.w, rowH, 0.75);
    text(page, col.label, cx + 6, y + 9, 7.5, bold);
    cx += col.w;
  }

  // Body.
  for (const row of rows) {
    y -= rowH;
    cx = x0;
    row.forEach((value, i) => {
      box(page, cx, y, cols[i].w, rowH, 0.5, GREY);
      text(page, value, cx + 6, y + 9, 7.5);
      cx += cols[i].w;
    });
  }

  y -= 40;
  text(page, 'GENERAL NOTES', x0, y, 9, bold);
  y -= 14;
  for (const note of [
    '1.  ALL DIMENSIONS ARE TO FACE OF STUD UNLESS NOTED OTHERWISE.',
    '2.  CONTRACTOR TO VERIFY ALL ROUGH OPENINGS IN FIELD PRIOR TO FABRICATION.',
    '3.  FIRE-RATED ASSEMBLIES SHALL BE INSTALLED PER UL LISTING AND LABELED.',
    '4.  HARDWARE SETS ARE SCHEDULED IN SPECIFICATION SECTION 08 71 00.',
    '5.  REFER TO SHEET A-101 AND A-102 FOR DOOR LOCATIONS.',
  ]) {
    text(page, note, x0, y, 7.5, regular, GREY);
    y -= 12;
  }
}

// ===========================================================================
// Build
// ===========================================================================

const sheets = [
  ['A-101', 'LEVEL 1 FLOOR PLAN', (p) => floorPlan(p, 1)],
  ['A-102', 'LEVEL 2 FLOOR PLAN', (p) => floorPlan(p, 2)],
  ['A-201', 'EXTERIOR ELEVATIONS', elevations],
  ['A-601', 'DOOR SCHEDULE', schedule],
];

for (const [number, name, draw] of sheets) {
  const page = doc.addPage([W, H]);
  titleBlock(page, number, name);
  draw(page);
}

const bytes = await doc.save();

// The whole point of this file: it must arrive with nothing on it. If a future
// edit here ever adds an annotation, the test file stops being a clean slate
// and the app will report it as "already marked up".
//
// Counting ENTRIES, not the presence of the array: pdf-lib gives every page it
// creates an empty /Annots, so `if (page.node.Annots())` is true on a perfectly
// clean page. The first version of this check asserted exactly that and failed
// on its own output.
const annotationCount = doc
  .getPages()
  .reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);

if (annotationCount > 0) {
  throw new Error(`${annotationCount} annotation(s) present — the sample must be unmarked.`);
}

const out = process.argv[2] ?? 'sample-drawing-set.pdf';
writeFileSync(out, bytes);

console.log(`Wrote ${out}`);
console.log(`  ${doc.getPageCount()} sheets · ${(W / 72).toFixed(0)}x${(H / 72).toFixed(0)} in (ARCH D)`);
console.log(`  ${(bytes.length / 1024).toFixed(0)} KB · ${annotationCount} annotations`);
