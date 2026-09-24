# Progress log

Running record of what is built, what is verified, and what is not. Update this
at the end of each work session — it is the thing that makes a sprint review
easy to write.

**Last updated:** 2026-09-18
**Stack:** React 19 + pdf.js + pdf-lib, plain JavaScript, Vite · Go · PostgreSQL · AWS (S3, RDS)
**Codebase:** 115 source files, ~11,323 lines

---

## Status by capability

| Capability | Status | Verified how |
|---|---|---|
| Render an uploaded PDF (SCRUM-18) | **Done** | 153-page set opened by hand |
| Markups survive zoom / pan (SCRUM-19) | **Done** | Automated invariant run + manual 153-page test |
| Survive page reload | **Done** | localStorage round-trip after F5 |
| Survive rotation | **Done** | viewBox swap + geometry check at 0/90/180/270 |
| Six markup types (pin, box, cloud, arrow, ink, text) | **Done** | All drawn, round-trip verified |
| Colour + stroke weight | **Done** | 4 swatches, 4 weights |
| Live drag preview | **Done** | Draft renders through the same marker component |
| **Undo / redo** | **Done** | Add, move, edit, delete, clear — all reversible |
| **Select + drag to reposition** | **Done** | `(200,642) → (350,532)`, undo restores exactly |
| **Issued markups become read-only** | **Done** | `npm run verify:sealing` (10/10) + browser: 6 pins locked, survived reload |
| **Confirmation before closing an item** | **Done** | Dialog shown; status stays Open until confirmed |
| **Confirmation before issuing a flattened PDF** | **Done** | "6 markups on 1 sheet will become permanent" |
| **Permission seam for roles** | **Ready, not wired** | `RoleEditPolicy` written; verify script proves a new policy needs no edits |
| **A pin must have a description** | **Done** | Prompted at placement; `npm run verify` (16/16) incl. whitespace and repair paths |
| **Unfinished items surfaced** | **Done** | Marked on sheet + panel; export confirmation names the count |
| **Who changed what, and when** | **Done** | Change log per annotation; shown in the panel |
| **Sign-in seam for Sprint 2** | **Ready, not wired** | `SessionIdentityProvider` written; verify script signs a user in by swapping one argument |
| **Edit pin description + status** | **Done** | Persisted and undoable |
| **Delete a markup** | **Done** | Undoable; panel closes; selection cleared |
| Keyboard: Ctrl/Cmd+Z, Shift+Z, Delete, Esc | **Done** | Bound in SheetViewer, ignored while typing |
| **Export to native PDF annotations** | **Done** | Structural inspection of the exported file |
| Original drawing left unmodified | **Done** | Content-stream SHA identical before/after |
| Pre-existing PDF annotations preserved | **Done** | Source had 2, export had 8, 6 added |
| Unicode in descriptions | **Done** | é, —, Ø, curly quotes survive the round trip |
| **Show comments already in the PDF** | **Done** | 2 read from test file, rendered, tooltips, toggle |
| **Render errors cannot kill the app** | **Done** | Per-marker + app-level ErrorBoundary |
| Verified in Acrobat / Preview | **Partial** | User confirmed Chrome; other two untested |
| Verified on a physical iPad | **NOT DONE** | See "Open risks" |
| Photos on punch items | Not started | Needs S3 pre-signed upload |
| Auth, projects, browser upload | Not started | Deliberately deferred from Sprint 1 |
| Go API persistence | Not started | Adapter written, endpoints not built |
| Offline sync | Not started | Sprint 3 |

---

## Export verification — measured

| Our markup | PDF annotation written | `/AP` | Extras |
|---|---|---|---|
| Pin | `/Stamp` | yes | numbered circle in status colour |
| Box | `/Square` | yes | |
| Cloud | `/Polygon` | yes | `/BE <</S /C /I 2>>` + `/Vertices` |
| Arrow | `/Line` | yes | `/LE [/None /ClosedArrow]` |
| Freehand | `/Ink` | yes | `/InkList` |
| Text | `/FreeText` | yes | `/DA` |

Every annotation carries `/F 4` (Print flag) so markups appear on printouts.

```
sourceAnnotations      2      (pre-existing in the test file)
exportedAnnotations    8
addedByUs              6
drawingUnmodified      true   content-stream SHA 7a86ba0a… on both sides
```

---

## Architecture state

**Five registries** now make an annotation type a pure addition:

| Registry | Answers | Tier |
|---|---|---|
| `AnnotationRegistry` | how to rebuild it from storage | domain |
| `MarkerRegistry` | how to draw it on screen | presentation |
| `ToolRegistry` | how to create it from a gesture | domain |
| `PdfWriterRegistry` | how to write it into an exported PDF | infrastructure |

**Command pattern** for undo/redo. `EditorService` is the ONLY class that
writes; `AnnotationService` reads and shapes drafts but never persists. One
write path means undo is correct by construction rather than by discipline.

**Honest note:** `movedBy` was added to the `Annotation` contract AFTER the five
markup types existed, which meant implementing it in four places. The "new types
are pure additions" property only holds once the base contract is complete —
moving was fundamental enough that it should have been there from the start.

---

## Open risks

**1. Only Chrome has opened the export.** Acrobat and macOS Preview are still
unverified. Chrome ignores `/BE`, which is why every shape carries an `/AP` —
that fallback is now known to work, but Acrobat's own rendering of `/BE`, `/LE`
and `/Stamp` is not. **Ten minutes, highest remaining value.**

**2. Nothing has run on a physical iPad.** dpr verified at 1.5; an iPad is 2–3.
Touch drawing (`touchAction: none`, pointer capture) has only been exercised
with synthetic pointer events.

**3. Export holds the whole document in browser memory.** Fine for 153 pages.
If it becomes a problem the exporter moves behind a Go job queue — a new adapter
plus one line in `ServiceContainer`.

**4. Text callouts still use `window.prompt`.** Functional but unstyleable, and
it cannot be cancelled gracefully on a tablet. Replacing it touches one block in
`useSheetEditor`.

**5. Non-Latin text is transliterated in the drawn appearance.** `/Contents`
carries full Unicode, but the appearance stream uses Helvetica/WinAnsi, so
characters outside it become `?` on the page. Real Unicode on the page needs an
embedded font (~300KB per export) — a deliberate Sprint 3 decision.

---

## Session log

### 2026-09-06 — SCRUM-18 / SCRUM-19
Three-tier skeleton in plain JavaScript: contracts as abstract base classes with
runtime enforcement, `PdfPoint`/`ViewportPoint` as separate guarded classes,
pdf.js behind a `DocumentSource` contract, three repository implementations.

Bugs fixed: registries threw on Vite hot reload; `getViewport({rotation})` is
absolute not additive; the SVG viewBox must come from a transformer rather than
`PageGeometry`; coordinate-space error hints leaked into unrelated assertions.

*User verified independently on a real 153-page set — pins survived zoom and reload.*

### 2026-09-07 (morning) — Markup tools and native export
Added `MarkupStyle`, `TwoPointMarkup`, five markup types, the `AnnotationTool`
contract, `ToolRegistry`, six tools, the `SheetExporter` contract,
`ExportService`, `PdfWriterRegistry` and six pdf-lib writers. Shared
`scallops.js` so the on-screen cloud and the exported cloud are one geometry.

### 2026-09-07 (afternoon) — Production hardening
Driven by real user feedback after the first hands-on session.

Added: Command pattern (`Command`, `CommandHistory`, four command types),
`EditorService` as the single write path, `SelectTool`, drag-to-move,
`PropertiesPanel` (description, status, delete), keyboard shortcuts, undo/redo
in the palette, `movedBy` on the `Annotation` contract.

**Four bugs found and fixed:**

1. *Pins exported as generic yellow sticky notes.* `/Text` annotation icons are
   drawn by the viewer, so numbered red pins came out unrecognisable and a
   reviewer could not tell pin 3 from pin 11. Now `/Stamp` with our own
   appearance stream — the export matches the app.
2. *Text callouts rendered clipped in half.* The anchor was the first baseline,
   so glyphs extended upward and a callout near the top of a sheet ran off the
   page. The anchor is now the top-left of the text block, in both renderers.
3. *No way back from a mistake.* Only "clear all" existed. Now every mutation
   is a reversible Command, including clear-all as one composite step.
4. *Unicode corrupted in the export.* `PDFString.of()` writes a byte string, so
   an em-dash became 0x14 — silently, with no error. Descriptions are typed by
   people on site ("Café", "Ø50mm"), so this would have shipped corrupted text
   to a client. Now UTF-16BE hex strings, plus transliteration for the drawn
   appearance where Helvetica genuinely has no glyph.

### 2026-09-07 (evening) — Cloud crash + existing PDF comments

**Cloud tool white-screened the app.** Selecting Cloud and touching the sheet
killed the entire session. Root cause: a cloud is zero-sized at pointerdown, and
`scallopArcs` divided by a zero-length edge, producing `NaN` centres. Those
reached `new PdfPoint(NaN, NaN)`, whose constructor correctly throws — but it
threw during a React render, and React's response to an uncaught render error is
to unmount the whole tree.

Reproduced before fixing, which showed a second path nobody had reported: a
perfectly **horizontal or vertical drag** hit the same NaN, because those also
produce zero-length edges.

Fixed in two places:
1. *Root cause* — the scallop radius no longer depends on the smaller dimension
   (each edge derives its own from its own length), and a zero-length edge
   returns no arcs. Verified finite at 0x0, horizontal, vertical, 10x8, 200x140
   and 1200x780.
2. *Defence in depth* — an `ErrorBoundary` around each marker, plus one around
   the app. The same class of bug now costs one missing markup, not the user's
   session. A failed marker draws a dashed placeholder rather than vanishing,
   because a silently missing markup makes users redraw work that is still
   stored and will still export.

**Existing PDF comments are now visible while editing.** Previously the editor
was blind to annotations already in an uploaded file — the yellow sticky notes
you see in Chrome. A user would open a sheet the architect had already commented
on, see it blank, and re-raise the same issues.

New `SourceAnnotation` read-only value object, `SheetPage.getSourceAnnotations()`
on the contract, and a `SourceAnnotationLayer` drawn beneath the editable markups
with a toggle showing the count. They are deliberately NOT a seventh registered
markup kind: they are read-only, they have no stable identity across reloads,
and they must never be re-exported — the exporter copies the original bytes, so
writing them again would duplicate every existing comment on every export.

---

## Next up

1. **Open the export in Acrobat and Preview.** Screenshot into `docs/verification/`.
2. **Run it on an iPad** over the LAN and draw with a finger.
3. Replace `window.prompt` with an inline text editor.
4. Decide with the team which Jira tickets this closes.

---

## 2026-09-07 (late) — Acrobat conformance + visual cleanup

**Export rendered in Chrome but not Acrobat.** Text callouts, clouds and
freehand strokes were missing. Dumped the exported dictionaries uncompressed
and found three objective conformance faults:

1. **Every date was malformed.** `pdfDate` built `/M` from `toISOString()` by
   stripping dashes and colons, which left the ISO `T` in place:
   `D:20260907T234408Z`. PDF dates have no `T`. Chrome ignores the field;
   Acrobat validates it, and a comment whose date it cannot parse is one it may
   decline to manage. Now built from UTC components — no separator to forget.
2. **`/DA` was UTF-16BE hex.** This was self-inflicted: the earlier Unicode fix
   routed EVERY string through `PDFHexString`, but `/DA` is a content-stream
   OPERATOR string, not a text string. Acrobat could not parse it into drawing
   operators, so FreeText callouts did not render. Chrome uses our `/AP` and
   ignores `/DA`, which is exactly why it survived testing.
3. **`/M` was hex too**, for the same reason, and `/C`/`/IC` were written as
   empty arrays rather than omitted.

Fixed by splitting `text()` (UTF-16BE hex, for real text) from `literal()`
(plain ASCII, for dates and `/DA`), and adding a shared `markupFields()` so a
conformance fix is made once for all six writers instead of six times. Also
added `/CreationDate` and `/NM`, both of which Acrobat's Comments engine uses.

Verified: all six annotations now carry `(D:YYYYMMDDHHmmSSZ)`, a `/CreationDate`,
an `/NM`, no empty colour arrays, and `/DA` as `(/Helv 12 Tf 0.910 0.204 0.165 rg)`.

**Existing-comment display was making the sheet unreadable.** Re-opening an
exported file showed every one of the user's own markups a second time as an
"existing comment", with a hard red dashed box around each. Now default OFF,
grey and faint when on, and labelled "Show N markups already in this file".


### 2026-09-07 (night) — Two more Acrobat faults, found by comparing what worked

The conformance pass (dates, `/DA` encoding) was not enough — drawings and text
still did not render. Dumped the appearance streams and dictionaries side by
side and compared the annotations that WORKED against the ones that did not:

```
/Square    rect precision:  0 digits   -> renders
/Ink       geom precision: 14 digits   303.82013258009624   -> fails
/FreeText  DA names /Helv, AP resources define /F1, AcroForm: absent
```

**Fault 1 — number precision.** Content-stream operators went through `num()`
and were rounded to 3 decimals. Values written into the annotation DICTIONARY
did not, so `/InkList` and `/Rect` carried full IEEE-754 expansions. Adobe's
implementation limit for a PDF real is about five significant decimal digits;
past that Acrobat rejects the object rather than rounding it. This explains the
pattern that looked random: a box dragged between two clamped points lands on
integers, a freehand stroke sampled through a scale transform never does.

Fixed with `roundNumbers()` applied inside `appendAnnotation` and
`createAppearance` — one choke point no writer can forget.

**Fault 2 — the FreeText font did not exist.** A `/FreeText`'s `/DA` names a
font, and that name resolves against the document's **AcroForm `/DR /Font`**
dictionary — not against the annotation's own appearance resources. We wrote
`/DA (/Helv …)` into a document with no AcroForm at all, while the appearance
stream called the same font `/F1`. Acrobat regenerates FreeText appearances
rather than trusting `/AP`, that regeneration needs the `/DA` font, and with no
font it drew nothing.

Fixed with `ensureDefaultFontResource()` plus a shared `DEFAULT_FONT_NAME` so
`/DA` and the appearance resources cannot drift apart again.

Verified: max precision anywhere is now 3 digits, `/DR /Font /Helv` is present,
and every appearance stream naming a font names `/Helv`.

**Both faults were invisible in Chrome**, which parses leniently and renders our
`/AP` directly without consulting `/DA`. Testing in one viewer is what let two
separate bugs survive this long.

### 2026-09-07 (late night) — Flattened export

Four rounds of fixes to the native-annotation export (dates, `/DA` encoding,
number precision, AcroForm `/DR`) each corrected a real, objectively-wrong
thing — and Acrobat still did not show drawings or text. Without the ability to
run Acrobat, further guessing had negative expected value.

Added `FlattenedSheetExporter`: a second `SheetExporter` that paints markups
into the page's content stream instead of attaching them as annotations. The
markup stops being a REQUEST to a viewer and becomes part of the page, exactly
like the walls. If a viewer can display the drawing, it displays the markups.

**Verified**: exported flattened, cleared localStorage, re-opened the file in
the app. `overlayMarkers: 0` — the app drew nothing — and all six markup types
were visible, because they are in the page.

It reuses the six existing writers rather than reimplementing any drawing: it
runs them, takes the appearance stream each produced, registers it as a page
XObject and invokes it with `Do`. A new markup type gets flattened export for
free the moment it has a writer, and the two exports cannot disagree about what
a cloud looks like.

Architecturally this cost one new adapter and one line in `ServiceContainer` —
`ExportService`, the hook and the UI are untouched, because none of them knows
how a markup reaches the page. That is the `SheetExporter` contract earning back
its cost.

**The trade:** native markups are selectable, repliable and appear in Acrobat's
Comments panel; flattened markups are permanent and unselectable but visible
everywhere. Both buttons ship. Native is right for a set going back to the
design team; flattened is right for anything going to a client, a sub, or a
printer.

**Still unresolved:** why Acrobat rejects the native annotations. Next step is
Acrobat Preflight (Tools -> Print Production -> Preflight, "PDF syntax" profile),
which reports the object-level error directly.

### 2026-09-08 — Half-flattening, and a severe second-document bug

**"Flattened" was only flattening our OWN markups.** Anything already in the
file was left as an annotation, on the reasoning that it was not ours to touch.
That produced a half-flattened file and a genuinely confusing report:

    export natively -> re-open that export -> draw more -> export flattened

The new markups appeared in Acrobat. The old ones — still annotations from the
earlier native export — did not. So flattened export looked like it was still
dropping drawings and text, when in fact it had never touched them.

Fixed: flattening now burns EVERY annotation on EVERY page into the page
content. Verified on exactly that sequence:

```
step 1  native export        5 annotations, 4 carrying artwork
        (/Text /Square /Stamp /Ink /FreeText)
step 2  re-open + flatten    0 annotations carrying artwork
                             7 markups painted into the page
```

The single remaining `/Text` is the source file's own sticky note, which has no
artwork to burn — the viewer draws that icon itself, and Acrobat renders it
fine. Nothing is left that a viewer can decline to draw.

**Separately — opening a SECOND document threw and blanked the app.**
`PdfJsLoadedDocument.dispose()` called `this.document.destroy()`, but
**`PDFDocumentProxy.destroy()` does not exist in pdfjs-dist 6.x** — the worker
is owned by the loading task. The throw happened inside the same try block that
loads the new file, so it surfaced as a LOAD failure: the user picked a second
drawing and got a blank screen and an error about `destroy` that had nothing to
do with their file.

It survived every test because disposal only runs on the second open, and every
test started from a fresh page load. Fixed to use `loadingTask.destroy()`, to
never throw, and to run outside the load's try block — releasing an old worker
is housekeeping and must never be reported as the new file being broken.

**Also confirmed from the user's Acrobat screenshot:** the revision cloud now
renders, which the earlier number-precision fix was responsible for.

### 2026-09-08 (later) — Flattened markups landed in the wrong place

Everything rendered in Acrobat, but one box was translated down and to the
left. Tellingly, it was the ONLY markup in the file the user had not drawn — it
was already in the source PDF.

**Cause.** Flattening emitted a bare `q /Name Do Q`, which draws a form XObject
in whatever coordinates its own content stream uses. That is correct for OUR
annotations, because our writers deliberately set `BBox === Rect` and draw in
page coordinates. Most other tools do not: they draw in FORM-LOCAL coordinates
with a `BBox` of `[0 0 w h]` and rely on the viewer mapping that box onto the
annotation's `/Rect`. Flattened with a bare `Do`, such an appearance snaps to
the page origin.

The test file made this exact shape:

```
/Square   Rect [190 190 610 510]   BBox [0 0 420 320]   -> needs +190,+190
```

**Fix.** Compute the placement matrix per PDF 32000-1 §12.5.5 — map the BBox
corners through the form's `/Matrix`, take their bounding box, and derive the
matrix that maps it onto `/Rect` — then emit it as a `cm` before the `Do`.

Verified emission:

```
q 1 0 0 1 190 190 cm /PLMarkup0 Do Q      <- source file's Square
q 1 0 0 1   0   0 cm /PLMarkup1 Do Q      <- our pin   (BBox === Rect)
q 1 0 0 1   0   0 cm /PLMarkup2 Do Q      <- our box   (BBox === Rect)
```

Our own markups get the identity, so nothing that already worked can regress —
which is also precisely why the bug stayed hidden for as long as we only ever
flattened our own work.

### 2026-09-18 — Issued work becomes permanent, and the seam for roles

Two requirements that look unrelated turned out to be one: *may this be changed
right now?* Sealing after a flattened export and refusing an edit a user's role
does not cover are the same question asked of different facts. Building them as
one `EditPolicy` contract is what let roles be **prepared without being turned
on**, which is what was asked for.

**What changed, and what deliberately did not.**

| Added | Edited | Untouched |
|---|---|---|
| `domain/policy/` (7 files) | `EditorService` — asks the policy | all 6 annotation types |
| `domain/export/ExportRecord.js` | `ExportService` — records the export | all 6 marker components |
| `ExportHistoryRepository` + 2 adapters | `SheetExporter` — gained `seals()` | all 6 tools |
| `ConfirmDialog.jsx`, `SealingNotice.jsx` | `ServiceContainer` — wiring | all 6 PDF writers |
| `scripts/verify-sealing.mjs` | 4 presentation files | the repository contract |

The right-hand column is the point. Eighteen of the classes most likely to be
touched by "add a rule about editing" were not opened.

**The design decision worth defending in a review: the seal is not a flag.**

There is no `sealed` boolean on an annotation. A flattened export writes an
`ExportRecord` naming what it contained, and *sealed* is derived from it. That
meant no field on the base class, no edit to any markup type, and no migration
of JSON already in users' browsers — and it produced the D14 audit trail
("issued by X on the 18th, with 11 others") as a side effect rather than as a
second feature.

**Only flattened exports seal.** Flattening paints markups into the page, so the
recipient holds a drawing that cannot be un-drawn. A native export writes live
annotation objects any reader can move — a working copy. The exporter answers
this about itself (`SheetExporter.seals()`), so `ExportService` never learns
which formats are which.

**Three things that were not obvious while building it.**

1. **The policy has to be synchronous.** It runs during render, in the
   properties panel. An async check would produce a frame where a sealed markup
   looks editable — long enough for someone to start typing into a box that was
   never going to save. Hence `ActiveSeals`: read the sheet's seals once on
   open, hold them in a small observable, subscribe with
   `useSyncExternalStore` so a concurrent render cannot tear.
2. **Undo is a second door, and the policy cannot see it.** A command replays a
   stored write directly, so it would walk straight past the check. Issuing
   therefore clears the history. The cost is the user's undo stack at the moment
   they issue a document, which is a fair trade against an undo button that
   quietly breaks a promise.
3. **Clear-sheet had to be partial, not all-or-nothing.** A sheet issued last
   week and worked on since holds both kinds. Refusing outright would leave no
   way to clear the new markups; deleting everything would break the promise.
   It now removes what it may, keeps the rest, and reports the count — silently
   removing fewer items than the button implies would be its own kind of lie.

**Verified.**

* `npm run verify:sealing` — 10/10, against the real domain classes with no UI
  and no test framework. Includes the bypass case: `update`, `move` and `remove`
  on a sealed markup all throw `EditNotPermittedError`, and the stored
  annotation is confirmed untouched afterwards.
* In the browser, on a 2-page drawing: 6 pins issued → export record written
  (`mode: "flattened"`, 6 ids) → all 6 marked `data-sealed` → panel read-only
  with the explanation → **survived a page reload and re-open** → a 7th pin
  added afterwards is fully editable.
* Closing an item shows the dialog, and the status stays `Open` behind it until
  confirmed.
* `npm run lint` — 9 warnings, all pre-existing patterns. `npm run build` clean.

**Documentation.** `REQUIREMENTS.md` is now **v1.3**: D5 is revised (closing
locks nothing; issuing does), FR-3.8, FR-3.9, FR-6.8, FR-6.9 and FR-6.10 are
new, and **open question 1 is closed** — the stakeholder no longer needs to
answer it, because the answer built here is better than either option we
offered them.

**Not done, on purpose.** Roles are not assigned. `RoleEditPolicy` is written,
carries the three roles the stakeholder described, and is one uncommented line
away in `ServiceContainer.jsx`. The verify script includes a check that proves a
second policy slots in without editing `EditorService`.

### 2026-09-18 (later) — A pin must say what is wrong, and every change is signed

Two asks that pull in opposite directions: one hard rule that must hold now, and
one capability that must arrive later without disturbing anything. They wanted
different mechanisms, and separating them was most of the work.

**The rule: a punch item needs a description.**

Enforced in two places, deliberately.

* `PinTool.requiresText()` now collects it **before the pin exists**, so it is
  never stored blank even momentarily. The tool supplies its own wording through
  a new `getTextPrompt()` — which is why a pin asks "What needs fixing?" and a
  callout asks for "Callout text" with no conditional in the presentation layer.
* `EditorService` refuses an incomplete write regardless, covering any future
  import, sync or bulk path that never goes near a tool.

Rules are a fifth registry (`AnnotationRuleRegistry`). Adding "a pin needs a
responsible company" in Sprint 2 is a class plus one line — `Pin.js` is not
reopened. Registration lives in the barrel rather than in each rule file,
because *which* rules a project enforces is a policy decision, not a property of
the rule.

The subtle part is `update`. It does NOT demand completeness; it demands that an
edit does not **introduce** a problem:

    complete   -> incomplete   refused
    incomplete -> incomplete   allowed
    incomplete -> complete     allowed

Without that, pins placed before the rule existed would have been frozen —
unmovable and, worse, unfixable, because saving the missing description is
itself an update to something incomplete.

**The capability: attribution, ready for sign-in.**

Nothing was added to the annotation model. Every change writes a `ChangeRecord`
instead — the same pattern as `ExportRecord`, and for the same reasons. No field
on the base class, nothing for six `with*` methods to remember to carry through,
and the full history D14 asks for rather than only the last change.

The seam is `IdentityProvider`. `EditorService` has asked `identity.current()`
on every write since it was written; `ChangeRecord` stores it, `ExportRecord`
stamps it, and `RoleEditPolicy` reads the role off it. Sprint 2 is one line:

    - new StaticIdentityProvider()
    + new SessionIdentityProvider('/api')

`SessionIdentityProvider` is written and unwired, with the Go endpoint it
expects documented in the file. A verify check signs a user in by swapping that
one argument and asserts the log names them — so if the promise ever stops being
true, the suite says so rather than a teammate finding out in April.

Threaded comments (FR-11) will need no new storage: `comment` is already in the
intent vocabulary, so recording one is a `ChangeRecord` with the text in
`detail`.

**Three bugs found while verifying — two of them real.**

1. **`window.prompt` had to go.** It was always marked temporary; making a
   description mandatory turned the crudest thing in the app into the one users
   meet most. It is single-line, blocks the pdf.js render, and — the reason it
   was untenable — browsers suppress it after repeated use, which for a required
   field means pin placement silently stops working. Replaced with a proper
   modal, which upgrades the Text tool for free.
2. **The dialog dismissed itself with the tap that opened it.** The prompt opens
   during `pointerdown`; by the time `click` was dispatched the backdrop had
   rendered under the cursor and took it. Intermittent — it depended on whether
   React had committed first — so it would have been reported as "sometimes pins
   do not work". Fixed in `useBackdropDismiss`: a backdrop click only counts if
   the gesture *began* on the backdrop.
3. **The text field lost focus to the tail of that same gesture.**
   `document.activeElement` was `BODY` and everything typed went nowhere. On a
   desktop that is one extra click; on an iPad it means no keyboard, turning the
   most repeated action in the product into two taps. Fixed in `useAutoFocus`.

A fourth came out of the verify script rather than the browser: `latestBySheet`
compared timestamps with `>`, so two changes inside the same millisecond
resolved to the OLDER one. Placing a pin and immediately dragging it does
exactly that on a fast machine, and the panel would have reported "added" for a
markup the user had just moved. Now `>=` with append order, in both adapters,
and noted for the SQL version.

**Verified.** `npm run verify` — 26/26 (10 sealing, 16 rules and attribution).
In the browser: the prompt appears with pin-specific wording and a disabled
confirm; whitespace keeps it disabled; a described pin saves and is logged as
"this device added it"; a seeded pre-rule pin shows amber on the sheet, an
inline reason in the panel, and repairs cleanly to a `update / Describe` log
entry; the export confirmation reads "1 pin has no description" with correct
singular grammar. Build clean, lint 10 warnings (all pre-existing patterns).

**Documentation.** `REQUIREMENTS.md` is now **v1.4** — D16 and D17 added,
FR-3.10 to FR-3.12, FR-6.11 and FR-11.0 new.

### 2026-09-18 (debug pass) — five defects found and fixed before the PR

A deliberate review-and-test pass over everything added today, rather than
trusting that it worked because the happy path did. Four of the five were real,
and three of them were the kind that only show up on someone else's machine.

**1. `begin()` could lose a tap silently.** It became `async` when placing a pin
started asking for a description first, so a throw inside it turned into an
unhandled rejection instead of an error anyone would see. The selection branch
sat outside the `try` and calls `toClampedPdfPoint`, which asserts its
argument's coordinate space. The whole body is now guarded.

**2. `setPointerCapture` could throw away the gesture.** It raises
`NotFoundError` when the pointer id is not currently active — a fast tap whose
pointer was already released, a stylus the browser re-issued under a new id, a
synthetic event. The existing `?.` guards the method being *missing*, not
*throwing*. Because capture runs BEFORE the gesture reaches the hook, a throw
lost the entire tap and the drawing simply would not respond. Wrapped: capture
is an enhancement, and losing it costs far less than losing the gesture.

**3. Rule de-duplication did not survive hot reload.** Editing a rule file
re-runs the barrel with a brand new class object, so the identity check let a
duplicate through and the panel reported one missing description twice. Now
identity **plus** class name, with the name check confined to development —
because a minifier renames classes, and two rules collapsing to the same short
name would silently drop one in production.

**4. `listForAnnotation` ordered ties arbitrarily.** The same millisecond
problem already fixed in `latestBySheet`, still present in its neighbour. ISO
timestamps resolve to the millisecond and several changes routinely land inside
one — clearing a sheet records every removal in a tight loop. "The most recent
change" could be any of them. Now sorted by timestamp with append order as the
tiebreak, in both adapters, and noted for the SQL version.

Two of these were caught by the verify script rather than the browser, which is
the argument for having written it.

**5. Undo and redo were not audited.** They replay a stored write straight to
the repository, walking past the recording step — so the log would keep
reporting an edit that had just been reversed, and "last updated by" would
describe something no longer true. Fixed by adding `Command.affects()`: a
non-required method with a safe default of `[]`, overridden by the four
concrete commands. `EditorService` records against whatever the command says it
touched, so a fifth command type is audited the moment it answers the question —
no conditional anywhere.

**Also fixed, cosmetic but not trivial:** the Undo button stayed lit
immediately after issuing a flattened PDF. Clicking it was harmless, but a
live-looking Undo is the wrong thing to show at the exact moment a user has been
told their work is now permanent. The history is cleared out of band by issuing
(and by opening another drawing), so the undo state now re-reads on those too.

**Checked and NOT a defect:** a batch of `useServices() must be called inside a
<ServiceContainer>` errors in the console turned out to be Vite hot-reload
artifacts from editing the context module with the page open. A fresh tab loads
with a completely clean console.

**Final state.** `npm run verify` 28/28 (10 sealing, 18 rules and attribution).
Build clean. Lint 18 warnings, all in two known categories: the deliberate
`revision` / `sealedIds` memo dependencies that the linter cannot see are
load-bearing, and `only-export-components` on files that export a hook beside a
component.

Browser pass on a two-sheet drawing: pin and callout prompts each carry their
own wording and field type; whitespace keeps the confirm disabled; Escape and
Cancel create nothing; a described pin saves and logs as "this device added it";
sheets keep separate annotations and separate logs; undo removes the pin and
records the undo; a flattened export completes, writes `exportedBy: "this
device"`, seals its markups and disables Undo.
