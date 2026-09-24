import { StandardFonts, rgb } from 'pdf-lib';

/**
 * Appends a punch list schedule to an exported drawing set.
 *
 * ===========================================================================
 * THE PROBLEM THIS SOLVES — a number with nothing behind it
 * ===========================================================================
 * A pin carries its description in the annotation's `/Contents`, which Acrobat
 * shows on hover and lists in the Comments panel. That works for the native
 * export. It does not survive flattening, because flattening removes the
 * annotation — by design, since that is what makes the markup permanent.
 *
 * The result was an issued PDF showing a red circle with a "2" in it and
 * absolutely nothing to say what item 2 was. The person who drew it knows. The
 * subcontractor holding the printout does not, and they are the one who has to
 * fix it.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCHEDULE AND NOT A LABEL BESIDE EACH PIN
 * ---------------------------------------------------------------------------
 * Printing the description next to the pin was the obvious first idea, and it
 * is wrong twice over:
 *
 *   1. It puts text on the architect's drawing. Descriptions are sentences,
 *      not words — "cracked tile at north corridor entrance, re-grout" beside
 *      every pin buries the linework the markup is pointing AT, and the marks
 *      collide with each other the moment two items are near one another.
 *
 *   2. The app's canvas draws a pin as a bare numbered circle. Adding text in
 *      the export only would mean the issued PDF no longer matches what the
 *      user saw while marking up — the exact complaint that produced this
 *      exporter in the first place.
 *
 * A numbered mark keyed to a schedule is also simply how construction drawings
 * have always worked: keynotes, door tags, revision clouds. The number on the
 * plan is an index, and the list carries the words. Fieldwire and Bluebeam both
 * export this way, and a punch list printed from either is read the same way.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DRAWS WITH pdf-lib's HIGH-LEVEL API
 * ---------------------------------------------------------------------------
 * Every other writer here composes raw content-stream operators, because they
 * are touching the architect's page and the one rule is that it comes out
 * byte-identical. That rule does not apply to a page we created ourselves, so
 * this is free to use `drawText` and `drawRectangle` — which for a table of
 * text is a great deal less code to get wrong.
 */
export class PunchListPageWriter {
  /**
   * @param {object} [options]
   * @param {string} [options.title] Heading on the first schedule page.
   */
  constructor({ title = 'PUNCH LIST' } = {}) {
    this.title = title;
  }

  /**
   * Appends as many schedule pages as the entries need.
   *
   * @param {import('pdf-lib').PDFDocument} pdfDoc Written to in place.
   * @param {import('../../domain/punchlist').PunchListEntry[]} entries
   * @param {object} [meta]
   * @param {string} [meta.documentName]
   * @param {string} [meta.issuedBy]
   * @param {Date} [meta.issuedAt]
   * @returns {Promise<number>} How many pages were added. Zero when there is
   *          nothing to schedule — an appended page reading "no items" is worse
   *          than no page, because it is one more sheet to print and file.
   */
  async append(pdfDoc, entries, { documentName, issuedBy, issuedAt = new Date() } = {}) {
    if (!entries || entries.length === 0) return 0;

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Matched to the drawing so the schedule prints on the same paper. A Letter
    // page stapled to an ARCH D set is the kind of detail that gets a document
    // handed back.
    const [width, height] = this.#sheetSize(pdfDoc);

    // The layout is designed at Letter width and scaled up from there, so 9pt
    // type is not left marooned on a 36-inch sheet.
    const s = width / 612;
    const layout = this.#layout(s, width, height);

    const rows = entries.map((entry) => ({
      entry,
      lines: wrap(entry.descriptionForPrint, layout.columns.description.width, layout.size.body, regular),
    }));

    const pages = paginate(rows, layout);

    pages.forEach((pageRows, pageNumber) => {
      const page = pdfDoc.addPage([width, height]);
      const isFirst = pageNumber === 0;

      let y = this.#drawHeader(page, layout, {
        isFirst,
        documentName,
        issuedBy,
        issuedAt,
        total: entries.length,
        openCount: entries.filter((entry) => entry.statusKey === 'open').length,
        fonts: { regular, bold },
      });

      y = this.#drawColumnHeadings(page, layout, y, bold);

      for (const row of pageRows) {
        y = this.#drawRow(page, layout, y, row, { regular, bold });
      }

      this.#drawFooter(page, layout, regular, pageNumber + 1, pages.length);
    });

    return pages.length;
  }

  // --- internals ------------------------------------------------------------

  /**
   * The size of the drawing's first page, or Letter when there is none.
   *
   * Every page of a set is normally the same size; taking the first is both
   * right in practice and the only choice that does not require picking a
   * winner among pages that disagree.
   */
  #sheetSize(pdfDoc) {
    if (pdfDoc.getPageCount() === 0) return [612, 792];
    const first = pdfDoc.getPage(0);
    return [first.getWidth(), first.getHeight()];
  }

  /** Every dimension the layout uses, already scaled to the sheet. */
  #layout(s, width, height) {
    const margin = 54 * s;
    const contentWidth = width - margin * 2;

    // ======================================================================
    // WHY TYPE SCALES MORE SLOWLY THAN THE PAGE
    // ======================================================================
    // Scaling type by `s` along with everything else seemed obviously right and
    // is obviously wrong once looked at: an ARCH D sheet is 4.2x Letter, which
    // turned 10pt body text into 42pt — half an inch tall. It also cost pages,
    // because six items no longer fitted on one.
    //
    // Space and type do not scale together, because they answer different
    // questions. A margin is a fraction of the paper, so it scales with it. Type
    // is sized for a reader at arm's length, and a reader does not move further
    // away because the paper got bigger.
    //
    // The square root grows type enough that a big sheet does not look sparse,
    // while keeping it readable rather than enormous: ARCH D lands at ~21pt.
    // Capped, because past a point larger paper says nothing about the reader.
    const t = Math.min(Math.max(Math.sqrt(s), 1), 2.5);

    const size = {
      title: 22 * t,
      meta: 9 * t,
      heading: 8 * t,
      body: 10 * t,
      footer: 8 * t,
    };

    // Proportions rather than fixed widths, so the table fills any sheet.
    const widths = {
      number: contentWidth * 0.07,
      sheet: contentWidth * 0.11,
      description: contentWidth * 0.55,
      status: contentWidth * 0.16,
      raised: contentWidth * 0.11,
    };

    let x = margin;
    const columns = {};
    for (const [key, w] of Object.entries(widths)) {
      columns[key] = { x, width: w - 8 * s };
      x += w;
    }

    return {
      s,
      t,
      width,
      height,
      margin,
      contentWidth,
      size,
      columns,
      lineHeight: size.body * 1.35,
      rowPadding: 7 * s,
      minRowHeight: size.body * 2.4,
      // Where rows may run to before spilling onto another page. The footer
      // sits inside the margin below this, so only a little clearance is owed.
      bottom: margin + 10 * s,
      // These MUST match what #drawHeader and #drawColumnHeadings actually
      // consume, because pagination has to predict the header before it is
      // drawn. Written as the same sum rather than as a guessed round number,
      // so a change to one is a visible mismatch with the other:
      //
      //   first      title   22t + 12s
      //              meta     9t + 16s
      //              rule          16s
      //              headings 8t + 19s   (7s above the rule, 12s below)
      //   continued  label    9t + 18s
      //              headings 8t + 19s
      headerHeight: {
        first: 39 * t + 63 * s,
        continued: 17 * t + 37 * s,
      },
    };
  }

  #drawHeader(page, layout, { isFirst, documentName, issuedBy, issuedAt, total, openCount, fonts }) {
    const { margin, height, size, s, contentWidth } = layout;
    let y = height - margin;

    if (!isFirst) {
      write(page, `${this.title} (continued)`, {
        x: margin,
        y: y - size.meta,
        size: size.meta,
        font: fonts.bold,
        color: INK,
      });
      return y - size.meta - 18 * s;
    }

    write(page, this.title, {
      x: margin,
      y: y - size.title,
      size: size.title,
      font: fonts.bold,
      color: INK,
    });
    y -= size.title + 12 * s;

    // One line of provenance. A schedule that does not say which drawing set it
    // belongs to gets separated from it and becomes unusable.
    const facts = [
      documentName,
      issuedBy ? `Issued by ${issuedBy}` : null,
      issuedAt instanceof Date ? `Issued ${issuedAt.toISOString().slice(0, 10)}` : null,
      `${total} item${total === 1 ? '' : 's'}`,
      openCount > 0 ? `${openCount} open` : null,
    ].filter(Boolean);

    write(page, facts.join('   ·   '), {
      x: margin,
      y: y - size.meta,
      size: size.meta,
      font: fonts.regular,
      color: MUTED,
    });
    y -= size.meta + 16 * s;

    page.drawRectangle({
      x: margin,
      y,
      width: contentWidth,
      height: 1.5 * s,
      color: INK,
    });

    return y - 16 * s;
  }

  #drawColumnHeadings(page, layout, y, bold) {
    const { columns, size, s, margin, contentWidth } = layout;
    const headings = {
      number: 'NO.',
      sheet: 'SHEET',
      description: 'DESCRIPTION',
      status: 'STATUS',
      raised: 'RAISED',
    };

    for (const [key, label] of Object.entries(headings)) {
      write(page, label, {
        x: columns[key].x,
        y: y - size.heading,
        size: size.heading,
        font: bold,
        color: MUTED,
      });
    }

    const baseline = y - size.heading - 7 * s;
    page.drawRectangle({
      x: margin,
      y: baseline,
      width: contentWidth,
      height: 0.75 * s,
      color: RULE,
    });

    return baseline - 12 * s;
  }

  #drawRow(page, layout, y, { entry, lines }, fonts) {
    const { columns, size, s, margin, contentWidth } = layout;
    const height = rowHeight(lines, layout);
    const top = y;
    const textTop = top - size.body;

    // A status stripe down the left edge. Colour is the fastest thing to read
    // on a page of small type, and it matches the pin on the drawing.
    page.drawRectangle({
      x: margin - 10 * s,
      y: top - height + layout.rowPadding,
      width: 3 * s,
      height: height - layout.rowPadding,
      color: statusColor(entry.statusKey),
    });

    write(page, String(entry.number), {
      x: columns.number.x,
      y: textTop,
      size: size.body,
      font: fonts.bold,
      color: INK,
    });

    write(page, entry.sheetLabel, {
      x: columns.sheet.x,
      y: textTop,
      size: size.body,
      font: fonts.regular,
      color: INK,
    });

    lines.forEach((line, index) => {
      write(page, line, {
        x: columns.description.x,
        y: textTop - index * layout.lineHeight,
        size: size.body,
        font: fonts.regular,
        // An item nobody wrote up is greyed, so it reads as a gap rather than
        // as a description that happens to say "(no description)".
        color: entry.description ? INK : MUTED,
      });
    });

    write(page, entry.status, {
      x: columns.status.x,
      y: textTop,
      size: size.body,
      font: fonts.regular,
      color: statusColor(entry.statusKey),
    });

    write(page, entry.raisedOn, {
      x: columns.raised.x,
      y: textTop,
      size: size.body,
      font: fonts.regular,
      color: MUTED,
    });

    page.drawRectangle({
      x: margin,
      y: top - height,
      width: contentWidth,
      height: 0.5 * s,
      color: RULE,
    });

    return top - height;
  }

  #drawFooter(page, layout, regular, pageNumber, pageCount) {
    const { margin, size, s } = layout;
    write(page, `Schedule page ${pageNumber} of ${pageCount}`, {
      x: margin,
      y: margin - 14 * s,
      size: size.footer,
      font: regular,
      color: MUTED,
    });
  }
}

// --- drawing constants -------------------------------------------------------

const INK = rgb(0.1, 0.13, 0.18);
const MUTED = rgb(0.45, 0.48, 0.52);
const RULE = rgb(0.82, 0.84, 0.86);

/**
 * Row colours, keyed by the entry's stable status token.
 *
 * The same three colours the pin uses on the drawing and the marker uses on
 * screen, so an item is one colour everywhere it appears. An unknown token — a
 * markup type registered after this table was written — gets the neutral ink
 * rather than throwing, because a schedule that refuses to print is worse than
 * one row in the wrong colour.
 */
const STATUS_COLORS = {
  open: rgb(0.91, 0.2, 0.16),
  ready_for_review: rgb(0.89, 0.59, 0.04),
  closed: rgb(0.12, 0.62, 0.3),
};

function statusColor(key) {
  return STATUS_COLORS[key] ?? INK;
}

// --- drawing helpers ---------------------------------------------------------

/**
 * `page.drawText`, with the one guard that must never be forgotten.
 *
 * Standard-font `drawText` THROWS on any character outside WinAnsi. Almost
 * everything drawn here is user input or derived from it — a description, a
 * file name, a person's name — so a single smart quote pasted from a spec would
 * fail the entire export rather than one glyph.
 *
 * Every draw in this file goes through here for exactly that reason: a direct
 * `page.drawText` is a latent crash waiting for the right character.
 */
function write(page, value, options) {
  page.drawText(sanitize(value), options);
}

// --- layout helpers ----------------------------------------------------------

/** How tall a row has to be to fit its wrapped description. */
function rowHeight(lines, layout) {
  return Math.max(
    layout.minRowHeight,
    lines.length * layout.lineHeight + layout.rowPadding * 2,
  );
}

/**
 * Splits rows across pages, keeping each row whole.
 *
 * A description broken across a page boundary is the one thing a schedule must
 * not do — half a sentence on the last line of a page reads as a complete
 * instruction to whoever is holding it.
 */
function paginate(rows, layout) {
  const pages = [];
  let current = [];
  let y = layout.height - layout.margin - layout.headerHeight.first;

  for (const row of rows) {
    const height = rowHeight(row.lines, layout);

    if (current.length > 0 && y - height < layout.bottom) {
      pages.push(current);
      current = [];
      y = layout.height - layout.margin - layout.headerHeight.continued;
    }

    current.push(row);
    y -= height;
  }

  if (current.length > 0) pages.push(current);
  return pages;
}

/**
 * Greedy word wrap against the real measured width of the embedded font.
 *
 * Measured rather than estimated, because a character-count guess is wrong by
 * a factor of two between "IIIIII" and "mmmmmm", and the failure mode is text
 * running off the page into the margin.
 *
 * A single word longer than the column — a file path, a part number — is broken
 * mid-word rather than allowed to overflow, since there is no legal wrap point
 * in it and overflowing would silently lose the tail.
 */
function wrap(value, maxWidth, size, font) {
  // Sanitized ONCE, here, so every downstream measurement and every drawn line
  // is the same string. An earlier version sanitized inside the measurement and
  // drew the raw text, which measured one string and printed another — the kind
  // of mismatch that only shows up on the one description containing an em dash.
  const words = sanitize(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines = [];
  let line = '';

  const widthOf = (text) => font.widthOfTextAtSize(text, size);

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (widthOf(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
      line = '';
    }

    if (widthOf(word) <= maxWidth) {
      line = word;
      continue;
    }

    // Too long to fit alone: break it at the last character that does.
    let remainder = word;
    while (widthOf(remainder) > maxWidth && remainder.length > 1) {
      let cut = remainder.length - 1;
      while (cut > 1 && widthOf(remainder.slice(0, cut)) > maxWidth) cut -= 1;
      lines.push(remainder.slice(0, cut));
      remainder = remainder.slice(cut);
    }
    line = remainder;
  }

  if (line) lines.push(line);
  return lines;
}

/**
 * Replaces characters the standard fonts cannot encode.
 *
 * `drawText` THROWS on a character outside WinAnsi, so an em dash pasted from a
 * spec — or a name with an accent — would fail the whole export rather than the
 * one glyph. A description is user input, so this is not a theoretical case.
 */
function sanitize(value) {
  return String(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}
