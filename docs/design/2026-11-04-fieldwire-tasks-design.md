# Fieldwire-style tasks — design

**Date:** 2026-11-04 · **Status:** draft for review · **Sprint:** 3
**Owners:** Saumya (frontend), Fawaz (backend), Joey (testing)

## 1. Why

The stakeholders named Fieldwire as the model for tasks (REQUIREMENTS D12). At
the end of Sprint 2 they asked for five things, and the team chose four extras
from the SRS to go with them. The goal is a demo that feels like Fieldwire on a
construction site: fewer taps to find a sheet, a task or the right tool, and a
safe way back from mistakes.

**Success means**, on the live site, with the sample drawing set:

1. Placing a pin leaves the app on Select with the new item open; no trip to
   the tool rail.
2. Sheets read "A-101 · LEVEL 1 FLOOR PLAN" (as printed on the drawing), not
   "Sheet 1".
3. A Tasks tab lists every task in the project, sorted or grouped by sheet,
   filterable, with priority, history, bulk edit and CSV export. A task can be
   created on a sheet or off a sheet.
4. Anyone on the project can comment on a task and reply to a comment.
5. A starred sheet is one tap away from anywhere in the project.
6. An admin or power collaborator can send a task back with a reason; an admin
   can restore a deleted task and un-issue a PDF issued by mistake.

## 2. What was asked, and what we decided

| Asked for | Decision |
|---|---|
| A separate Tasks tab, like Fieldwire, that looks neat | A "Sheets / Tasks" switch in the top bar swaps the main area for a full task list with a detail drawer. The side panel's punch list stays. |
| Create tasks on a sheet or off a sheet | Both. Off-sheet tasks are numbered G-1, G-2…, can be placed on a sheet later, and are not part of any drawing's issued PDF. |
| Sort tasks by sheet | Sort and group by sheet (set order), plus status, priority, due date, number and last updated. |
| Bookmark sheets | A star on the sheet picker and a Bookmarks menu. Personal, saved on the server, across every drawing in the project. |
| Authorized users can reverse the workflow after accidents | Send a task back with a reason (admin, power collaborator). Restore deleted tasks and un-issue a PDF (admin). |
| Select should be the default tool | Every tool returns to Select after one use, with the new item selected. Double-click (or long-press) a tool to keep it on. Keyboard shortcuts. |
| Priority (team choice) | High / Medium / Low field, Fieldwire-style colour chip. Statuses stay Open → Ready for review → Closed (D3). |
| Comments and replies (FR-11) | Threads on every task, open to collaborators, kept in the change history. |
| Real sheet numbers (FR-1.2) | Read from each title block, saved on the server, correctable by an admin. |
| Task history + CSV (FR-12.3, FR-6.5) | Full history in the task drawer; CSV of the filtered list. |
| Bulk edit | Tick several tasks; change status, priority, company, assignee or due date in one undoable step. |

## 3. Phases

Four pull requests, each based on `main`, each shippable and verified on its
own. Later phases use earlier ones; nothing in an earlier phase depends on a
later one. Each phase gets its own implementation plan, written when the
phase before it has merged.

| Phase | Contents | Depends on |
|---|---|---|
| 1 | Select by default, one-shot tools, shortcuts · real sheet numbers | — |
| 2 | Tasks tab: list, sort/group/filter, priority, drawer with history, create on/off sheet, bulk edit, CSV | 1 (sheet labels) |
| 3 | Comments and replies · sheet bookmarks | 1 (labels), 2 (drawer) |
| 4 | Send back with a reason · recently deleted · un-issue | 2 (drawer, Tasks tab) |

Server mode only for the Tasks tab, bookmarks, comments, trash and un-issue,
the same rule the drawing library follows: in browser mode there is no
project, so these controls do not render. Tool behaviour and sheet-number
detection work in both modes.

## 4. How it fits the architecture

New behaviour arrives as new files that plug into existing seams: ItemField
for priority, AnnotationRegistry and PunchListRegistry for off-sheet tasks,
ports with HTTP adapters for everything stored, and `registerSchema` for every
new table. Pure logic lives in `domain/` with a `verify-*.mjs` suite.

The project rules (docs/ARCHITECTURE.md) ask that any edit to existing code
beyond a registration or wiring line be named up front. These are the ones this release needs, each
adding a seam rather than a feature:

| File | Edit | Why it cannot be a new file |
|---|---|---|
| `presentation/hooks/useSheetEditor.js` | Report each successful create (`created`) | Only the editor knows when a draft became an item. The return-to-Select rule itself lives in a new `ToolLatch`. |
| `presentation/components/ToolPalette.jsx` | Lock a tool (double-click, long-press), lock badge, shortcut in the tooltip | The rail is the only place a tool is pressed. |
| `presentation/components/SheetViewer.jsx` | Use the tool latch and shortcuts; Escape returns to Select | Its rail props and keyboard handler are where tools meet the sheet. |
| `presentation/components/Toolbar.jsx` | Sheet picker shows labels; admin "Rename sheet" button | The picker lives there. |
| `presentation/components/Icon.jsx` | New icons (edit, star) | Icons are one fixed map. |
| `App.jsx` | Render the Sheets/Tasks switch and Bookmarks menu, hold which view is on screen | The composition of top-level views is App's job. |
| `domain/services/EditorService.js` | `applyAll(changes, label)`: several updates as one command | Bulk edit must stay on the one write path, checked, recorded and undoable as one step. |
| `domain/policy/SealedByExportPolicy.js` | Allow the `comment` intent on issued items | A comment does not change the item; the conversation continues after handover. |
| `domain/punchlist/PunchListEntry.js`, `PunchListRegistry.js`, `TaskList.js`, `presentation/punchlist/PunchListPanel.jsx`, `domain/services/ExportService.js`, `presentation/hooks/useExport.js` | Carry the sheet number from `SheetNames` to the punch list and the issued schedule, falling back to "Sheet N" | Today each of them computes "Sheet N" inline from the page index. |
| `backend/history.go` | `ReplyTo` on change records | Replies point at their parent comment. |
| `backend/history.go` (`handleSealedIds`) | Skip exports that were voided | Un-issue must unlock what the voided issue sealed. |

Each new server route is one registration line in `backend/main.go`, and each
new service one wiring line in `ServiceContainer.jsx`. Everything else is
additive.

## 5. Phase 1 — Tools and sheet names

### 5.1 Select by default, one-shot tools

- The app opens on Select (already true) and **returns to Select after any
  markup is created**: pin, box, cloud, arrow, freehand, text, photo. The new
  markup is selected, so its details open, as Fieldwire opens a new task.
- **Keep a tool on**: double-click the tool, or long-press it on a touch
  screen. A small lock badge shows on the tool. Picking another tool, pressing
  Escape or clicking the locked tool again releases it.
- A draft that is cancelled (Escape mid-drag, empty description) leaves the
  tool as it was.
- **Shortcuts**, ignored while typing: V Select, P Pin, B Box, C Cloud,
  A Arrow, D Draw, T Text, I Photo. Shown in each tool's tooltip.
- Roles are unchanged: a collaborator's rail still offers Select and Photo
  only, and the shortcuts for tools they cannot use do nothing.

**Design.** `presentation/tools/ToolLatch.js` (pure: `{toolId, locked}` and
the transitions above) and `useToolLatch` hold the rule. `useSheetEditor`
reports `created` (the markup just made); the latch answers it by selecting
the default tool and the new markup, unless the tool is locked. Shortcuts come from `ToolShortcutRegistry`
(presentation, keyed by tool id, registered in a barrel) so a new tool brings
its own key without editing a switch.

**Verified by** `verify-tool-latch.mjs` (every transition, including cancel
and role-limited rails) and in the browser on desktop and a phone-sized view.

### 5.2 Real sheet numbers and titles

- Each page is labelled from its title block: number (A-101) and title (LEVEL
  1 FLOOR PLAN, as printed). Where nothing is found the label stays "Sheet 3".
- The sheet picker, the Tasks tab and bookmarks show number and title; the
  punch list and the issued PDF's schedule, where space is short, show the
  number alone (the Sheet column reads A-101).
- An admin can correct a label from the sheet picker ("Rename sheet"). A
  correction wins over detection and is never overwritten by it.

**Detection** (`SheetNameDetector` port; `PdfJsSheetNameDetector` adapter)
reads each page's text with pdf.js:

1. If the page has a "SHEET NUMBER" / "SHEET NO" / "DWG NO" label, the number
   is the nearest text below or to the right of it; "SHEET TITLE" works the
   same way for the title.
2. Otherwise the number is the largest-font text matching a sheet designator
   (`A-101`, `A101`, `S-2.01`, `FP-101`, `M1.1`) in the bottom-right third of
   the page, and the title is the largest upper-case line beside it.
3. A page with no candidate gets no label.

It runs in the background, one page at a time, the first time an admin or
power collaborator opens a drawing without stored labels, and never blocks the
sheet from rendering. Until then everyone sees "Sheet N".

**Storage.** Table `sheet_names (document_id, page_index, number, title,
source 'detected'|'edited', updated_by, updated_at)`, primary key
`(document_id, page_index)`.
`GET /api/projects/{p}/sheet-names` returns every drawing's labels, keyed by
drawing name, in one call (the punch list spans drawings).
`PUT /api/projects/{p}/sheet-names/{drawing name}` saves detected labels
(admin or power collaborator; fills only pages without a label) or an edited
label (admin only; replaces whatever was there).

**Domain.** `SheetName` (value object) and `SheetNames` (`labelFor(pageIndex)`,
`numberFor(pageIndex)`), used wherever a sheet is named.

**Verified by** `verify-sheet-names.mjs` (labelled title block, unlabelled
title block, no title block, a rotated page, an edited label beating a
detected one) and Go tests for the endpoints and their role checks.

## 6. Phase 2 — Tasks tab

### 6.1 Layout

A **Sheets / Tasks** switch sits at the left of the top bar (on phones, in the
first row). Tasks shows:

- **A toolbar**: search, filters (status, priority, company, trade, assignee,
  sheet, "Assigned to me", "Overdue"), Sort, Group, New task, Export CSV.
- **The list**: one row per task — checkbox, number (pin numbers, or G-n),
  status chip, priority chip, description, sheet label, company, assignee, due
  date (red when overdue), last updated (who, when). Locked (issued) tasks show
  a lock. Grouped views have a header per group with a count.
- **The drawer**: clicking a row opens it on the right (full screen on a
  phone) with every field (editable for those allowed), photos, history, and
  an "Open on sheet" button.

On an iPad the list drops company and last-updated columns; on a phone each
task is a card.

### 6.2 Data

`domain/tasks/TaskRow` extends the punch list's item with priority, last
update, sheet label, `isOffSheet` and `isLocked`. `TaskQuery` filters, sorts
and groups rows; sort keys and group keys are registries
(`TaskSortRegistry`, `TaskGroupRegistry`) so a new option is a new file.

- **Sort**: sheet (set order, then pin number — the default), number, status,
  priority, due date, last updated.
- **Group**: sheet (default), status, priority, company, none.

The list reads the whole project once (`projects.items`) and refreshes when the
tab regains focus or after any edit made here.

### 6.3 Priority

`PriorityField` (key `priority`; High, Medium, Low; default Medium) registered
in ItemFieldRegistry, with a `choice` editor registered in
FieldEditorRegistry. It therefore also appears in the sheet's side panel and
the CSV with no further edits. Existing tasks read as Medium.

### 6.4 Creating tasks

**New task** (admins and power collaborators; collaborators can still add
photos and comments) offers two choices:

- **On a sheet**: pick the drawing and sheet, type the description, then the
  sheet opens with the Pin tool armed and the description filled; one tap
  places it. Cancelling leaves nothing behind.
- **Off a sheet**: a form with description (required), status, priority and
  the assignment fields. Saved as kind `task` on the project's
  `~tasks#0` sheet (`p{id}:~tasks#0`), so storage, roles, history and seals
  work unchanged. Off-sheet tasks are numbered G-1, G-2… in creation order,
  grouped as "Not on a sheet", never drawn, and never in a drawing's issued PDF.

**Place on sheet** turns an off-sheet task into a pin: pick the sheet, tap the
spot. It keeps its id, fields, comments and history (one command: remove the
task, add the pin with the same id). History is read by annotation id across
sheets for exactly this case, through a new `GET /api/annotations/{id}/changes`
(project members only) and a matching `TaskHistory` port.

`OffSheetTask` (domain, new annotation kind) has no position on any page;
`movedBy` and `getAnchor` return it unchanged and `null`.

### 6.5 Editing, locks and undo

Every edit in the drawer goes through the same `EditorService` as the sheet,
so roles, the issue lock, required descriptions and history apply without a
second code path. The lock needs every drawing's seals, not just the open
sheet's: `GET /api/projects/{p}/sealed` returns sealed ids for the project and
fills `ActiveSeals` while the Tasks tab is open. Undo and redo are shared with
the sheet view (Ctrl/Cmd+Z works in both).

### 6.6 Bulk edit

Ticking rows shows a bar: Status, Priority, Company, Assignee, Due date,
Delete. The change runs as one `EditorService.applyAll` command — one undo
step, one history entry per task. Tasks the user may not change (locked, or
beyond their role) are skipped and named in a notice ("2 issued tasks were
not changed").

### 6.7 History and CSV

The drawer's History lists every change, newest first, with who, when and
what (the change log already records all of it). **Export CSV** writes the
filtered, sorted list: number, drawing, sheet, description, status, priority,
trade, company, assignee, due date, overdue, created, last updated by, last
updated at. UTF-8 with a byte-order mark so Excel opens it cleanly
(`domain/tasks/taskCsv.js`, pure).

### 6.8 Open on sheet

Switches to Sheets, opens the drawing from the library if another is on
screen, goes to the page, and selects and centres the pin — the existing
`goToItem` path, extended across drawings.

**Verified by** `verify-task-query.mjs` (each sort and group, filters
combined, off-sheet numbering, locked rows), `verify-task-csv.mjs` (quoting,
commas, quotes, new lines, Unicode), `verify-off-sheet-task.mjs` (round trip
and place-on-sheet keeping id and fields), `verify-bulk-edit.mjs` (one undo
step, skipped items), Go tests for `/sealed`, and the browser on desktop,
iPad and phone widths as admin, power collaborator and collaborator.

## 7. Phase 3 — Comments and bookmarks

### 7.1 Comments and replies

- A **Comments** section in the task drawer and in the sheet's side panel:
  threads, newest last, each with author, company and time. **Reply** nests
  one level, as in Bluebeam.
- Anyone on the project can comment and reply, collaborators included
  (FR-11.4). Comments work on issued tasks too.
- Comments cannot be edited or deleted (FR-12.4: history is append-only).
- The Tasks list shows a comment count; the CSV includes it.

**Storage**: change records with intent `comment`, which the server already
accepts from every member. A new nullable `reply_to` column (via
`registerSchema`) links a reply to its parent. `Comment` and `CommentThread`
(domain, pure) turn records into threads.

### 7.2 Bookmarks

- A **star** beside the sheet picker bookmarks the sheet on screen.
- A **Bookmarks** button in the top bar lists starred sheets across all the
  project's drawings ("A-101 · Level 1 Floor Plan — sample-drawing-set.pdf");
  one tap opens that drawing at that sheet.
- Personal: each person sees their own, on every device.

**Storage**: table `sheet_bookmarks (user_id, project_id, sheet_id,
created_at)`, primary key `(user_id, sheet_id)`;
`GET /api/projects/{p}/bookmarks`, `PUT` and `DELETE
/api/projects/{p}/bookmarks/{sheetId}`. Domain `Bookmark` and a
`BookmarkRepository` port with an HTTP adapter.

**Verified by** `verify-comment-threads.mjs` (ordering, replies to replies
flattening to one level, orphans), `verify-bookmarks.mjs`, Go tests for the
bookmark endpoints (only your own; only your projects) and for `reply_to`.

## 8. Phase 4 — Reversing the workflow

### 8.1 Send a task back

Moving a task backwards — Closed → Ready for review or Open, Ready for review
→ Open — asks for a reason. Admins and power collaborators only, as with any
status change today. The reason is saved in the history and posted as a
comment, so the person doing the work sees why. This is the "Rejected with a
reason" step from D3. `StatusTransition` (domain, pure) says which moves are
backwards.

### 8.2 Recently deleted

- A database trigger copies every deleted markup to `annotation_trash` before
  it goes, so no delete path can skip it (single delete, bulk delete, clear
  sheet). A second trigger removes the copy when the same id is saved again,
  so undo and restore leave nothing behind.
- **Recently deleted** (Tasks tab, admins only) lists the last 30 days: what
  it was, sheet, who deleted it and when.
- **Restore** puts it back through `EditorService` (so it is recorded and can
  be undone) with its original id, number, fields and history.

`GET /api/projects/{p}/trash` (admin only) lists the copies; rows older than 30
days are removed when the list is read.

### 8.3 Un-issue a PDF

- **Issue history** (admins) lists every issue of the open drawing: when, by
  whom, how many markups it sealed.
- **Void issue** asks for a reason and warns that copies already sent cannot
  be recalled. The void is recorded (`export_voids`: export id, who, when,
  reason) — the issue itself stays in the log, marked void.
- Sealed-id queries skip voided issues, so the items unlock at once for
  everyone.

`POST /api/exports/{id}/void` (admin of the project the export belongs to; the
project is read from the sheet ids the export sealed).

**Verified by** `verify-status-transition.mjs`, Go tests for the triggers
(delete, restore, undo, clear sheet), the trash endpoint's admin check and
30-day window, void + unseal, and refusal for non-admins.

## 9. Errors and edge cases

- Detection finds a wrong number: the admin renames it; the edit is kept.
- Two people bookmark or comment at once: independent rows, no conflict.
- A task is edited in the drawer while someone else issues its drawing: the
  save is refused with the existing "issued" message and the row shows a lock
  after refresh.
- Bulk edit across a mix of permitted and locked tasks: permitted ones change,
  the rest are named in a notice.
- Restoring a task whose drawing was deleted: refused with "Its drawing is no
  longer in the project."
- Voiding an issue whose items were since re-issued: only the voided issue's
  seals lift; the later issue still holds its items.
- Off-sheet task placed on a sheet that was issued meanwhile: the new pin is
  not sealed (it is new work), as with any new markup.

## 10. Testing and release

Each phase: new verify suites added to `npm run verify`, Go tests added to
`go test -race`, `npm run lint`, `npm run build`, and a browser pass on
desktop, iPad and phone widths with each role. Joey's end-to-end test
(SCRUM-53) gains one path per phase: place a pin and stay on Select; open the
Tasks tab and sort by sheet; comment and reply; send back with a reason. Each
phase is deployed to the live site and checked there before the next merges.

## 11. Out of scope

Custom statuses, checklists, calendar and Gantt views, plan hyperlinks,
real-time updates, offline use (its own Sprint 3 design), moving photos to S3,
and comment threads in the issued PDF (FR-11.5).
