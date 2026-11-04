# Phase 1 — Tools and sheet names Implementation Plan

**Goal:** Every drawing tool returns to Select after one use (lockable, with
shortcuts), and sheets are named from their title blocks (A-101 · LEVEL 1
FLOOR PLAN) everywhere a sheet is named.

**Architecture:** Tool behaviour is a pure `ToolLatch` plus a
`ToolShortcutRegistry` in `presentation/tools/`, fed by one new value the
editor hook reports (`created`). Sheet naming is a pure `findSheetName`
heuristic and `SheetNames` collection in `domain/sheets/`, a pdf.js detector
and an HTTP repository behind two new ports, a `sheet_names` table with two
endpoints, and a `useSheetNames` hook that labels the picker, the punch list
and the issued schedule.

**Tech Stack:** React 19, plain JavaScript ES modules, pdf.js (`pdfjs-dist`
6), pdf-lib; Go 1.27 `net/http` + pgx; PostgreSQL 17.

**Spec:** `docs/design/2026-11-04-fieldwire-tasks-design.md`
(sections 4, 5.1, 5.2).

## Global Constraints

- Tiers (docs/ARCHITECTURE.md): presentation imports domain only; domain imports
  nothing; infrastructure extends domain ports; `ServiceContainer.jsx` is the
  only file importing infrastructure.
- Existing files may change only where spec section 4 names them. Each
  change adds the seam, not the feature.
- No `switch`/if-chain on tool id or annotation kind outside a registry.
- JSDoc on public methods and component props; comments explain why, in the
  voice of the neighbouring files.
- New pure behaviour gets a `web/scripts/verify-*.mjs` suite (picked up
  automatically by `scripts/verify-all.mjs`).
- Commits: author `Saumya <saumyapatel566@gmail.com>`.
- Branch `feat/fieldwire-1-tools-and-sheet-names`; the PR targets `main`.
- Tool ids: `select`, `pin`, `rectangle`, `cloud`, `arrow`, `ink`, `text`,
  `photo`. Shortcuts: V, P, B, C, A, D, T, I respectively.
- Long-press to lock a tool: 500 ms, touch pointers only.
- Fallback label: `Sheet ${pageIndex + 1}`. Label separator: `' · '`
  (space, U+00B7, space). Titles are kept as printed.
- Sheet number at most 40 characters, title at most 120 (counted in
  characters, after trimming and collapsing whitespace).
- Detected names are saved by admins and power collaborators and fill only
  missing pages; edited names are admin-only and replace.

## Review Focus

1. **Cancelled placement** — dismissing the pin's description prompt must
   leave the Pin tool active, not jump to Select. (Task 2, browser step.)
2. **Shortcuts while typing** — pressing P in a description or the rename
   dialog types a P; it never switches tools. (Task 3, test.)
3. **Shortcut for a forbidden tool** — a collaborator pressing B gets nothing,
   not a Box tool every tap of which is refused. (Task 3, test.)
4. **Look-alikes on the sheet** — grid bubbles (A, 6), room numbers (101),
   dimensions (23'-4"), dates and a "SEE A-501" note are never taken for the
   sheet number. (Task 4, test.)
5. **An admin's rename survives** — another device re-detecting the drawing
   must not overwrite it. (Task 4 and Task 5, tests.)

---

### Task 1: The tool latch rules

**Files:**
- Create: `web/src/presentation/tools/ToolLatch.js`
- Test: `web/scripts/verify-tool-latch.mjs`

**Interfaces:**
- Produces (all return frozen objects; `defaultToolId` is
  `ToolRegistry.default().getId()`):
  - `pressTool(latch, toolId) → { toolId, lockedToolId: null }`
  - `holdTool(latch, toolId) → { toolId, lockedToolId: toolId }`
  - `afterCreate(latch, defaultToolId) → { toolId, lockedToolId, selectCreated: boolean }`
  - `escapeTool(latch, defaultToolId) → { toolId: defaultToolId, lockedToolId: null }`
  - where `latch = { toolId: string, lockedToolId: string|null }` and
    `toolId` is the tool active now.

- [ ] **Step 1: Write the failing tests** in `verify-tool-latch.mjs`, in the
  `check(name, fn)` / PASS-FAIL runner style of `verify-save-sequence.mjs`:

```js
check('pressing a tool picks it, unlocked', () =>
  assert.deepEqual(pressTool({ toolId: 'select', lockedToolId: null }, 'pin'), { toolId: 'pin', lockedToolId: null }));
check('pressing the locked tool again releases the lock and keeps the tool', () =>
  assert.deepEqual(pressTool({ toolId: 'pin', lockedToolId: 'pin' }, 'pin'), { toolId: 'pin', lockedToolId: null }));
check('holding a tool locks it', () =>
  assert.deepEqual(holdTool({ toolId: 'select', lockedToolId: null }, 'rectangle'), { toolId: 'rectangle', lockedToolId: 'rectangle' }));
check('after a create, an unlocked tool returns to Select and the new markup is selected', () =>
  assert.deepEqual(afterCreate({ toolId: 'pin', lockedToolId: null }, 'select'), { toolId: 'select', lockedToolId: null, selectCreated: true }));
check('after a create, a locked tool stays on and nothing is selected', () =>
  assert.deepEqual(afterCreate({ toolId: 'pin', lockedToolId: 'pin' }, 'select'), { toolId: 'pin', lockedToolId: 'pin', selectCreated: false }));
check('a lock on another tool does not keep this one', () =>
  assert.deepEqual(afterCreate({ toolId: 'cloud', lockedToolId: 'pin' }, 'select'), { toolId: 'select', lockedToolId: null, selectCreated: true }));
check('Escape returns to Select and releases any lock', () =>
  assert.deepEqual(escapeTool({ toolId: 'pin', lockedToolId: 'pin' }, 'select'), { toolId: 'select', lockedToolId: null }));
check('every answer is frozen', () =>
  assert.ok(Object.isFrozen(pressTool({ toolId: 'select', lockedToolId: null }, 'pin'))));
```

- [ ] **Step 2: Run to see it fail**

Run: `cd web && npm run verify -- tool-latch`
Expected: FAIL — cannot find module `../src/presentation/tools/ToolLatch.js`.

- [ ] **Step 3: Implement the four functions** in `ToolLatch.js` as pure
  functions with a header comment on why tools are one-shot (Fieldwire opens
  the new task; a field user places one thing, then looks at it).

- [ ] **Step 4: Run to see it pass** — same command, expected `8/8 tool
  latch checks passed.`

- [ ] **Step 5: Commit** — `feat: tools return to Select after one use (rules)`

---

### Task 2: One-shot tools on the sheet

**Files:**
- Modify: `web/src/presentation/hooks/useSheetEditor.js` (state near line 71;
  the two `await editor.add(finalized)` calls in `begin` and `finish`; the
  returned object)
- Create: `web/src/presentation/tools/useToolLatch.js`
- Create: `web/src/presentation/tools/tools.css`
- Modify: `web/src/presentation/components/ToolPalette.jsx` (tool buttons,
  lines ~120-140)
- Modify: `web/src/presentation/components/SheetViewer.jsx` (ToolPalette
  props; Escape branch of the keydown handler)

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  - `useSheetEditor(...)` returns `created: { id: string, seq: number } | null`
    — set (seq + 1) right after a markup this person drew is saved; never
    set by undo, redo, moves or edits.
  - `useToolLatch(editor) → { lockedToolId: string|null, press(toolId), hold(toolId), escape() }`
    — `press`/`hold`/`escape` call `editor.selectTool`; an effect on
    `editor.created` applies `afterCreate` and, when `selectCreated`, calls
    `editor.selectSoon(created.id)`. `escape()` also calls `editor.select(null)`.
  - `ToolPalette` new props: `lockedToolId`, `onLockTool(toolId)`,
    `shortcutFor(toolId) → string|null` (Task 3 supplies it; default
    `() => null`).

- [ ] **Step 1: Report creations from the editor.** In `useSheetEditor`, add
  `const [created, setCreated] = useState(null);`, after each
  `await editor.add(finalized)` add
  `setCreated((last) => ({ id: finalized.id, seq: (last?.seq ?? 0) + 1 }));`,
  and return `created`. Comment: the latch, not this hook, decides what
  happens next.

- [ ] **Step 2: Write `useToolLatch`** with the interface above. Keep
  `lockedToolId` in `useState`; read the active tool from `editor.toolId`
  so the editor stays the one owner of which tool is on (a role may override
  it). Ignore a `created` whose `seq` was already handled (ref).

- [ ] **Step 3: Lock from the rail.** In `ToolPalette`, each tool button
  gets `onDoubleClick={() => onLockTool(id)}`; for `pointerType === 'touch'`,
  `onPointerDown` starts a 500 ms timer that calls `onLockTool(id)` and
  swallows the following click; `onPointerUp`/`onPointerLeave` clear it.
  When `id === lockedToolId` render `<Icon name="lock" size={12} />` inside
  the button with class `tool-lock`. Title:
  `${label}${key ? ` (${key})` : ''}${isSelection ? '' : ' — double-click to keep it on'}`.
  `tools.css` (imported by `ToolPalette.jsx`) positions `.tool-lock` in the
  button's top-right corner and makes `.tool` `position: relative`.

- [ ] **Step 4: Wire it in `SheetViewer`.** `const latch = useToolLatch(editor);`
  then pass `onSelectTool={latch.press}`, `onLockTool={latch.hold}`,
  `lockedToolId={latch.lockedToolId}`; replace the Escape line with
  `latch.escape()`.

- [ ] **Step 5: Lint and existing suites.** Run: `cd web && npm run lint && npm run verify`
  Expected: lint exit 0 (no new warnings in the touched files); all suites pass.

- [ ] **Step 6: Check it in the browser.** Start the API (`cd backend && go run .`)
  and the app (`cd web && npm run dev`); sign in as the local test admin;
  open the sample drawing. Expect:
  1. Pin → tap → type a description → Add pin: the rail shows Select active
     and the new pin's details are open.
  2. Pin → tap → Cancel: Pin is still active (Review Focus 1).
  3. Double-click Box: a lock badge; draw two boxes; Box stays active and
     neither box is selected.
  4. Escape: Select is active, badge gone, nothing selected.
  5. As the local test collaborator: the rail still shows only Select and
     Photo; Photo returns to Select after the photo is placed.

- [ ] **Step 7: Commit** — `feat: return to Select after placing a markup, double-click to keep a tool`

---

### Task 3: Tool shortcuts

**Files:**
- Create: `web/src/presentation/tools/ToolShortcutRegistry.js`
- Create: `web/src/presentation/tools/shortcutTarget.js`
- Create: `web/src/presentation/tools/useToolShortcuts.js`
- Create: `web/src/presentation/tools/index.js`
- Modify: `web/src/App.jsx` (one import line beside `./presentation/components/markers`)
- Modify: `web/src/presentation/components/SheetViewer.jsx` (one hook call;
  `shortcutFor` prop)
- Test: `web/scripts/verify-tool-latch.mjs` (second section)

**Interfaces:**
- Consumes: `useToolLatch` (Task 2), `ToolRegistry.resolve`, `editor.canUseTool`.
- Produces:
  - `ToolShortcutRegistry.register(toolId: string, key: string)`,
    `.keyFor(toolId) → string|null` (upper case), `.toolFor(key) → string|null`
    (case-insensitive). Duplicate registration: warn in dev, throw in a
    production build — the same split as `ToolRegistry`.
  - `shortcutTarget(event, { isAvailable: (toolId) => boolean }) → string|null`
    where `event` is `{ key, ctrlKey, metaKey, altKey, target }`.
  - `useToolShortcuts({ editor, latch })` — document keydown listener; on a
    non-null `shortcutTarget`, `preventDefault()` and `latch.press(toolId)`.
  - `presentation/tools/index.js` registers V select, P pin, B rectangle,
    C cloud, A arrow, D ink, T text, I photo, and re-exports the module's
    public names. It imports no CSS (the verify suites load it in Node).

- [ ] **Step 1: Write the failing tests** (second section of
  `verify-tool-latch.mjs`, importing `../src/presentation/tools/index.js`):

```js
check('V P B C A D T I pick their tools', () => {
  const expected = { v: 'select', p: 'pin', b: 'rectangle', c: 'cloud', a: 'arrow', d: 'ink', t: 'text', i: 'photo' };
  for (const [key, tool] of Object.entries(expected)) assert.equal(ToolShortcutRegistry.toolFor(key), tool, key);
  assert.equal(ToolShortcutRegistry.keyFor('ink'), 'D');
});
const any = { isAvailable: () => true };
check('a shortcut is ignored while typing', () => {
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }])
    assert.equal(shortcutTarget({ key: 'p', target }, any), null, target.tagName);
});
check('Ctrl, Cmd or Alt with a letter is not a tool', () => {
  assert.equal(shortcutTarget({ key: 'c', ctrlKey: true, target: { tagName: 'BODY' } }, any), null);
  assert.equal(shortcutTarget({ key: 'c', metaKey: true, target: { tagName: 'BODY' } }, any), null);
  assert.equal(shortcutTarget({ key: 'c', altKey: true, target: { tagName: 'BODY' } }, any), null);
});
check('a tool the role cannot use is not picked', () => {
  const collaborator = { isAvailable: (id) => id === 'select' || id === 'photo' };
  assert.equal(shortcutTarget({ key: 'b', target: { tagName: 'BODY' } }, collaborator), null);
  assert.equal(shortcutTarget({ key: 'I', target: { tagName: 'BODY' } }, collaborator), 'photo');
});
check('an unregistered key picks nothing', () =>
  assert.equal(shortcutTarget({ key: 'x', target: { tagName: 'BODY' } }, any), null));
```

- [ ] **Step 2: Run to see it fail** — `npm run verify -- tool-latch`;
  expected FAIL on the missing `presentation/tools/index.js`.

- [ ] **Step 3: Implement** the registry, `shortcutTarget` and the barrel.

- [ ] **Step 4: Run to see it pass** — expected `13/13 tool latch checks passed.`

- [ ] **Step 5: Wire it.** `import './presentation/tools';` in `App.jsx`;
  in `SheetViewer`, `useToolShortcuts({ editor, latch });` and
  `shortcutFor={(id) => ToolShortcutRegistry.keyFor(id)}` on `ToolPalette`.
  `isAvailable` is `(id) => editor.canUseTool(ToolRegistry.resolve(id))`.

- [ ] **Step 6: Browser check.** P arms Pin; typing "P" inside the pin's
  description types a P; B as the collaborator does nothing; tooltips read
  "Box (B) — double-click to keep it on".

- [ ] **Step 7: Commit** — `feat: keyboard shortcuts for every tool`

---

### Task 4: Naming a sheet from its title block (domain)

**Files:**
- Create: `web/src/domain/sheets/SheetName.js`
- Create: `web/src/domain/sheets/SheetNames.js`
- Create: `web/src/domain/sheets/findSheetName.js`
- Create: `web/src/domain/sheets/index.js`
- Test: `web/scripts/verify-sheet-names.mjs`

**Interfaces:**
- Produces:
  - `class SheetName` — `static SOURCE = { DETECTED: 'detected', EDITED: 'edited' }`,
    `static MAX_NUMBER = 40`, `static MAX_TITLE = 120`;
    `constructor({ pageIndex, number = '', title = '', source = 'detected' })`
    trims, collapses whitespace, cuts to the maxima, throws `TypeError` for a
    pageIndex that is not a non-negative integer or an unknown source;
    `get label()` → `'A-101 · LEVEL 1 FLOOR PLAN'`, `'A-101'`, a title alone,
    or `''`; `toJSON()`; `static fromJSON(json)`. Frozen.
  - `class SheetNames` — `constructor(names = [])`, `static EMPTY`,
    `nameFor(pageIndex) → SheetName|null`, `labelFor(pageIndex) → string`,
    `numberFor(pageIndex) → string` (both fall back to `Sheet N`),
    `missingPages(pageCount) → number[]` (an edited empty name is not
    missing), `withDetected(names) → SheetNames` (fills missing pages only;
    never replaces an edited or detected name), `withEdited(name) → SheetNames`,
    `toArray() → SheetName[]` (by page).
  - `findSheetName(items, page) → { number: string, title: string } | null`,
    with `items: { text, x, y, size }[]` in page-view coordinates (top-left
    origin, y grows downward, `x`/`y` the text's top-left, `size` its height)
    and `page: { width, height }`.

The heuristic is not determined by the signature; implement exactly this:

```text
DESIGNATOR   = /^[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/
NUMBER_LABEL = /^(SHEET|DWG|DRAWING)\.?\s*(NO\.?|NUMBER|#)$/i
TITLE_LABEL  = /^(SHEET|DRAWING)\s+TITLE$/i
1. Clean: trim, collapse whitespace, drop empty items.
2. Labelled number: for the first NUMBER_LABEL item L, candidates are
   DESIGNATOR items either below L (y > L.y and |x - L.x| <= L.size * 40)
   or on L's line to its right (|y - L.y| <= L.size and x > L.x). Take the
   nearest by (y - L.y, then x - L.x).
3. Labelled title: for the first TITLE_LABEL item T, the nearest item below
   or to the right by the same rule that is neither a label nor a
   DESIGNATOR; join it with items on its line (|y - v.y| <= v.size / 2),
   left to right, one space apart.
4. Unlabelled number (only when step 2 found none): DESIGNATOR items with
   x >= width * 2/3 and y >= height * 2/3; largest size, then largest y,
   then largest x.
5. Unlabelled title (only when step 3 found none and a number was found):
   items in that same region that are not labels or DESIGNATORs, contain a
   letter, equal their upper-case form, have length >= 4, and lie within
   number.size * 6 of the number vertically; largest size, then nearest the
   number.
6. No number → null. Otherwise { number, title: title ?? '' }.
```

- [ ] **Step 1: Write the failing tests.** Fixtures come from the sample
  drawing (`web/public/sample-drawing-set.pdf`, page 1, 2592 × 1728 pt),
  converted to top-left coordinates:

```js
const SAMPLE_PAGE = { width: 2592, height: 1728 };
const SAMPLE = [
  { text: 'SHEET TITLE', x: 2322, y: 1598, size: 6.5 },
  { text: 'LEVEL 1 FLOOR PLAN', x: 2322, y: 1610, size: 12 },
  { text: 'SHEET NUMBER', x: 2322, y: 1640, size: 6.5 },
  { text: 'A-101', x: 2322, y: 1654, size: 26 },
  // look-alikes the reader must step over (Review Focus 4)
  { text: 'A', x: 2009, y: 1341, size: 10 }, { text: '6', x: 1918, y: 1433, size: 10 },
  { text: '101', x: 640, y: 470, size: 8 }, { text: '23\'-4"', x: 1771, y: 1374, size: 7.5 },
  { text: '2026-09-24', x: 2322, y: 420, size: 6 }, { text: 'SEE A-501', x: 300, y: 200, size: 9 },
  { text: 'LEVEL 1 FLOOR PLAN', x: 66, y: 1640, size: 14 },
];
check('reads A-101 and LEVEL 1 FLOOR PLAN from a labelled title block', () =>
  assert.deepEqual(findSheetName(SAMPLE, SAMPLE_PAGE), { number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' }));
check('reads a number written to the right of its label', () =>
  assert.equal(findSheetName([{ text: 'SHEET NO.', x: 2300, y: 1600, size: 7 }, { text: 'E-101', x: 2360, y: 1598, size: 14 }], SAMPLE_PAGE).number, 'E-101'));
check('without labels, takes the largest designator in the bottom-right third', () =>
  assert.deepEqual(findSheetName([
    { text: 'M-201', x: 2400, y: 1650, size: 24 }, { text: 'S-1', x: 2400, y: 1700, size: 8 },
    { text: 'A-501', x: 300, y: 200, size: 10 }, { text: 'MECHANICAL PLAN', x: 2380, y: 1620, size: 12 },
  ], SAMPLE_PAGE), { number: 'M-201', title: 'MECHANICAL PLAN' }));
check('grid bubbles, room numbers, dimensions and dates are not sheet numbers', () =>
  assert.equal(findSheetName(SAMPLE.slice(4, 9), SAMPLE_PAGE), null));
check('a page with no title block has no name', () =>
  assert.equal(findSheetName([], SAMPLE_PAGE), null));
check('labels read "A-101 · LEVEL 1 FLOOR PLAN", or Sheet N when nothing is known', () => {
  const names = new SheetNames([new SheetName({ pageIndex: 0, number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' })]);
  assert.equal(names.labelFor(0), 'A-101 · LEVEL 1 FLOOR PLAN');
  assert.equal(names.numberFor(0), 'A-101');
  assert.equal(names.labelFor(2), 'Sheet 3');
  assert.equal(names.numberFor(2), 'Sheet 3');
});
check('an edited name survives a later detection (Review Focus 5)', () => {
  const edited = new SheetNames().withEdited(new SheetName({ pageIndex: 0, number: 'A-100', source: 'edited' }));
  const after = edited.withDetected([new SheetName({ pageIndex: 0, number: 'A-101' }), new SheetName({ pageIndex: 1, number: 'A-102' })]);
  assert.equal(after.numberFor(0), 'A-100');
  assert.equal(after.numberFor(1), 'A-102');
});
check('missing pages skip any stored name, even an edited empty one', () =>
  assert.deepEqual(new SheetNames([new SheetName({ pageIndex: 1, source: 'edited' })]).missingPages(3), [0, 2]));
check('names are tidied, capped and checked', () => {
  const name = new SheetName({ pageIndex: 0, number: '  A-101  ', title: 'LEVEL   1\nPLAN' });
  assert.equal(name.number, 'A-101'); assert.equal(name.title, 'LEVEL 1 PLAN');
  assert.equal(new SheetName({ pageIndex: 0, number: 'X'.repeat(50) }).number.length, 40);
  assert.throws(() => new SheetName({ pageIndex: -1 }), TypeError);
  assert.throws(() => new SheetName({ pageIndex: 0, source: 'guessed' }), TypeError);
  assert.deepEqual(SheetName.fromJSON(name.toJSON()), name);
});
```

- [ ] **Step 2: Run to see it fail** — `npm run verify -- sheet-names`;
  expected FAIL on the missing `domain/sheets/index.js`.

- [ ] **Step 3: Implement** the three classes/functions per the interfaces
  and the heuristic above.

- [ ] **Step 4: Run to see it pass** — expected `9/9 sheet name checks passed.`

- [ ] **Step 5: Commit** — `feat: read a sheet's number and title from its title block`

---

### Task 5: Sheet names on the server

**Files:**
- Create: `backend/sheet_names_schema.sql`
- Create: `backend/sheet_names.go`
- Create: `backend/sheet_names_test.go`
- Modify: `backend/main.go` (two route lines beside the documents routes)

**Interfaces:**
- Produces (HTTP):
  - `GET /api/projects/{projectID}/sheet-names` — any member → 200
    `{ "<drawing name>": [{ "pageIndex": 0, "number": "A-101", "title": "LEVEL 1 FLOOR PLAN", "source": "detected" }] }`
    (drawings without names are absent); non-member → 403.
  - `PUT /api/projects/{projectID}/sheet-names/{documentName}` — body
    `{ "source": "detected"|"edited", "names": [{ "pageIndex", "number", "title" }] }`
    → 200 with that drawing's names (array, by page).
    - unknown drawing → 404 `No drawing called <name> in this project.`
    - `detected`: admin or power collaborator, else 403 `deniedEdit`; inserts
      only pages without a row.
    - `edited`: admin only, else 403 `Only a project admin can rename a sheet.`;
      upserts with `source = 'edited'`.
    - 400 for an unknown source, `pageIndex < 0`, a number over 40 or a title
      over 120 characters, more than 2000 names, or a body over 256 KB.
- Schema (`registerSchema` from an `init()` in `sheet_names.go`, via `//go:embed`):

```sql
CREATE TABLE IF NOT EXISTS sheet_names (
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index  INT NOT NULL CHECK (page_index >= 0),
  number      TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL CHECK (source IN ('detected', 'edited')),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, page_index)
);
```

- [ ] **Step 1: Write the failing tests** in `sheet_names_test.go`, using
  `newTeam`, `addDrawing`, `pdfBytes`, `expect` and `browser.call`, with
  `sheetNamesPath(project int, name string)` built with `url.PathEscape`.
  The drawing is named `A-101 Ground floor #2.pdf` so spaces and `#` are
  exercised:
  - `TestSheetNamesTravelWithTheDrawing` — power PUTs detected
    `{0, A-101, LEVEL 1 FLOOR PLAN}` → 200; collaborator GETs → the drawing
    maps to that one name with source `detected`.
  - `TestDetectionNeverOverwritesANameAndARenameAlwaysDoes` — a second
    detected PUT with `A-999` leaves `A-101`; admin edited `A-100` → `A-100`,
    source `edited`; a detected PUT after it still reads `A-100`.
  - `TestWhoMaySaveSheetNames` — collaborator detected → 403; power edited →
    403; outsider GET → 403; admin edited → 200.
  - `TestSheetNamesForAnUnknownDrawingAre404`.
  - `TestSheetNamesAreChecked` — source `guessed` → 400; pageIndex −1 → 400;
    41-character number → 400.
  - `TestRemovingADrawingRemovesItsNames` — admin DELETEs the drawing; the
    GET no longer lists it.

- [ ] **Step 2: Run to see them fail** — `cd backend && go test -race -run SheetName ./...`;
  expected FAIL (404s from the unregistered routes).

- [ ] **Step 3: Implement** the schema file, the two handlers (`signedIn`,
  `projectIDParam`, `memberOf`, `readBody`, `jsonError`, `writeJSON`,
  `dbError`; look the drawing up by `(project_id, name)`), and the two
  `mux.HandleFunc` lines.

- [ ] **Step 4: Run to see them pass** — same command, then the whole
  suite: `go vet ./... && go test -race ./...`; expected `ok`.

- [ ] **Step 5: Commit** — `feat: keep sheet names with each drawing on the server`

---

### Task 6: Adapters — reading PDFs and talking to the server

**Files:**
- Create: `web/src/domain/ports/SheetNameRepository.js`
- Create: `web/src/domain/ports/SheetNameDetector.js`
- Create: `web/src/infrastructure/sheets/HttpSheetNameRepository.js`
- Create: `web/src/infrastructure/pdf/sheetTextItems.js`
- Create: `web/src/infrastructure/pdf/PdfJsSheetNameDetector.js`
- Modify: `web/src/presentation/ServiceContainer.jsx` (two wiring lines)
- Test: `web/scripts/verify-sheet-names.mjs` (adapter section)

**Interfaces:**
- Consumes: Task 4 (`SheetName`, `SheetNames`, `findSheetName`), Task 5's HTTP
  contract, `HttpJsonClient` (`getJson`, `sendJson`, `segment`).
- Produces:
  - Port `SheetNameRepository` (`static REQUIRED = ['listForProject', 'save']`):
    `listForProject(projectId) → Promise<Map<string, SheetNames>>`;
    `save(projectId, documentName, { source, names: SheetName[] }) → Promise<SheetNames>`.
  - Port `SheetNameDetector` (`static REQUIRED = ['detect']`):
    `detect(bytes: ArrayBuffer, { signal }?) → Promise<SheetName[]>`.
  - `toSheetTextItems(items: { str: string, transform: number[] }[], viewportTransform: number[]) → { text, x, y, size }[]`
    — multiplies `viewportTransform × item.transform`; `x = m[4]`,
    `size = Math.hypot(m[2], m[3])`, `y = m[5] - size` (baseline to top).
  - `PdfJsSheetNameDetector.detect` — loads the bytes with
    `pdfjs.getDocument({ data })` (worker set exactly as in
    `PdfJsDocumentSource.js`), and for each page: `getViewport({ scale: 1 })`,
    `getTextContent()`, `toSheetTextItems`, `findSheetName`; yields to the
    event loop (`setTimeout 0`) between pages; stops when `signal.aborted`;
    destroys the document at the end.
  - `ServiceContainer` exposes `sheetNames` (`HttpSheetNameRepository` in
    server mode, else `null`) and `sheetNameDetector`.

- [ ] **Step 1: Write the failing tests:**

```js
check('pdf.js positions become top-left page positions on an upright page', () =>
  assert.deepEqual(toSheetTextItems([{ str: 'A-101', transform: [26, 0, 0, 26, 2322, 48] }], [1, 0, 0, -1, 0, 1728]),
    [{ text: 'A-101', x: 2322, y: 1654, size: 26 }]));
check('…and on a page turned 90 degrees', () => {
  const [item] = toSheetTextItems([{ str: 'A-101', transform: [26, 0, 0, 26, 2322, 48] }], [0, 1, 1, 0, 0, 0]);
  assert.equal(item.x, 48); assert.equal(item.size, 26);
});
check('the HTTP adapter reads every drawing and saves one', async () => {
  // fake fetch in the style of verify-http-repositories.mjs; record method + URL + body
  const repo = new HttpSheetNameRepository('/api', fake);
  const all = await repo.listForProject(7);
  assert.equal(all.get('A-101 #2.pdf').numberFor(0), 'A-101');
  await repo.save(7, 'A-101 #2.pdf', { source: 'detected', names: [new SheetName({ pageIndex: 1, number: 'A-102' })] });
  assert.equal(requests.at(-1), 'PUT /api/projects/7/sheet-names/A-101%20%232.pdf');
  assert.deepEqual(bodies.at(-1), { source: 'detected', names: [{ pageIndex: 1, number: 'A-102', title: '' }] });
});
```

- [ ] **Step 2: Run to see them fail** — `npm run verify -- sheet-names`.

- [ ] **Step 3: Implement** the ports, the helper, the repository, the
  detector and the two wiring lines.

- [ ] **Step 4: Run to see them pass** — expected `12/12 sheet name checks passed.`;
  then `npm run build` succeeds (the detector's worker import resolves).

- [ ] **Step 5: Commit** — `feat: detect sheet names with pdf.js and store them through the API`

---

### Task 7: Sheet names on screen

**Files:**
- Create: `web/src/presentation/sheets/useSheetNames.js`
- Create: `web/src/presentation/sheets/RenameSheetDialog.jsx`
- Modify: `web/src/presentation/components/Icon.jsx` (add `edit`, a pencil)
- Modify: `web/src/presentation/components/Toolbar.jsx` (picker options,
  rename button)
- Modify: `web/src/App.jsx` (hook call, props, dialog)
- Modify: `web/src/presentation/components/SheetViewer.jsx` (pass
  `sheetNumberFor` through to `PunchListPanel`)
- Modify: `web/src/presentation/punchlist/PunchListPanel.jsx` (line ~48:
  `buildTaskList` context; line ~162: print `item.sheetLabel`)
- Modify: `web/src/domain/punchlist/TaskList.js` (`buildTaskList` context and
  `itemFrom`; `TaskListItem` gains `sheetLabel`)
- Test: `web/scripts/verify-sheet-names.mjs` (task list check)

**Interfaces:**
- Consumes: Tasks 4 and 6; `useServices()` (`sheetNames`,
  `sheetNameDetector`); `useSession()` (`project.id`, `project.role`).
- Produces:
  - `useSheetNames({ documentName, sourceFile, pageCount }) → { labelFor(pageIndex), numberFor(documentName, pageIndex), nameFor(pageIndex), canRename, rename(pageIndex, { number, title }) }`.
    Loads every drawing's names when the project opens. When the open
    drawing has missing pages and the person is an admin or power
    collaborator (or in browser mode), detects once per drawing per session
    from `sourceFile`, then saves `source: 'detected'` for the missing pages
    only (browser mode keeps them in state). `canRename` is
    `project.role === 'admin'` in server mode. Failures are logged with
    `console.warn` and never stop the drawing from opening.
  - `RenameSheetDialog({ name, pageIndex, onSave({ number, title }), onCancel })`
    — "Sheet number" and "Sheet title" inputs, `maxLength` 40 and 120, Save
    and Cancel, styled like `PromptDialog`.
  - `Toolbar` new props: `sheetLabelFor(pageIndex) → string` (default
    `` (i) => `Sheet ${i + 1}` ``) and `onRenameSheet` (button shown only when
    given, title "Rename sheet", icon `edit`). Option text: the label, or
    `Sheet ${i + 1} of ${pageCount}` when the label is the fallback.
  - `buildTaskList(annotations, { today, openDocument, sheetLabelFor })` —
    `sheetLabelFor(documentName, pageIndex)` defaults to `Sheet N`; every
    item carries `sheetLabel`.

- [ ] **Step 1: Write the failing test:**

```js
check('punch list items carry the sheet number they are given, or Sheet N', () => {
  const groups = buildTaskList([pinOnPage(0), pinOnPage(1)], {
    today, openDocument: 'set.pdf', sheetLabelFor: (doc, page) => (page === 0 ? 'A-101' : `Sheet ${page + 1}`),
  });
  assert.deepEqual(groups[0].items.map((item) => item.sheetLabel), ['A-101', 'Sheet 2']);
});
```
(`pinOnPage(n)` builds a `Pin` on `set.pdf#n` the way `verify-task-list.mjs`
does; `today` is `CalendarDate.fromLocalDate(new Date(2026, 10, 4))`.)

- [ ] **Step 2: Run to see it fail**, implement the `TaskList` change, run to
  see it pass — `npm run verify -- sheet-names` → `13/13`.

- [ ] **Step 3: Build the hook, dialog, icon and Toolbar changes, and wire
  them in `App.jsx`, `SheetViewer` and `PunchListPanel`.**

- [ ] **Step 4: Lint, verify, build.** `npm run lint && npm run verify && npm run build`.

- [ ] **Step 5: Browser check** (admin, then power collaborator, then
  collaborator, on the sample drawing):
  1. The picker reads `A-101 · LEVEL 1 FLOOR PLAN`, `A-102 · LEVEL 2 FLOOR PLAN`,
     `A-201 · EXTERIOR ELEVATIONS`, `A-601 · DOOR SCHEDULE`.
  2. Admin: Rename → `A-100` / `GROUND FLOOR` → the picker updates; a reload
     keeps it; the collaborator sees it.
  3. The punch list rows read `A-101 · Open · …`.
  4. A drawing whose names were never stored shows `Sheet N of M` to a
     collaborator until an admin or power collaborator opens it.

- [ ] **Step 6: Commit** — `feat: show sheet numbers and titles; admins can rename a sheet`

---

### Task 8: Sheet numbers in the issued PDF

**Files:**
- Modify: `web/src/domain/punchlist/PunchListEntry.js` (constructor field
  `sheetName`, `sheetLabel` getter, `withSheetLabel`)
- Modify: `web/src/domain/punchlist/PunchListRegistry.js` (`collect`)
- Modify: `web/src/domain/services/ExportService.js` (`exportDocument`)
- Modify: `web/src/presentation/hooks/useExport.js` (`exportDocument`)
- Modify: `web/src/App.jsx` (`runExport`)
- Test: `web/scripts/verify-sheet-names.mjs` (schedule section)

**Interfaces:**
- Consumes: `useSheetNames().numberFor` (Task 7).
- Produces:
  - `new PunchListEntry({ …, sheetName = '' })`; `entry.sheetLabel` →
    `sheetName` or `Sheet N`; `entry.withSheetLabel(label) → PunchListEntry`
    (same fields, new label, frozen).
  - `PunchListRegistry.collect(pages, ordinals)` — a page may carry
    `sheetLabel: string`; its entries take it.
  - `ExportService.exportDocument({ …, sheetLabelFor })` — optional
    `(pageIndex) => string`; each `pages` entry gets `sheetLabel`.
  - `useExport().exportDocument({ …, sheetLabelFor })` passes it on;
    `runExport` in `App.jsx` supplies
    `(index) => sheetNames.numberFor(documentName, index)`.

- [ ] **Step 1: Write the failing tests:**

```js
check('the schedule prints the sheet number it is given, and Sheet N without one', () => {
  const entries = PunchListRegistry.collect([
    { pageIndex: 0, annotations: [pinOnPage(0)], sheetLabel: 'A-101' },
    { pageIndex: 1, annotations: [pinOnPage(1)] },
  ]);
  assert.deepEqual(entries.map((entry) => entry.sheetLabel), ['A-101', 'Sheet 2']);
});
check('a relabelled entry keeps everything else', () => {
  const [entry] = PunchListRegistry.collect([{ pageIndex: 0, annotations: [pinOnPage(0)] }]);
  const relabelled = entry.withSheetLabel('A-101');
  assert.equal(relabelled.number, entry.number);
  assert.equal(relabelled.description, entry.description);
  assert.deepEqual(relabelled.details, entry.details);
  assert.ok(Object.isFrozen(relabelled));
});
```

- [ ] **Step 2: Run to see them fail**, implement, run to see them pass —
  `npm run verify -- sheet-names` → `15/15`; then `npm run verify` (all
  suites, including `schedule-details` and `punchlist`, still pass).

- [ ] **Step 3: Browser check.** Issue the sample drawing locally, open the
  downloaded PDF's last page with `pymupdf`, and confirm the Sheet column
  reads `A-101`.

- [ ] **Step 4: Commit** — `feat: issued punch lists name sheets by number`

---

### Task 9: Docs, full checks, pull request

**Files:**
- Modify: `docs/PROGRESS.md` (status rows "Select by default, one-shot tools"
  and "Sheet numbers from the title block"; a session log entry; Last updated)
- Modify: `docs/ARCHITECTURE.md` (the `presentation/tools` seam, the
  `domain/sheets` module and ports, the `sheet_names` table; suite count)
- Modify: `docs/DEMO.md` (sheet names appear on opening; one-tap placement)

- [ ] **Step 1: Update the three docs** in the voice of the existing entries.

- [ ] **Step 2: Run every check.** From `web/`:
  `npm run verify && npm run lint && npm run build`; from `backend/`:
  `go vet ./... && go test -race ./...`. Expected: every suite passes, lint
  exit 0, build succeeds, `ok`.

- [ ] **Step 3: Full browser pass** at desktop (1470 × 801), iPad (768 × 1024)
  and phone (375 × 812) widths, with the admin, power collaborator and
  collaborator test accounts: the Task 2, 3, 7 and 8 checks again.

- [ ] **Step 4: Commit the docs** — `docs: phase 1 of the Fieldwire release in the progress log`

- [ ] **Step 5: Push and open the PR** —
  `git push -u origin feat/fieldwire-1-tools-and-sheet-names`, then
  `gh pr create --base main` with a summary of what changed, the
  existing-file edits from spec section 4, and how each part was verified.
