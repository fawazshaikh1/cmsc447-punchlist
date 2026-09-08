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

## The four registries

An annotation type has to do exactly four things, and each is answered by a
registry rather than by a conditional in a consumer:

| Registry | Answers | Tier | On unknown kind |
|---|---|---|---|
| `AnnotationRegistry` | how to rebuild it from storage | domain | throws (`tryFromJSON` to skip) |
| `MarkerRegistry` | how to draw it on screen | presentation | skips — a missing marker is cosmetic |
| `ToolRegistry` | how to create it from a gesture | domain | n/a — tools are looked up by id |
| `PdfWriterRegistry` | how to write it into an exported PDF | infrastructure | **throws** — silently dropping a markup from an export is data loss |

Four sounds like a lot until you notice the alternative: a `switch` in each of
those four consumers, so every new type risks breaking every existing one and
guarantees merge conflicts on a team working in parallel.

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
    ports/                     AnnotationRepository, DocumentSource,
                               IdGenerator, SheetExporter — all CONTRACTS
    services/                  AnnotationService (the tap->PdfPoint rule),
                               ExportService

  infrastructure/              TIER 3 — implements the contracts
    pdf/                       the ONLY two files importing pdfjs-dist
    export/                    pdf-lib exporter + 6 annotation writers
    persistence/               InMemory | LocalStorage | Http
    identity/                  CryptoIdGenerator

  presentation/                TIER 1 — React
    ServiceContainer.jsx       COMPOSITION ROOT — the only wiring file
    hooks/                     document / view state / annotations / drawing / export
    components/                canvas, overlay, toolbar, palette, inspector
      markers/                 6 SVG components + MarkerRegistry
```

## A note on editor support

Every public method carries JSDoc `@param` / `@returns`. That is plain
JavaScript — comments only, no build step — but VS Code reads it and gives you
autocomplete and parameter hints as if the code were typed.

If the team ever wants type *checking* without adopting TypeScript, add a
`jsconfig.json` with `"checkJs": true`. Entirely optional and reversible.
