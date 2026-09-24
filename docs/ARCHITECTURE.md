# Architecture

Three-tier, dependency-inverted, plain JavaScript. Written so that new
requirements arrive as **new files**, not as edits to existing ones.

## The three tiers

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1  PRESENTATION          src/presentation/             │
│ React components and hooks. No business rules, no maths.    │
│ Talks to:  AnnotationService and the domain contracts       │
├─────────────────────────────────────────────────────────────┤
│ TIER 2  DOMAIN / APPLICATION  src/domain/                   │
│ Entities, value objects, use cases, CONTRACTS.              │
│ Imports NOTHING. No React. No pdf.js. No fetch.             │
├─────────────────────────────────────────────────────────────┤
│ TIER 3  INFRASTRUCTURE        src/infrastructure/           │
│ Adapters implementing the contracts: pdf.js, storage, HTTP. │
│ Imports: domain (to extend its abstract classes)            │
└─────────────────────────────────────────────────────────────┘
```

**The dependency rule:** arrows point inward. Tier 3 depends on Tier 2. Tier 2
depends on nothing. Tier 1 depends on Tier 2's abstractions, never on Tier 3.

The only file naming a concrete implementation is
`src/presentation/ServiceContainer.jsx` — the composition root. **If you ever
see an import from `infrastructure/` anywhere else, the rule is broken.** That
import is the single thing to look for in code review.

## How JavaScript enforces this without TypeScript

JS has no `interface` and no compile step, so the guarantees are enforced at
**runtime** instead — in `domain/support/contracts.js`.

### 1. Contracts are abstract base classes

```js
export class AnnotationRepository {
  static REQUIRED = ['listBySheet', 'save', 'delete', 'clearSheet'];
  constructor() { enforceContract(this, new.target, AnnotationRepository); }
}
```

Two failures are caught **at construction**, i.e. at app startup, because
everything is wired in one place:

```
new AnnotationRepository()
  -> AnnotationRepository is an abstract contract and cannot be
     instantiated directly.

class Broken extends AnnotationRepository { async listBySheet() {} }
new Broken()
  -> Broken claims to implement AnnotationRepository but does not
     override: save, delete, clearSheet.
```

### 2. Coordinate spaces are separate classes with runtime guards

`PdfPoint` (document space, persisted) and `ViewportPoint` (screen space, never
persisted) are distinct classes. Every boundary between them calls
`assertInstanceOf`:

```
new Pin(id, sheet, new ViewportPoint(200, 150), ...)
  -> Expected Pin position to be a PdfPoint, received ViewportPoint.
     Screen and document coordinates are not interchangeable — convert
     explicitly through a CoordinateTransformer.
```

Storing a screen pixel where a document coordinate belongs is the most
expensive bug class in a PDF markup app: it works on a laptop and breaks on a
retina tablet weeks later. Here it throws **on the first click**, naming both
spaces.

**Honest comparison with TypeScript:** a compiler would catch these before the
code runs; this catches them the first time the object is built. For contracts
wired once at startup, and for a coordinate guard that fires on the first tap,
those are nearly the same thing in practice — you find out immediately, with a
better error message than a compiler gives.

## Why annotations survive zoom

`AnnotationLayer` sets the SVG `viewBox` to the page size **in PDF points**,
while the SVG's CSS size is the page size in screen pixels at the current zoom.
The browser does the transform natively.

Marker coordinates are therefore **never recalculated**. Verified: zooming
1.00x → 2.25x left every marker's `transform` attribute byte-identical.

## The registries

Each question a consumer might ask about an annotation type is answered by a
registry rather than by a conditional in that consumer:

| Registry | Answers | Tier | On unknown kind |
|---|---|---|---|
| `AnnotationRegistry` | how to rebuild it from storage | domain | throws (`tryFromJSON` to skip) |
| `MarkerRegistry` | how to draw it on screen | presentation | skips — a missing marker is cosmetic |
| `ToolRegistry` | how to create it from a gesture | domain | n/a — tools are looked up by id |
| `PdfWriterRegistry` | how to write it into an exported PDF | infrastructure | **throws** — silently dropping a markup from an export is data loss |
| `AnnotationRuleRegistry` | when it is complete enough to issue | domain | no rules — nothing to enforce |
| `PunchListRegistry` | how it reads on the issued schedule | domain | skips — most markups are not action items |

Six sounds like a lot until you notice the alternative: a `switch` in each of
those six consumers, so every new type risks breaking every existing one and
guarantees merge conflicts on a team working in parallel.

Note how the "unknown kind" column differs, and that the differences are not
accidental. Failing to draw a marker is a glitch the user can see and report.
Failing to *export* one is silent data loss discovered by a client, so that one
throws. Being absent from the schedule is simply what a box or a cloud should
do — they are emphasis, not work somebody has to carry out.

The same instinct is why *issued* markups are marked with a `data-sealed`
attribute on the wrapper `AnnotationLayer` already draws, and *unfinished* ones
with `data-incomplete`, both styled from CSS — rather than by passing
`isSealed` / `isIncomplete` props that all six marker components would have to
remember to honour. Adding the second cost one attribute rather than six
component edits, which is that argument made concrete.

## How to add a markup type

Four new files and four barrel lines. **Zero edits to existing code.**

1. `domain/annotations/YourMarkup.js` — extend `Annotation` (or `TwoPointMarkup`
   if it is a drag-shaped one), call `AnnotationRegistry.register(...)` at the
   bottom of its own file.
2. `presentation/components/markers/YourMarker.jsx` — an SVG component calling
   `MarkerRegistry.register(...)`. Project every point through the `project`
   prop; do not add offsets, or it breaks at 90 and 270 degrees.
3. `domain/tools/YourTool.js` — or, for a two-point shape, four lines extending
   `TwoPointTool`. Register it in `domain/tools/index.js` **in palette order**.
4. `infrastructure/export/writers/yourWriter.js` — map it to a native PDF
   annotation subtype and register with `PdfWriterRegistry`.

Then one export line in each of the four `index.js` barrels.

No switch statements, no database migration (kind-specific fields go in the
`payload` JSONB column), no changes to the repository, the services, the
overlay, the palette, or any existing annotation type.

**This is not theoretical.** Rectangle, cloud, arrow, ink and text were all
added after the architecture was in place, and none of them required changing
a single existing file.

## Permissions and the seal

Every write in the application goes through `EditorService`, and every one of
them asks an `EditPolicy` first. That single choke point is what makes two very
different-looking requirements the same piece of code:

* a markup that has been **issued in a flattened PDF** cannot be changed;
* a user whose **project role** does not cover a change cannot make it.

Both are the question *may this be changed right now?*. A policy answers about
one concern and returns `EditDecision.allow()` for everything outside it;
`CompositeEditPolicy` requires unanimous consent. So a new rule is a new class
plus one line in the composition root — no existing policy learns it exists, and
no caller changes.

| Class | Concern | Wired in? |
|---|---|---|
| `SealedByExportPolicy` | has this been issued? | yes |
| `RoleEditPolicy` | does the user's role cover this? | **no — written and waiting** |
| `AllowAllPolicy` | nothing (Null Object) | default when no policy is given |

Roles are deliberately not switched on: nobody signs in yet, so nobody has a
role. Turning them on is one uncommented line in `ServiceContainer.jsx`.

### The seal is a recorded fact, not a flag

There is no `sealed` field on an annotation. A flattened export writes an
`ExportRecord` listing what it contained, and *sealed* is derived — an
annotation is sealed if some flattened export's record names it.

That indirection pays three ways:

1. **The annotation model did not change.** No new field on the base class, no
   edit to any of the six markup types, no migration of JSON already in users'
   browsers.
2. **The lock cannot drift from the truth.** A boolean is something a bug can
   flip; a record of an event either exists or it does not.
3. **It is already the audit trail** D14 asks for — who issued what, and when.

Only *flattened* exports seal. Flattening paints markups into the page content,
so the recipient holds a drawing that cannot be un-drawn — a handover. A native
export writes live annotation objects any reader can move or delete — a working
copy. The exporter answers this about itself via `SheetExporter.seals()`, so a
future third format decides for itself and `ExportService` never learns about it.

Two details that are easy to miss and are load-bearing:

* **`ActiveSeals` exists because the policy must answer synchronously.** It runs
  during render, and a promise there would mean a frame where a sealed markup
  looks editable. Storage is async, so the sheet's seals are read once on open
  and held in a small observable the policy reads.
* **Issuing clears the undo history.** The policy cannot see an undo — a command
  replays a stored write directly — so that door is closed by emptying the stack
  at the moment of issue.

Run `npm run verify:sealing` to check all of this against the real domain
classes, with no UI and no test framework.

## Photographs — the seventh markup type

Photos were the first real test of the "add, don't edit" claim, because they
needed something no previous type did: somewhere to put bytes.

The type itself cost exactly what ARCHITECTURE.md has always promised — four
files and four registration lines (`PhotoMarkup`, `PhotoMarker`, `PhotoTool`,
`photoWriter`). No existing annotation type, service, repository, overlay or
panel was edited. The tool rail, the properties panel and the export all picked
it up on their own.

What was genuinely new was a **new port**, not a change to an existing one.

### Why bytes live in their own store

An annotation DTO goes to `localStorage`: about 5MB for the whole origin, shared
across every sheet of every drawing. One iPad photo is 3–5MB before downscaling.
Putting image data in the annotation would exhaust that on the first photo of
the first walk, and the failure would arrive as a quota error mid-save, taking
the user's text with it.

So `MediaStore` is a separate port backed by IndexedDB, which stores Blobs
natively with no base64 penalty and a quota measured against free disk. The
annotation carries only a `MediaRef` — a key, a MIME type and the dimensions.

That is also the Sprint 2 shape: NFR-5 says files live in S3 and never pass
through the API server, so the Postgres row will hold an S3 key and the browser
will fetch with a pre-signed URL. `MediaRef` does not change. The swap is
`- new IndexedDbMediaStore()` / `+ new S3MediaStore('/api')`.

### Every image is re-encoded, even a small one

`CanvasImageProcessor` draws the input to a canvas and re-encodes to JPEG. One
pass, three problems:

* **Size** — 1600px longest edge (NFR-4), roughly a 90% reduction.
* **Format** — PDF embeds only JPEG and PNG. An iPhone hands you HEIC, which
  could not otherwise reach the export at all.
* **Orientation** — a phone held sideways writes an EXIF flag rather than
  rotating pixels. `createImageBitmap(..., { imageOrientation: 'from-image' })`
  bakes it in. PDF has no concept of EXIF, so without this every portrait shot
  exports on its side — a bug a desktop file picker never reproduces.

### One async writer

`photoWriter` embeds an image, and `pdfDoc.embedJpg` reads bytes, so it cannot
be synchronous. `PdfWriterRegistry.write` now awaits whatever a writer returns;
`await` on a non-promise resolves immediately, so the other six writers were not
touched. Both exporters were already inside an async method.

The image becomes a form XObject inside the annotation's appearance stream
rather than being drawn onto the page, because the constraint that has held
since Sprint 1 still holds: the architect's page comes out byte-identical, with
only annotation objects appended. A missing photo draws a crossed placeholder
rather than failing the export — media and annotations live in separate stores
and can diverge, and losing a hundred good markups to one absent image would be
the wrong trade.

### Capture is two peers, not a fallback

The camera is the point — a superintendent should not leave the app. But it
needs a permission the user can refuse, hardware a desktop may lack, and a
secure context a plain `http://` LAN address does not provide. So upload is a
peer, not a fallback, and either path hands back one Blob.

## Completeness rules

Separate from permissions, and deliberately so. They answer different questions
with opposite remedies:

| | Question | A "no" means |
|---|---|---|
| `EditPolicy` | **May** you change this? | final — the work has been issued |
| `AnnotationRule` | **Is** this finished? | fixable — type a sentence |

One error type for both would leave the interface guessing which tone to use,
and a user told "this is permanently locked" when they merely forgot a
description learns to ignore the next warning too. So there are two:
`EditNotPermittedError` and `AnnotationIncompleteError`.

Rules live in `AnnotationRuleRegistry`, keyed by annotation kind (or `ALL`).
Adding one is a class plus one line in `domain/rules/index.js` — registration
sits in the barrel rather than in each rule's own file, because *which* rules a
project enforces is a policy decision, not a property of the rule.

**Today there is one:** a pin must carry a description. A pin with none reaches
the architect as a numbered marker with nothing attached, and the person who
placed it stopped remembering what they saw about an hour later.

It is enforced in two places on purpose:

* `PinTool.requiresText()` collects the description **before the pin exists**,
  so it is never stored blank even momentarily. The tool supplies its own
  wording via `getTextPrompt()` — that is why a pin asks "What needs fixing?"
  and a callout asks for "Callout text" with no conditional anywhere in the
  presentation layer.
* `EditorService` refuses an incomplete write regardless, which covers any
  future import, sync or bulk path that never goes near a tool.

### "Do not make it worse", not "must be perfect"

`update` does not demand completeness — it demands that the edit does not
**introduce** a problem:

    complete   -> incomplete   refused: you cannot delete a description
    incomplete -> incomplete   allowed: move it, or start fixing it
    incomplete -> complete     allowed: this is the repair path

Without that distinction, pins created before the rule existed would be frozen:
unmovable, and — worse — unfixable, because saving the missing description would
itself be an update to something incomplete.

## Attribution, and how sign-in lands without edits

Nothing records `createdBy` or `updatedBy` on an annotation. Every change writes
a `ChangeRecord` instead, and "last updated and by whom" (D14) is the newest one.

Same pattern as `ExportRecord`, for the same three reasons — no edit to the
annotation model, no field a bug can desynchronise, and the full history the
stakeholder asked for rather than just the last change. It also describes *what*
changed, so two people on one sheet see "Rivera moved it" rather than a bare
timestamp.

The seam is `IdentityProvider`:

| Class | Tier | Wired in? |
|---|---|---|
| `StaticIdentityProvider` | domain (pure) | yes — returns `Actor.ANONYMOUS` |
| `SessionIdentityProvider` | infrastructure (fetches) | **no — the Sprint 2 destination** |

`EditorService` has asked `identity.current()` on every write since the day it
was written, `ChangeRecord` stores whatever comes back, `ExportRecord` stamps it,
and `RoleEditPolicy` reads the role off it. So Sprint 2 is one line:

    - new StaticIdentityProvider()
    + new SessionIdentityProvider('/api')

and names start appearing in a log that has been running all along.

`Actor.ANONYMOUS` is a real object, never `null`, so no call site needs
`actor?.displayName ?? 'someone'` — the one that forgot would have printed
"undefined edited this item" in front of a stakeholder. It reads "this device",
which is honest about exactly what we know.

**Threaded comments (FR-11) need no new storage.** `EditPolicy.INTENT` already
includes `comment`; recording one is a `ChangeRecord` with that intent and the
text in `detail`, so "who commented" is answered by the query that already
answers "who edited".

`npm run verify` exercises all of this, including a check that signs a user in
by swapping ONE constructor argument and asserts the log names them — if that
ever stops being true, the promise has been broken and the suite says so.

## The export pipeline

`ExportService` (domain) walks the pages, collects annotations, and hands them
to a `SheetExporter`. `PdfLibSheetExporter` (infrastructure) loads the original
PDF and **appends annotation dictionaries to each page's `/Annots` array**.

It never touches a content stream. Verified: the drawing's content-stream SHA is
identical before and after, and annotations already present in the source
survive untouched.

Each markup becomes a real PDF annotation, not a flattened picture:

| Markup | PDF subtype | Notes |
|---|---|---|
| Pin | `/Text` | Viewer draws the icon from `/Name`; the only one needing no `/AP` |
| Box | `/Square` | |
| Cloud | `/Polygon` | `/BE <</S /C /I 2>>` — the spec's own cloudy border, so it stays editable |
| Arrow | `/Line` | `/LE [/None /ClosedArrow]` |
| Freehand | `/Ink` | `/InkList` is nearly our storage format already |
| Text | `/FreeText` | needs a font in the appearance stream's `/Resources` |

**Every shape carries an `/AP` appearance stream.** Acrobat would synthesise one
from the geometry; Chrome and most mobile viewers would render nothing at all.
Testing only in Acrobat is how that ships broken.

## How to move persistence to the Go API (Sprint 2)

One line in `ServiceContainer.jsx`:

```diff
- const repo = repository ?? new LocalStorageAnnotationRepository();
+ const repo = repository ?? new HttpAnnotationRepository('/api');
```

`HttpAnnotationRepository` is already written and documents the exact endpoint
contract the Go service must satisfy. Hand it to whoever owns the backend — the
payload shape is already fixed by what localStorage writes today.

## How to add pinch-zoom (Sprint 2)

Replace the internals of `presentation/hooks/useViewState.js`. Everything
downstream consumes `scale` and `rotation`, not gesture state, so a gesture
library attaches there and nowhere else.

**Selection criterion:** the library must expose its current scale and
translation. One that hides its transform internally is unusable — those
numbers are exactly what the screen→PDF conversion needs.

## Directory map

```
web/src/
  domain/                      TIER 2 — imports nothing
    support/contracts.js       enforceContract / assertInstanceOf — read first
    geometry/                  PdfPoint, ViewportPoint, PageGeometry,
                               CoordinateTransformer (CONTRACT)
    annotations/               Annotation base, MarkupStyle, TwoPointMarkup,
                               Pin + 5 markup types, AnnotationRegistry,
                               geometry/scallops.js (shared cloud shape)
    tools/                     AnnotationTool (CONTRACT), TwoPointTool,
                               6 tools, ToolRegistry
    policy/                    EditPolicy (CONTRACT), EditDecision,
                               SealedByExportPolicy, CompositeEditPolicy,
                               AllowAllPolicy, ActiveSeals,
                               RoleEditPolicy (written, NOT wired)
    rules/                     AnnotationRule (CONTRACT), RuleViolation,
                               AnnotationRuleRegistry, RequiredDescriptionRule
    media/                     MediaRef — a pointer to bytes, not the bytes
    identity/                  Actor, StaticIdentityProvider,
                               CounterIdGenerator
    audit/                     ChangeRecord — who did what, NullChangeLog
    export/                    ExportRecord — the fact that seals
    ports/                     AnnotationRepository, DocumentSource,
                               IdGenerator, SheetExporter,
                               ExportHistoryRepository, IdentityProvider,
                               ChangeLogRepository, MediaStore — all CONTRACTS
    services/                  AnnotationService (the tap->PdfPoint rule),
                               EditorService (the ONLY writer),
                               ExportService

  infrastructure/              TIER 3 — implements the contracts
    pdf/                       the ONLY two files importing pdfjs-dist
    export/                    pdf-lib exporter + 6 annotation writers
    persistence/               InMemory | LocalStorage | Http, plus the
                               export-history and change-log repositories
    identity/                  CryptoIdGenerator,
                               SessionIdentityProvider (written, NOT wired)
    media/                     IndexedDbMediaStore, CanvasImageProcessor
    identity/                  CryptoIdGenerator

  presentation/                TIER 1 — React
    ServiceContainer.jsx       COMPOSITION ROOT — the only wiring file
    hooks/                     document / view state / annotations / drawing / export
    components/                canvas, overlay, toolbar, palette, inspector
      markers/                 7 SVG components + MarkerRegistry
    media/                     MediaUrlCache + useMediaUrl — object URLs made
                               once and revoked once
      ConfirmDialog.jsx        promise-based modal (useConfirmation)
      PromptDialog.jsx         promise-based text input (useTextPrompt)
      PhotoCaptureDialog.jsx   camera + upload (usePhotoCapture)
      Icon.jsx                 the icon set, drawn not installed
      SealingNotice.jsx        the wording used to explain permanence
      useBackdropDismiss.js    a backdrop click only counts if it started there
      useAutoFocus.js          focus that survives the gesture that opened it

web/scripts/
  verify-sealing.mjs           npm run verify — 26 checks total, no framework
  verify-rules-and-attribution.mjs
```

## A note on editor support

Every public method carries JSDoc `@param` / `@returns`. That is plain
JavaScript — comments only, no build step — but VS Code reads it and gives you
autocomplete and parameter hints as if the code were typed.

If the team ever wants type *checking* without adopting TypeScript, add a
`jsconfig.json` with `"checkJs": true`. Entirely optional and reversible.
