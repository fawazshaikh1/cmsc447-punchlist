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
| `ItemFieldRegistry` | what else is recorded on a punch item (trade, company…) | domain | keeps the value — a field from a newer build is never deleted |
| `FieldEditorRegistry` | which input edits each kind of field | presentation | shows the value read-only |
| `ToolShortcutRegistry` | which key picks a tool | presentation | no key — the tool is still on the rail |
| `TaskSortRegistry` | how the Tasks tab can sort | domain | sorts by sheet |
| `TaskGroupRegistry` | how the Tasks tab can group | domain | one group |

Eleven sounds like a lot until you notice the alternative: a `switch` in each of
those consumers, so every new type risks breaking every existing one and
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

## How to add a punch item field

Trade, responsible company, assignee and due date are **item fields**. Each is
one class in `domain/details/fields/`, registered in `domain/details/index.js`
in the order the panel shows them. To add another — priority, room, cost:

1. `domain/details/fields/YourField.js` — extend `TextItemField` or
   `DateItemField` (or `ItemField` for a new kind of input) and give it a
   `getKey()` and `getLabel()`. The key is a storage column in all but name:
   never rename it once data exists.
2. One `ItemFieldRegistry.register(new YourField())` line in the barrel.
3. Only for a NEW input kind: an editor in
   `presentation/components/details/` and one `FieldEditorRegistry.register`
   line in that folder's barrel.

`Pin`, the properties panel, storage, undo and the change log all pick it up.
Values live in the pin's `payload.details` as a flat object of strings — a
JSONB column on the server, no migration. A due date is stored as `YYYY-MM-DD`
and handled as a `CalendarDate`, never a `Date`, so it cannot shift a day in a
time zone west of UTC.

*Honest note:* the first four fields needed a one-time extension point — `Pin`
gained a `details` value carried through its copy methods, and the panel gained
one `withDetail` capability check. Every field after them is the two steps
above. `npm run verify:details` proves it by registering a field the suite
invents and storing it with no other change.

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

Then one export line in each of the four `index.js` barrels. A key for the new
tool, if it should have one, is one more line —
`ToolShortcutRegistry.register('yourTool', 'Y')` in `presentation/tools/index.js`.

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
| `RoleEditPolicy` | does the user's role cover this? | server mode, where people sign in |
| `AllowAllPolicy` | nothing (Null Object) | default when no policy is given |

Roles came on with sign-in as one more entry in the policy array in
`ServiceContainer.jsx` — no existing policy or caller changed. Browser mode
leaves it out: nobody signs in there, and the anonymous actor has no role.

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
| `StaticIdentityProvider` | domain (pure) | browser mode — returns `Actor.ANONYMOUS` |
| `SessionIdentityProvider` | infrastructure (fetches) | server mode — the signed-in person, with their role on the open project |

`EditorService` has asked `identity.current()` on every write since the day it
was written, `ChangeRecord` stores whatever comes back, `ExportRecord` stamps it,
and `RoleEditPolicy` reads the role off it. Sign-in (SCRUM-44) swapped the
provider in the composition root, and names started appearing in a log that
had been running all along — see "Accounts, projects and roles" below.

`Actor.ANONYMOUS` is a real object, never `null`, so no call site needs
`actor?.displayName ?? 'someone'` — the one that forgot would have printed
"undefined edited this item" in front of a stakeholder. It reads "this device",
which is honest about exactly what we know.

**Threaded comments (FR-11) needed almost no new storage.** `EditPolicy.INTENT`
already included `comment`; recording one is a `ChangeRecord` with that intent
and the text in `detail`, so "who commented" is answered by the query that
already answers "who edited". A reply adds one nullable column, `reply_to` —
see "Comments, bookmarks and finding a sheet" below.

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

## Saving to the Go API (SCRUM-41)

**The app saves to the server by default.** `npm run dev` reads and writes
markups, change history and export history through the Go API.
`npm run dev:browser` saves in the browser instead, for working on the frontend
without Go or Postgres.

### One-time setup (macOS)

```bash
brew install go postgresql@17
brew services start postgresql@17

# The login backend/main.go expects by default: postgres / dev
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres \
  -c "CREATE ROLE postgres LOGIN PASSWORD 'dev';" \
  -c "CREATE DATABASE punchlist OWNER postgres;"
PGPASSWORD=dev /opt/homebrew/opt/postgresql@17/bin/psql -h localhost -U postgres \
  -d punchlist -f backend/schema.sql

# For `go test` only: a database the tests are free to wipe
/opt/homebrew/opt/postgresql@17/bin/createdb -O postgres punchlist_test
```

The sign-in tables (`backend/auth_schema.sql`) are applied by the server itself
every time it starts, so a database made before accounts existed is brought up
to date without anyone running psql.

### Every day

```bash
cd backend && go run .          # API on :8080
cd web && npm run dev           # app on :5173 — /api is proxied to :8080
```

### How it is wired

`web/.env` sets `VITE_API_BASE=/api`; `web/.env.browser` (loaded by
`npm run dev:browser`) clears it. The composition root (`ServiceContainer.jsx`)
then wires either `HttpAnnotationRepository`, `HttpChangeLogRepository` and
`HttpExportHistoryRepository`, or the local-storage ones — all three together,
so a markup's history never lives somewhere other than the markup.
`vite.config.js` proxies `/api` to `localhost:8080` (`API_TARGET` overrides). A
production build calls `/api` on its own origin, so the deployed site must
serve the API there (SCRUM-49).

### Work saved in the browser before server mode is not lost

In server mode the stores are wrapped in decorators (`domain/upload`) that, the
first time a sheet or document is used, upload whatever this browser had saved
for it: markups, their history and export records. The server's copy wins when
both have the same markup, a markup deleted on the server stays deleted, and an
issued markup stays locked. The browser copy is kept as a backup. A ledger in
local storage (`punchlist.uploadedToServer`) records what is done, so it
happens once; a failed upload is retried on the next read. Nothing that reads
the stores knows the upload exists.

With projects, the browser's work goes into **the first project that opens
the drawing**: it was filed under the bare sheet id (`A-101.pdf#0`), and is
uploaded under that project's (`p12:A-101.pdf#0`). The ledger is keyed by the
bare id, so a second project with the same file does not get a copy. A role
that may not write it (a collaborator cannot add a pin) does not block reading
the sheet: the refusal is not recorded as done, and someone allowed to — the
project's admin, on this browser — uploads it later.

### When the server is down

The app says so — *"The Punch List server at /api is not responding (502 Bad
Gateway). Is the backend running? To work without it, run
`npm run dev:browser` instead."* The second sentence appears only in
development. A failed sealed-markups request throws rather than returning
nothing, so an issued markup can never quietly become editable.

### Checks

`npm run verify -- http` runs the repositories against a stand-in mirroring
`backend/main.go` and `backend/history.go`; `npm run verify -- upload` covers
the one-time upload. Both were also run end to end against the real Go server
and Postgres (see PR #14).

## Accounts, projects and roles (SCRUM-42 to 47)

Server mode needs a signed-in person working in a project. Browser mode is
untouched: nobody signs in, sheets are named as before, every tool is offered.

### On the server

| File | What it does |
|---|---|
| `auth.go` | register, sign in, sign out, `GET /api/auth/me`, `GET /api/session?project=` |
| `projects.go` | create and list projects; list, add, re-role and remove members |
| `access.go` | wraps every markup, history and export route with the role check |
| `auth_schema.sql` | sessions table, job title, `export_history.project_id` — applied at startup |

Passwords are PBKDF2-SHA256 (600,000 iterations, random salt, standard
library). The session is an opaque random cookie — HttpOnly, SameSite=Strict,
Secure behind HTTPS — and only its SHA-256 digest is stored. A wrong password
and an unknown email get the same answer in the same time, sign-in attempts are
rate limited per address, and every state-changing request must carry
`X-Punchlist-Request: 1`, which another site cannot add without the server's
consent.

**How the server knows a sheet's project.** Inside a project the browser names
each sheet `p{projectId}:{file}#{page}` (`domain/projects/SheetScope`). The
project is read from the id, so every request can be checked without a lookup
table, two projects can both have an `A-101.pdf`, and a sheet can never be
claimed by another project. An id without the prefix belongs to no project and
is unreachable through the API.

**Who may do what** — one table on each side, kept in step:

| | Admin | Power collaborator | Collaborator |
|---|---|---|---|
| See the project's sheets and markups | yes | yes | yes |
| Add photos | yes | yes | yes |
| Add any other markup | yes | yes | no |
| Move, resize, edit, change status, delete, clear a sheet | yes | yes | no |
| Issue a flattened PDF (locks markups) | yes | yes | no |
| Add people, change roles, remove people | yes | no | no |

`RoleEditPolicy.RIGHTS` / `.CREATABLE` in the browser, `canEdit` /
`collaboratorKinds` in `access.go`. The browser's copy decides what is
*offered*; the server's is the one that counts. A role change takes effect on
the next request — there is nothing cached in the session to go stale.

The server also writes the **author of every change record itself**, from the
session. A browser cannot attribute a change to someone else. The one claim it
keeps is "this device" (the anonymous actor), which impersonates nobody and is
the truth about history saved before sign-in existed and uploaded later.

A project always keeps an admin: demoting or removing the last one is refused,
inside a transaction that locks the project, so two admins demoting each other
at the same moment cannot both succeed. A person is added by the email of an
account that already exists — without email verification, an invitation
waiting for an address would go to whoever registered it first.

### In the browser

```
domain/projects/        SheetScope, Project, Member, ProjectRole
domain/ports/           AccountRepository, ProjectRepository
infrastructure/auth/    HttpAccountRepository, HttpProjectRepository
presentation/session/   SessionGate -> SessionProvider (the state machine),
                        SignInScreen, ProjectPicker, MembersDialog, SessionMenu,
                        useSheetIdentity
```

`main.jsx` wraps the app in `SessionGate`, which shows sign-in, then the project
list, then the app — keyed by project, so opening another project starts
afresh. Opening a project calls `SessionIdentityProvider.useProject(id)`
*before* the editor appears, so nothing is ever written as nobody.

Hiding what a role cannot do asks the policy, never the role:

| Control | Asked as |
|---|---|
| A tool in the rail | `editor.canCreate(tool.createsKind())` |
| Issue PDF | `editor.canIssue()` (intent `issue`) |
| Clear pins | `editor.canClearSheet()` |
| Delete, size, editable fields | `editor.canEdit(markup, intent)` — a role lock *hides* them, an issued markup shows them disabled beside its notice |

A server refusal (403) arrives as `EditNotPermittedError` carrying the
server's own sentence, the same error the client-side policy throws, so the
editor shows it in the usual place.

Returning to the tab re-checks the session quietly: an expired session goes
back to sign-in, removal from the project goes back to the project list, and a
changed role updates the tools in place without closing the drawing.

### Checks

`cd backend && go test ./...` — 23 tests against a real Postgres
(`punchlist_test`): sign-in and sessions, CSRF, rate limiting, the role matrix,
cross-project attacks, last-admin races, server-side attribution.
`npm run verify -- accounts` — 22 checks on the browser side.

## Pinch-zoom and two-finger pan (SCRUM-48)

Zoom is still one number, `scale`, owned by `useViewState`. The gesture code in
`presentation/gestures/` only asks for a new one through `zoomTo`, so the
canvas, the overlay and the screen->PDF maths never learn that pinching exists.
No gesture library: the rule was that one must expose its scale and
translation, because the screen->PDF conversion needs them. Owning the gesture
keeps the only lasting transform the one the coordinate code already knows —
`scale` — and costs four small files.

| File | Job |
|---|---|
| `TouchGestureArbiter.js` | decides what each touch is — one finger draws, two fingers zoom. Plain class, no DOM, tested with a fake clock |
| `usePinchZoom.js` | the DOM half: capture-phase listeners on the stage, the CSS preview, the commit, the scroll that keeps the spot under the fingers |
| `pinchGeometry.js` | the arithmetic — midpoint, the anchor as a fraction of the sheet, the scroll that puts it back |
| `zoomLimits.js` | 25%–800%, shared with the zoom buttons |

**A pinch never draws.** Two fingers land tens of milliseconds apart, so the
first touch is held for up to 120 ms. A second finger in that window makes it a
pinch and the sheet never hears about the first. Lifting the finger (a tap), or
moving it more than 8 px (a drag), hands it over at once, so a pin still lands
on the tap and a stroke still starts where the finger went down — the held
`pointerdown` is replayed at its original target. A mouse or pen is never held.

**Preview, then commit.** While the fingers move, the sheet is scaled with a CSS
transform — re-rendering an E-size sheet through pdf.js sixty times a second is
not an option. When they lift, `scale` is set once and the stage is scrolled so
the spot that was between the fingers is between them again. That scroll runs
in a passive effect on purpose: the sheet is sized by `SheetCanvas`'s own
effect, and a parent's effects run after its children's.

A trackpad pinch arrives as `wheel` with `ctrlKey` set and takes the same commit
path, zooming about the cursor. Plain scrolling is left to the browser. The
stage has `touch-action: none` so the browser's own page zoom does not fight
the sheet's.

`npm run verify -- pinch` covers the arbiter's decisions and the geometry.

## Photos on the server (SCRUM-45)

In server mode a photo's bytes live on the server with its project, not only in
the browser that took it — so a teammate sees it, an export from any device
includes it, and a broken tablet loses nothing.

| Piece | What it does |
|---|---|
| `backend/media.go` | `PUT /api/media/{key}?project=` stores the image; `GET` returns it to anyone on the project; `DELETE` is for editors |
| `backend/media_schema.sql` | the `media` table (bytes in Postgres for now), applied at startup |
| `HttpMediaStore` | the `MediaStore` port over that API |
| `domain/upload/UploadingMediaStore` | new photos go to the server; a photo only this browser has is uploaded under its existing key the first time it is shown |

The key is chosen in the browser (`photo_<uuid>`) because the photo is stored
before the markup that shows it exists, and the markup records the key. Keeping
the same key everywhere is what lets older photos migrate by themselves. Only
real image types are accepted — not SVG, which can carry script — and responses
are `private, immutable`. Moving the bytes to S3 for the deploy (SCRUM-49)
changes `media.go`'s storage calls and nothing the browser sees.

## The punch list (SCRUM-32, SCRUM-52)

The side panel's second view: every punch item in the project, grouped by
drawing, with filters for status (including "still to do" and overdue),
company, trade, "assigned to me" and free text. Tapping an item on the drawing
on screen goes to its sheet and selects it.

- `domain/punchlist/TaskList` is pure: annotations in, numbered and filtered
  rows out. Items are numbered per drawing with the same `assignOrdinals` call
  that numbers the pins and the issued schedule — "item 7" is the pin with 7 in
  it and line 7 of the PDF. What counts as an item is whatever
  `PunchListRegistry` schedules (pins today).
- `GET /api/projects/{id}/items` returns the project's markups in sheet order.
  In browser mode the list covers the open drawing, read sheet by sheet.
- **Assigning someone means picking a teammate.** A field may name a run-time
  suggestion source (`ItemField.getSuggestionSource`); the assignee asks for
  `'people'`, and the session supplies the open project's members — so the name
  is spelled exactly as "Assigned to me" matches it.

## A returned working copy is the same drawing

A working copy of `A-101.pdf` usually comes back renamed —
`A-101-marked-up.pdf`. It opens **as** `A-101.pdf`: each of our markups in the
file records the sheet it was exported from (`documents/sheetNames`), so its
pages are that drawing's sheets and its markups are the same items, not copies.
On the server that is the only coherent answer — a markup id is unique across
every sheet — and it means an edit made from the returned file reaches the
items everyone else sees.

Each markup is restored on its own; one that cannot be is left in the file,
read-only, and counted so the user is told. Opened in a *different* project,
a working copy's markups are copies there, with derived ids (`id~p2`), so
reopening it finds them rather than making more.

## Drawings on the server (FR-10)

A drawing used to live only on the device that opened it: its markups went to
the server, the PDF under them did not, so a teammate — or the same person on
another tablet — had to find the file again. Each project now keeps a library
of its drawings, opened from the start screen or **Drawings** in the top bar,
the way a file is uploaded once and then opened in Acrobat's file view.

| Piece | What it does |
|---|---|
| `backend/documents.go` | the library: list, add (`POST ?name=`, the PDF as the body), open, delete. Members open; only an admin adds or deletes (FR-10.4) |
| `backend/documents_schema.sql` | the `documents` table, applied at startup through `registerSchema` (`backend/schemas.go`) |
| `domain/ports/DrawingLibrary` | the port; `HttpDrawingLibrary` implements it, wired in `ServiceContainer` (server mode only) |
| `domain/library` | `LibraryDrawing`, and the two rules: who may change the library, and which opened drawings belong in it |
| `presentation/library` | `useLibrary` (open from disk or from the library), `DrawingList`, `LibraryButton` |

- **A drawing is known by its file name in the project**, because its sheets
  already are (`p{project}:{name}#{page}`). Opening it from the library is
  opening that file, so every markup, seal and export made on it is there.
- **An admin's drawing opened from this device is saved to the project** once
  it has opened — `useSheetDocument.openFile` resolves with what it opened.
  The same file again is a no-op (matched by SHA-256); a different file under
  a name already taken is refused, since it would inherit another drawing's
  markups (carrying markups across a revised set is FR-1.5). Anyone else is
  told the drawing is on their device only.
- **A returned working copy is not stored**: it opens as the drawing it came
  from, and its bytes are not that drawing's.
- Bytes are in Postgres for now, like photos; S3 at deploy (SCRUM-49) changes
  `documents.go`'s storage calls and nothing the browser sees.

`go test` (`documents_test.go`) and `npm run verify -- library`.

## Select by default, one tool at a time

A tool used to stay on after it placed a markup, so the next tap placed
another, and editing what had just been made meant a trip to the rail for
Select. Now a tool places one markup and hands back to Select with that markup
open, as Fieldwire and Bluebeam do.

| Piece | What it does |
|---|---|
| `presentation/tools/ToolLatch` | pure: which tool is on after a press, a hold, a create or Escape, and whether the new markup is selected |
| `presentation/tools/useToolLatch` | applies it once per new markup — `useSheetEditor` reports each add as `created` (`{ id, seq }`) |
| `presentation/tools/ToolShortcutRegistry` | which key picks which tool, filled in `presentation/tools/index.js` |
| `presentation/tools/shortcutTarget`, `useToolShortcuts` | a key picks its tool unless the person is typing, holds Ctrl, Cmd or Alt, or their role does not have that tool |
| `presentation/tools/HoldGesture` | which click only ends a long press, so it is not taken for a second press — and only that one |

- **Keeping a tool on.** Double-click a tool, or hold it for half a second on a
  tablet, and it stays on; a lock shows on the button. Pressing it again
  releases the lock, and Escape returns to Select.
- A gesture that makes nothing — a pin whose description was dismissed —
  leaves the tool on, so the person can try again.
- **While a markup is being drawn** — dragged out, or waiting on its photo or
  description — nothing changes the tool. Escape drops the draft and leaves
  the tool as it was, a key waits, and a drag finishes with the tool it
  started with even if the markup before it, still saving, sends the app back
  to Select.
- "Open" includes the panel: at 900px and below it starts hidden, and placing
  a markup brings it in with the new markup's details.
- The latch is presentation state, not a domain rule: which tool is in the
  hand means nothing to storage, export or the server. It is pure functions
  all the same, so it is checked in Node.

`npm run verify -- tool-latch`.

## Sheet numbers and titles

A drawing set names its own sheets in the title block — "A-101 · LEVEL 1 FLOOR
PLAN" — and the product called them "Sheet 1". It now reads the names once,
keeps them with the project, and uses them wherever a sheet is named.

| Piece | What it does |
|---|---|
| `domain/sheets` | `SheetName` (number and title, detected or edited, tidied and capped at 40 and 120 characters), `SheetNames` (one drawing's names, "Sheet N" for a page without one) and `findSheetName` — a page's text in, its number and title out |
| `domain/ports/SheetNameDetector` | reads a drawing's names; `PdfJsSheetNameDetector` opens its own copy with pdf.js, so the drawing on screen is never held up by it |
| `domain/ports/SheetNameRepository` | the project's names; `HttpSheetNameRepository`, server mode only |
| `backend/sheet_names.go` | `GET /api/projects/{id}/sheet-names` and `PUT /api/projects/{id}/sheet-names/{drawing}`; the `sheet_names` table (`sheet_names_schema.sql`), one row per drawing and page |
| `presentation/sheets` | `useSheetNames` — load, read, rename — and `RenameSheetDialog` |

- **How a name is found.** A value labelled SHEET NUMBER, SHEET NO., DWG NO. or
  SHEET TITLE wins. Without labels, the number is the largest sheet-number-shaped
  text (A-101, S-2.01, M1.1) in the bottom-right third of the sheet, and the
  title the largest capitalised line beside it. Grid bubbles, room numbers,
  dimensions, dates and "SEE A-501" are not taken. A scanned set has no text,
  so its pages stay "Sheet N".
- **Who reads, who renames.** The first admin or power collaborator to open a
  drawing reads it in the background and saves names for the pages that have
  none (`detected`). A collaborator never reads; they see "Sheet N" until
  someone has. Only an admin renames, from the sheet picker (`edited`): a
  rename replaces the name, and no later reading overwrites it. The server
  refuses both from anyone else.
- **A drawing still uploading.** An admin's new drawing is read while its PDF
  is on its way to the library, and the server refuses names for a drawing it
  does not have yet. They are shown at once and saved when the library
  reports the drawing added (`presentation/sheets/UnsavedSheetNames`).
- **Where the names show.** The sheet picker, the punch list ("A-101 · Open ·
  …") and the issued PDF's schedule. `ExportService` takes an optional
  `sheetLabelFor` and `PunchListRegistry` relabels each schedule entry with
  it, so neither the PDF writers nor the schedule page know where a name came
  from.
- Names are filed under the drawing's name in the project, like its sheets,
  and a drawing removed from the library takes its names with it. In browser
  mode they are read and kept for the session.

`go test` (`sheet_names_test.go`) and `npm run verify -- sheet-names`.

## The Tasks tab

Every task in the project in one list (spec 6): **Sheets / Tasks** in the top
bar, server mode only.

| Piece | What it does |
|---|---|
| `domain/tasks` | `buildTaskRows` (the punch list's numbered items plus priority, lock, last change, off-sheet), filters, sorts and groupings through `TaskSortRegistry` / `TaskGroupRegistry`, and `taskCsv` |
| `domain/annotations/OffSheetTask` | kind `task`, stored on the project's `~tasks` sheet; `placedAt` makes it a pin with the same id |
| `domain/details/fields/PriorityField` | High / Medium / Low, read as Medium where none was chosen, edited by `ChoiceFieldEditor` |
| `EditorService.applyAll` | several changes as one undo step — bulk edit, placing a task — skipping and reporting what the policy refuses |
| `domain/ports/TaskRepository` | the project's locks, latest changes, and one item's history across sheets; `HttpTaskRepository` |
| `backend/tasks.go` | `GET /api/projects/{id}/sealed`, `GET /api/projects/{id}/changes/latest`, `GET /api/annotations/{id}/changes` |
| `presentation/tasks` | `TasksView`, `TaskDrawer`, `NewTaskDialog`, `PlaceTaskDialog`, `BulkBar`, `useTasks` |

- **A task off the drawings is still a markup**, so roles, history, undo and
  the item fields apply to it with no second code path. Its sheet belongs to
  no drawing, so it is never in an issued PDF. A markup never moves between
  sheets, so placing one is a delete and a create with the same id, in one
  undoable step; its history is read by id across sheets.
- **Locks across the project**: the Tasks tab fills `ActiveSeals` with every
  drawing's issued markups, so an issued task is read-only here exactly as on
  its sheet.
- **Going to a sheet** (`App.jsx`): the drawing is opened from the library if
  another is on screen, then the page; `SheetViewer` is handed an `arrival` —
  a task to select, or the pin tool to arm with a description waiting.

`npm run verify -- tasks-tab` and `go test` (`tasks_test.go`).

## Comments, bookmarks and finding a sheet

Spec 7: talking about a task where it is, and getting to a sheet fast.

| Piece | What it does |
|---|---|
| `domain/comments` | `Comment` (read from a change record) and `threadsOf` — oldest first, replies one level deep, a reply whose comment is gone stands alone |
| `domain/sheets/searchSheets` | finds a sheet by its number with the punctuation squashed ("a101" is A-101) or by words in its title; exact numbers first, then prefixes |
| `SealedByExportPolicy` | lets `INTENT.COMMENT` through on an issued markup — the seal stops edits, not conversation |
| `domain/ports/CommentRepository`, `BookmarkRepository` | a task's comments, posting one, the project's counts; a person's starred sheets; `HttpCommentRepository`, `HttpBookmarkRepository` |
| `backend/comments.go` | checks a comment as it is recorded (text required, ≤ 2,000 characters, a reply answers a comment on the same task); `GET /api/projects/{id}/comments/counts` |
| `backend/bookmarks.go` | `sheet_bookmarks`, one row per person and sheet; `GET`, `PUT`, `DELETE /api/projects/{id}/bookmarks/{sheetId}` |
| `presentation/comments` | `CommentsSection` — the thread, Reply, and the box, shown only to someone who may comment |
| `presentation/bookmarks` | `useBookmarks`, `BookmarkStar`, `BookmarksMenu` (bookmarks and search) |

- **A comment is a change record**, so it needs no table of its own, appears
  in the task's history, follows a task placed from off a sheet (same id), and
  is checked by the same role rule as every write: anyone on the project.
- **Two slots, added for this phase** rather than editing the panels each time
  something new belongs in them: `PropertiesPanel` renders `children` after the
  item details, and `Toolbar` renders `sheetExtras` after the sheet picker.
  The comments and the star arrive through them from `SheetViewer` and
  `App.jsx`.
- **A bookmark is the sheet id** (`p1:A-set.pdf#3`), so it needs no copy of the
  sheet's name: the menu names it with the project's sheet names at the time
  it is shown.

`npm run verify -- comments-bookmarks` and `go test` (`comments_test.go`,
`bookmarks_test.go`).

## Staying current

With a team on one server, the open sheet is re-read — markups, who last
touched them, seals — when the person comes back to the tab and when they open
the same drawing again; the punch list re-reads the same way, and the session
re-checks who they are and their role. Never in the middle of a gesture.

## Checks on every pull request (SCRUM-37)

`.github/workflows/checks.yml` runs the app's `verify`, `lint` and `build`, and
the server's `go vet` and `go test -race` against a Postgres 17 service. In CI an
unreachable test database fails the run (`REQUIRE_TEST_DATABASE`) instead of
skipping every test.

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
                               RoleEditPolicy (server mode)
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
                               ChangeLogRepository, MediaStore,
                               AccountRepository, ProjectRepository,
                               WorkingCopyReader, UploadLedger,
                               DrawingLibrary, SheetNameRepository,
                               SheetNameDetector, TaskRepository,
                               CommentRepository, BookmarkRepository — all
                               CONTRACTS
    documents/                 sheetNames — how a sheet is named, and read back
    tasks/                     the Tasks tab's rows, sorts, groups and CSV
    comments/                  Comment, threadsOf — a task's conversation
    sheets/                    SheetName, SheetNames, findSheetName — what a
                               sheet is called, read from its title block;
                               searchSheets — finding one by its number
    punchlist/                 the schedule (PunchListRegistry, ordinals) and
                               the on-screen list (TaskList), sharing numbers
    upload/                    browser work reaching the server: markups,
                               history, exports (BrowserUploadService) and
                               photos (UploadingMediaStore)
    projects/                  SheetScope (a sheet's project, in its id),
                               Project, Member, ProjectRole
    library/                   LibraryDrawing, who may change a project's
                               drawings and which opened ones belong there
    services/                  AnnotationService (the tap->PdfPoint rule),
                               EditorService (the ONLY writer),
                               ExportService

  infrastructure/              TIER 3 — implements the contracts
    pdf/                       drawing a page and reading title blocks — the
                               ONLY two files importing pdfjs-dist are here
    export/                    pdf-lib exporter + 6 annotation writers
    persistence/               InMemory | LocalStorage | Http, plus the
                               export-history and change-log repositories
    identity/                  CryptoIdGenerator,
                               SessionIdentityProvider (server mode)
    auth/                      HttpAccountRepository, HttpProjectRepository
    media/                     IndexedDbMediaStore, HttpMediaStore,
                               CanvasImageProcessor
    library/                   HttpDrawingLibrary — a project's drawings
    sheets/                    HttpSheetNameRepository — a project's sheet names
    tasks/                     HttpTaskRepository — locks, last changes, history
    comments/                  HttpCommentRepository — a task's comments, counts
    bookmarks/                 HttpBookmarkRepository — a person's starred sheets

  presentation/                TIER 1 — React
    ServiceContainer.jsx       COMPOSITION ROOT — the only wiring file
    session/                   sign-in, project choice, people, account menu
    hooks/                     document / view state / annotations / drawing / export
    gestures/                  pinch-zoom and two-finger pan (SCRUM-48)
    tools/                     which tool is on after a markup (ToolLatch) and
                               the keys that pick tools (ToolShortcutRegistry)
    sheets/                    sheet names: loading, reading, renaming
    tasks/                     the Tasks tab: list, panel, new task, bulk edit
    comments/                  CommentsSection — the thread under a task
    bookmarks/                 the star, the Bookmarks menu and sheet search
    punchlist/                 the punch list view and its loader
    library/                   the project's drawings: the list, the top-bar
                               dialog, opening from disk or from the server
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
  verify-all.mjs               npm run verify — runs every verify-*.mjs (23
                               suites); `npm run verify -- photos` runs one
  verify-*.mjs                 one suite per behaviour, no framework

backend/
  main.go, history.go          markups, change history, exports
  auth.go, projects.go         accounts and sessions; projects, members, roles
  access.go                    the role check wrapped around every route
  media.go                     photos
  sheet_names.go               what each sheet is called
  tasks.go                     the Tasks tab's project-wide reads
  comments.go, bookmarks.go    checking comments, counting them; starred sheets
  *_schema.sql                 applied at startup (schema.sql is the base)
  *_test.go                    integration tests against punchlist_test
```

## A note on editor support

Every public method carries JSDoc `@param` / `@returns`. That is plain
JavaScript — comments only, no build step — but VS Code reads it and gives you
autocomplete and parameter hints as if the code were typed.

If the team ever wants type *checking* without adopting TypeScript, add a
`jsconfig.json` with `"checkJs": true`. Entirely optional and reversible.
