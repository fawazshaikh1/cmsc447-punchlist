# SCRUM-18 / SCRUM-19 — Spike findings

**Status:** both spikes pass. Ready for review.
**Stack:** React 19 + pdf.js (`pdfjs-dist` 6.3.289), plain JavaScript, Vite.

---

## SCRUM-18 — Render an uploaded PDF in the browser with pdf.js

**Result: PASS.** A user-selected PDF renders to a canvas, with sheet selection
for multi-page sets, zoom 25%–800%, and 90° rotation.

### Findings to carry into the sprint

**1. The worker must be configured or nothing renders.** pdf.js parses on a Web
Worker. Without `GlobalWorkerOptions.workerSrc`, `getDocument()` hangs forever
with no error and nothing in the console. Under Vite:

```js
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
```

**2. `page.render()`'s promise does not reliably settle in 6.3.x.** The canvas
paints correctly, but the returned promise can stay pending indefinitely. If you
`await` it before building the annotation overlay, the overlay never appears and
it looks like the coordinate code is broken. Documented in
`PdfJsSheetPage.render()`.

**3. Renders must be cancelled.** Holding the zoom button queues overlapping
renders against one canvas; they finish out of order and the sheet ends up
painted at a stale scale. `SheetCanvas` cancels on effect cleanup.

**4. pdf.js detaches the ArrayBuffer it is given.** A caller that retains the
buffer — to upload it to S3, say — finds it zero-length afterwards. We pass a
copy.

**5. `pdfjs-dist` v6 is ESM-only.** Fine in the browser. The Sprint 3 Node
export worker will need `pdfjs-dist/legacy/build/pdf.mjs`.

---

## SCRUM-19 — Drop a pin and store a coordinate that survives zoom/pan

**Result: PASS.** All four invariants verified by driving the running app.

### The rule

Coordinates are stored in **PDF user space** (origin bottom-left, Y up, 1/72
inch units), never in screen pixels. `PdfPoint` and `ViewportPoint` are separate
classes with runtime guards at every boundary, so mixing them throws
immediately instead of silently misplacing pins.

### Measured evidence

Test sheet 1224 × 792 pt, `devicePixelRatio` 1.5, three pins placed.

| State | Zoom | viewBox | Overlay CSS | Canvas CSS | Marker 1 | Stored PDF pt |
|---|---|---|---|---|---|---|
| Placed | 1.00x | `0 0 1224 792` | 1224×792 | 1224×792 | `translate(200, 149.67)` | 200.00, 642.33 |
| Zoomed | 2.25x | `0 0 1224 792` | 2754×1782 | 2754×1782 | `translate(200, 149.67)` | 200.00, 642.33 |
| Rotated | 2.25x | `0 0 792 1224` | 1782×2754 | 1782×2754 | `translate(642.33, 200)` | 200.00, 642.33 |

**Invariants, all true:**

- `storedPdfNeverChanged` — the PDF coordinate is identical in all three states.
- `markersNotRecalculatedOnZoom` — marker transforms byte-identical across a
  2.25× zoom. The browser scales them; no JS recomputation happens.
- `overlayAlwaysMatchesCanvas` — overlay and canvas CSS boxes agree exactly in
  every state, so there is no drift between what is drawn and what is clicked.
- `allRoundTripsExact` — screen → PDF → screen returns the original within
  0.01 pt for every pin, at every zoom and rotation.

Persistence confirmed: after a full page reload the pins return from
localStorage and land in the same places, positioned from their stored PDF
coordinates alone.

### Runtime guards, verified

The architecture relies on runtime enforcement rather than a compiler. All five
checks confirmed working in the browser:

| Attempt | Result |
|---|---|
| `new Pin(id, sheet, new ViewportPoint(200,150), …)` | `Expected Pin position to be a PdfPoint, received ViewportPoint.` |
| `new AnnotationService({save(){}}, …)` | `Expected repository to be a AnnotationRepository, received Object.` |
| `new AnnotationRepository()` | `AnnotationRepository is an abstract contract and cannot be instantiated directly.` |
| Subclass missing 3 methods | `Broken … does not override: save, delete, clearSheet.` |
| `new InMemoryAnnotationRepository()` | accepted |

### Findings to carry into the sprint

**1. `devicePixelRatio` is the trap.** The canvas bitmap is `cssSize × dpr`
(1836×1188 for a 1224×792 sheet at dpr 1.5). Coordinate conversion expects **CSS
pixels**. Feeding it bitmap pixels is wrong by exactly the ratio — correct on a
non-retina laptop, wrong on every iPad. Always derive the click point from
`getBoundingClientRect()`, never from `canvas.width`.

**2. Rotation must be ADDED to the page's `/Rotate`, not substituted.** pdf.js
treats `getViewport({rotation})` as *absolute* and defaults it to the page's own
value. Passing the user's rotation straight through would make a sheet authored
with `/Rotate 90` render sideways at the default view. Handled in
`PdfJsSheetPage.#totalRotation()`.

**3. The SVG viewBox must come from a transformer, not from `PageGeometry`.**
`PageGeometry` only knows the page's intrinsic rotation, not the user's, so
deriving the viewBox from it leaves the box unswapped after a 90° turn while the
CSS box swaps correctly — silently stretching the overlay and misplacing every
marker.

**4. BUG FOUND AND FIXED — registries threw on hot reload.** Both registries
originally threw on duplicate registration. Vite re-executes a module on every
save, so editing `Pin.js` or `PinMarker.jsx` broke HMR with a confusing error
and forced a manual refresh. Now dev warns and replaces; production still
throws, because in a production bundle each module runs once and a duplicate
genuinely means two classes claiming one kind.

**5. Error messages must be scoped.** The coordinate-space guard originally
appended "Screen and document coordinates are not interchangeable" to *every*
assertion, so a mis-wired repository was told about coordinate spaces. The hint
is now opt-in via `COORDINATE_SPACE_HINT` at coordinate boundaries only.

*Items 2 and 3 are invisible at the default rotation. Neither would have been
caught without explicitly testing rotation — worth putting in the acceptance
criteria for the remaining stories.*

---

## How to run the demo

```bash
cd web && npm install && npm run dev
```

Open a real drawing, then:

1. Drop pins on recognisable features.
2. Zoom in and out — pins stay on those features; the inspector's **PDF point**
   column does not move while the **screen position** column scales.
3. Rotate 90° — still correct.
4. Reload — pins return in the same places.

The **Coordinate inspector** panel is the evidence: stored PDF point, current
screen position, and a round-trip check per pin. It is a diagnostic, not a
product feature — delete it or hide it behind a dev flag once these spikes are
accepted.

---

## Not yet verified

**Neither spike has been run on a real E-size drawing on a physical iPad.** The
`devicePixelRatio` handling is correct and the numbers prove it at dpr 1.5, but
an iPad is dpr 2 or 3 and the sheets are far larger. **Do this before closing
SCRUM-18** — it is the device the sprint goal is about.

---

## Recommended follow-up ticket

Nothing in Sprint 1 proves we can write these coordinates back into a PDF as
native annotations, which is the project's differentiator. Suggested, 2 points:

> **Spike: export a PDF with pins as native annotations, verified in Acrobat,
> Preview and Chrome**

The mechanism is proven separately (`pdf-lib`, appending annotation objects
without touching content streams). This ticket wires it to the PDF coordinates
this spike now produces.
