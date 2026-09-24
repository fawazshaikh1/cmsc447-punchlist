# Punch List — Software Requirements

**Version** 1.4 · **Date** 2026-09-18 · **Status** For stakeholder review
*v1.1 incorporated requirements stated by the stakeholder on 2026-09-11. v1.2 adds the user stories (section 5). v1.3 revises D5 — issuing a flattened PDF now makes the markups in it permanent — and closes open question 1. v1.4 makes a punch item's description mandatory (D16) and records who made every change (D17).*
**Course** UMBC CMSC 447 · **Repo** fawazshaikh1/cmsc447-punchlist

---

## 1. Purpose

Just before a construction project completes, the project team walks the
building and inspects it against the construction documents. Every defect they
find becomes a **punch item**: a location on a drawing, a description, a photo,
a responsible trade, and a status that has to reach *closed* before the project
does.

Today that walk is done with paper, a camera, and a spreadsheet that is
reconciled afterwards. This project builds a tablet-first tool that captures the
item once, on the drawing, and produces a handover PDF that anyone can open.

### 1.1 The measure of success

> A superintendent walks a floor with an iPad, marks twenty defects, and emails
> the architect **one PDF** — the drawing set with markups, plus a punch list
> report with photos — without opening Excel or a second application.

---

## 2. Roles and access

**Roles are granted per project, not globally** — stated by the stakeholder. The
same person can be an admin on one project and a collaborator on another, which
reflects how a company works across several jobs at once.

| Role | Can |
|---|---|
| **Admin** | Adds and deletes sheets. Grants roles and project access. Full control of everything below |
| **Power collaborator** | Edits sheets and performs general tasks on them — raise, assign, change status, mark up |
| **Collaborator** | Adds **photos and comments only**. Cannot change anything major |

### 2.1 Accounts

Users **create their own account** with email, name, company name, and their
title at that company. Registering grants access to nothing — a project admin
then invites them to a project and sets their role there.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Drawing set** | The multi-page PDF issued by the architect. 50–300 sheets is normal |
| **Sheet** | One page, identified by its sheet number (`A-201`) and revision |
| **Punch item** | One defect: location on a sheet, description, trade, status, photos |
| **Markup** | A drawn annotation — box, revision cloud, arrow, freehand, text |
| **Revision cloud** | Scalloped outline meaning "this region changed or is in question". The convention an architect looks for first |
| **Trade** | The discipline responsible — electrical, plumbing, HVAC, drywall |
| **Re-issue** | A new version of the drawing set. Sheet `A-201` becomes revision 3 |
| **Closeout** | The final handover package proving every item was resolved |
| **Task** | The stakeholder's word for a punch item. Used interchangeably here |
| **Bluebeam** | The PDF markup software the team uses today. Source of the comment-and-reply expectation |
| **Fieldwire** | Field-management software the stakeholder named as the example to follow. Closest reference for the task model |

---

## 4. Decisions

Questions put to the stakeholder, and the answers this project will build to.
Where the stakeholder did not specify, the option chosen is the one that removes
the most work from their side.

| # | Question | Decision | Why this answer |
|---|---|---|---|
| D1 | Is a punch list report needed, separate from the marked-up drawing? | **Yes — and it ships inside the same PDF**, as appended report pages, plus a CSV | One file to email. The architect never needs our app, and the GC still gets a spreadsheet |
| D2 | Should photos be in the exported PDF? | **Yes.** Thumbnail on the report row, full image on the item's detail page | A photo that only exists in the app is a photo the architect never sees |
| D3 | What statuses? | **Open → Ready for review → Closed**, plus **Rejected** (returns to Open, reason required) | Matches site practice. "Rejected with a reason" is what ends the "but I said it was done" loop |
| D4 | Who may close a task? | **Admin or power collaborator.** A collaborator can add a photo and comment saying the work is done, but cannot change status | Keeps the party doing the work from grading it, while still letting them show evidence |
| D5 | Can a task be edited after it is closed? | **Yes — until it is issued.** Everything stays changeable, including reopening a task closed five days ago. The one exception is a **flattened PDF export**: the markups in that file become permanent and read-only, and new work goes on top of them | Keeps the flexibility the stakeholder asked for at the only point it costs nothing, and draws the line at the one moment where it would cost something real. A flattened PDF in the architect's hands cannot be changed; if our copy could, the two would disagree with no way to tell which is right. Issuing is a deliberate act the user confirms, so nothing freezes by surprise. *Revised in v1.3 — resolves former open question 1.* |
| D6 | Assign to a person or a company? | **Company (trade contractor)**, optionally narrowed to a person | You know the sub, not always the individual — and individuals leave mid-project |
| D7 | What happens to items when a set is re-issued? | Items belong to a **sheet number**, not a file. On re-issue they carry forward, flagged **"sheet revised — verify location"** until an admin or power collaborator confirms | This is the thing that breaks every homemade punch tool. Items must not vanish because a sheet was reprinted |
| D8 | Which export is the default? | **Flattened** for handover; **Editable** offered for design-team round trips | The file sent to a client must look right in whatever viewer they open it in |
| D9 | Connectivity on site? | **Offline read and create**, queued sync, server wins on conflict with a visible conflict list | Basements and stairwells have no signal. A tool that needs bars is a tool left in the truck |
| D10 | Due dates? | **Optional due date per item**, overdue items highlighted | Cheap to build, and it is the first thing a GC asks for when chasing a sub |
| D12 | What do they use today, and what should we look like? | They work in **Bluebeam** now and named **Fieldwire** as the example, alongside PlanGrid. Take the **comment-and-reply thread** from Bluebeam and the **task model** from Fieldwire | Bluebeam is where their markup habits come from, so a comment thread that behaves differently will feel broken. Fieldwire is the closer match for tasks with status and assignment — the half Bluebeam does not do |
| D13 | Comments, or comment threads? | **Threads.** Anyone can comment on a task and anyone can **reply**. Collaborators can do this even though they cannot change anything else | A flat list turns into two people talking past each other. Replies make it a conversation an architect can follow weeks later — and it is what they already have |
| D16 | Can a punch item exist without a description? | **No.** The description is collected when the pin is placed, before the item exists, and cannot later be emptied | A numbered marker with nothing attached is unusable by whoever receives it, and the person who placed it stops remembering what they saw within the hour. Collecting it at placement costs the same ten seconds but spends them while the user is standing in front of the defect. Items created before this rule stay editable so they can be repaired rather than frozen |
| D17 | How is "who did this" recorded, before accounts exist? | Every change writes a **change record** carrying the actor, the time and what changed. Until sign-in exists the actor is an honest placeholder ("this device") | Recording from day one means Sprint 2 adds names to a log that is already running, rather than adding the log. Attribution is kept beside the annotation rather than on it, so no markup type changes now or later — and it gives the full history D14 asks for, not just the last change |
| D16 | Can a punch item exist without a description? | **No.** The description is collected when the pin is placed, before the item exists, and cannot later be emptied | A numbered marker with nothing attached is unusable by whoever receives it, and the person who placed it stops remembering what they saw within the hour. Collecting it at placement costs the same ten seconds but spends them while the user is standing in front of the defect. Items created before this rule stay editable so they can be repaired rather than frozen |
| D17 | How is "who did this" recorded, before accounts exist? | Every change writes a **change record** carrying the actor, the time and what changed. Until sign-in exists the actor is an honest placeholder ("this device") | Recording from day one means Sprint 2 adds names to a log that is already running, rather than adding the log. Attribution is kept beside the annotation rather than on it, so no markup type changes now or later — and it gives the full history D14 asks for, not just the last change |
| D14 | What history does a task need? | **Last updated and by whom**, visible without opening anything. Behind it, a full change history — every status change, edit, photo, comment, with who and when | Explicitly asked for. It is also what makes D5 safe: between issues nothing locks, so the record of who changed what is the accountability. The export history is part of it — every issue is recorded with what it contained, by whom, and when |
| D15 | How do users reach their drawings? | A **document library per project** — every imported PDF, showing who imported it and when, opened by **double-clicking** as in Acrobat | Asked for directly. Also answers "which set is current", the question causing most confusion when several revisions circulate |
| D16 | Simultaneous multi-user editing? | **Bonus, not a requirement** — stated as such. Built only if the core is finished and stable | Real-time collaboration is among the most expensive things to build and hardest to demo reliably. Taking them at their word protects what they actually need |
| D11 | What does "works with PlanGrid" mean — a live integration, or output PlanGrid can open? | **Output PlanGrid can open.** *Confirmed with the stakeholder.* A standard PDF that uploads into PlanGrid or Autodesk Build as a sheet, plus a CSV matching their issue import. No API connection, no Autodesk account | Interoperability through standard formats is testable today with no credentials. A live API sync would need an Autodesk Construction Cloud project to develop against, three-legged OAuth, and roughly a sprint we could not verify — for an outcome the PDF already delivers |

---

## 5. User stories

The narrative the functional requirements decompose into. Each is a complete
vertical slice — something a user can do end to end — rather than a layer of the
system.

### 5.1 Sprint 1 — delivered

**US-1 · Open a drawing and mark it up** — 8 pts

> As a **power collaborator** inspecting a sheet, I want to open a drawing set
> and mark defects directly on it — pins, boxes, revision clouds, arrows,
> freehand and text — so that the record sits on the drawing instead of in a
> separate notepad.

- A multi-page PDF opens and renders; I can change sheets, zoom 25–800%, rotate
- I can place a pin and draw box, cloud, arrow, freehand and text markups
- I can set colour and stroke weight
- **Markups stay anchored through zoom, rotation and page reload**
- Verified on a real 153-page drawing set

*Traces to* FR-2.1–2.3, FR-3.1, FR-4.1, FR-4.2

**US-2 · Fix a mistake without losing work** — 5 pts

> As a **power collaborator** working quickly on site, I want to undo anything I
> do and edit what I have already placed, so that a mis-tap does not cost me the
> markups I made before it.

- I can select a markup, drag it to reposition, edit it, or delete it
- I can set a pin's description and status
- **Every action is undoable**, including clearing a sheet, with `Ctrl/Cmd+Z`
- Redo works, and the button names the step it will reverse
- Markups survive a page reload

*Traces to* FR-3.5, FR-4.3, FR-4.4

**US-3 · Hand over a marked-up PDF** — 8 pts

> As a **power collaborator** finishing a walk, I want to export the marked-up
> set as a PDF, so that I can send it to the architect and they can open it in
> Bluebeam or Acrobat without our software.

- Export produces a PDF with every markup visible
- **The original drawing is unmodified** — verified by comparing page content
  streams before and after
- Markups already in the source file are preserved, not duplicated
- Verified open in Acrobat and Chrome
- Two modes: flattened (visible in every viewer) and editable (native annotations)

> **Known limitation:** the *editable* export does not render fully in Acrobat.
> *Flattened* is the working path and the default for handover.

*Traces to* FR-6.1–6.3, FR-8.1, FR-8.4

> **Note on acceptance criteria.** None of the above claims tablet behaviour.
> Everything is verified on desktop; nothing has yet run on a physical iPad.
> Tablet verification is a separate Sprint 2 story so that no story is closed on
> an untested claim.

### 5.2 Sprint 2 — backlog

**US-4 · Raise a punch item on the drawing** — 8 pts

> As a **power collaborator** walking the site with a tablet, I want to tap a
> location on a sheet and record the defect there — photo, description, trade
> and responsible company — so that it is captured in place instead of on a
> notepad I have to transcribe that evening.

- Tapping a sheet in task mode creates an item anchored to that point
- The item captures description, trade, responsible company, optional person,
  optional due date
- I can attach up to 5 photos from the camera or library
- The item appears immediately in the project's task list with its sheet number
- A collaborator cannot create an item; the control is not available to them
- The item shows who created it and when

*Traces to* FR-3.1, FR-3.2, FR-3.3, FR-2.3, FR-9.5

> **Sizing warning:** this hides the whole photo pipeline — S3 pre-signed
> upload, downscaling, thumbnails. If that is not already started, split into
> "raise an item with description and assignment" (5) and "attach photos to an
> item" (5). Two honest tickets beat one that quietly slips.

**US-5 · Respond to an item assigned to my company** — 5 pts

> As a **collaborator** from the responsible trade, I want to find the items
> assigned to my company, photograph the completed work and reply in the comment
> thread, so that I can show the work is done without being able to mark my own
> work as passed.

- I can filter the task list to items assigned to my company
- Opening an item shows its location, description, photos and full comment thread
- I can add a photo, add a comment, and **reply to an existing comment**
- I **cannot** change status, description, assignment or location — the controls
  are absent, and the server rejects the request if sent anyway
- My comment shows my name, company and time
- The item's "last updated by" reflects my change

*Traces to* FR-11.1–11.4, FR-12.1, FR-5.2, FR-9.5

**US-6 · Hand over the full closeout package** — 8 pts

> As an **admin** closing out the project, I want to export one PDF containing
> the marked-up sheets plus a punch list report with photos and comment history,
> so that I can email the architect a single file that opens in Bluebeam or
> PlanGrid without anyone installing our software.

- One PDF: original sheets with markups, then appended report pages
- Summary table (number, sheet, trade, assignee, status, due date) and one detail
  page per item with its photos and comment thread
- Opens in Bluebeam and PlanGrid with every markup visible and correctly placed
- The original drawing is unmodified
- I can filter by status, trade or company before exporting
- I can also export the list as CSV

*Traces to* FR-6.1–6.7, FR-8.1–8.4, FR-11.5

---

## 6. Functional requirements

Priority: **P1** must ship · **P2** should ship · **P3** if time allows.

### 5.0 Accounts, access and the document library

| ID | Requirement | Pri |
|---|---|---|
| FR-9.1 | A user can create their own account with email, name, company name, and title at that company | P1 |
| FR-9.2 | A new account has access to **no** projects until an admin grants it | P1 |
| FR-9.3 | A project admin can invite a user and set their role — admin, power collaborator, or collaborator | P1 |
| FR-9.4 | **Roles are per project.** The same user can hold different roles on different projects | P1 |
| FR-9.5 | Role permissions are enforced server-side, not only hidden in the interface | P1 |
| FR-9.6 | An admin can change a user's role or remove them from a project | P2 |
| FR-10.1 | Each project has a library listing every imported PDF | P1 |
| FR-10.2 | The library shows **who imported each file and when** | P1 |
| FR-10.3 | A user opens a document by **double-clicking** it, as in Acrobat's file view | P1 |
| FR-10.4 | Only an admin can add or delete sheets and documents | P1 |
| FR-10.5 | The library indicates which set is current when several revisions exist | P2 |

### 5.1 Drawing sets

| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | A user can upload a multi-page PDF drawing set | P1 |
| FR-1.2 | The system stores each page as a sheet with its page size, rotation, and sheet number where it can be parsed from the filename or page text | P1 |
| FR-1.3 | A user can navigate between sheets and search by sheet number | P2 |
| FR-1.4 | The system rejects encrypted PDFs, non-PDF files, and sets above the configured page and size limits, with a message naming the reason | P1 |
| FR-1.5 | A user can upload a re-issued set; items on a matching sheet number carry forward flagged for verification (D7) | P2 |

### 5.2 Viewing

| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | A sheet renders on a tablet at a legible default zoom | P1 |
| FR-2.2 | A user can pan, pinch-zoom between 25% and 800%, and rotate in 90° steps | P1 |
| FR-2.3 | **Markups stay anchored to the drawing through zoom, pan, rotation, reload, and re-export.** Coordinates are stored in PDF user space, never screen pixels | P1 |
| FR-2.4 | Markups already present in an uploaded PDF are shown, read-only, behind a toggle | P2 |

### 5.3 Punch items

| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | A user can place a punch item by tapping a location on a sheet | P1 |
| FR-3.2 | An item carries: number, description, trade, status, responsible company, optional person, optional due date, created-by, created-at | P1 |
| FR-3.3 | A user can attach up to 5 photos to an item, from camera or library | P1 |
| FR-3.4 | A user can add threaded comments to an item | P2 |
| FR-3.5 | A user can move, edit, or delete any item that has not been issued — including a closed one | P1 |
| FR-3.6 | A closed task can be reopened and edited until it has been issued in a flattened export; the change is recorded (D5) | P2 |
| FR-3.7 | Every change to an item is recorded with who and when (D17) | P2 |
| FR-3.8 | An item that has been **issued in a flattened export is read-only** — it cannot be moved, edited, reopened or deleted, and the interface says why (D5) | P1 |
| FR-3.9 | Closing an item shows a **confirmation that explains what closing does and what issuing will do**, so nothing becomes permanent without the user being told first (D5) | P1 |
| FR-3.10 | Placing a pin **prompts for its description first**; the item is not created until one is given, and whitespace does not count (D16) | P1 |
| FR-3.11 | A description cannot later be emptied. An item that was already blank stays editable so it can be **repaired** rather than frozen (D16) | P1 |
| FR-3.12 | Items still missing something are **marked on the sheet and in the panel**, with the reason stated (D16) | P2 |
| FR-3.10 | Placing a pin **prompts for its description first**; the item is not created until one is given, and whitespace does not count (D16) | P1 |
| FR-3.11 | A description cannot later be emptied. An item that was already blank stays editable so it can be **repaired** rather than frozen (D16) | P1 |
| FR-3.12 | Items still missing something are **marked on the sheet and in the panel**, with the reason stated (D16) | P2 |

### 5.3.1 Comments, replies and history

| ID | Requirement | Pri |
|---|---|---|
| FR-11.0 | Each item shows **who last changed it and when**, without opening anything (D14, D17) | P1 |
| FR-11.0 | Each item shows **who last changed it and when**, without opening anything (D14, D17) | P1 |
| FR-11.1 | Any user with project access can comment on a task | P1 |
| FR-11.2 | A user can **reply to a comment**, forming a thread — the Bluebeam behaviour they work in today | P1 |
| FR-11.3 | Comments show author, company and time, and cannot be edited by anyone else | P1 |
| FR-11.4 | A collaborator can comment and reply even though they cannot change anything else | P1 |
| FR-11.5 | Comment threads are included in the exported report so the conversation survives handover | P2 |
| FR-12.1 | Every task shows **when it was last updated and who updated it**, without opening anything | P1 |
| FR-12.2 | Every change is recorded — status, description, assignment, location, photos, comments — with who and when | P1 |
| FR-12.3 | A user can view a task's full history | P2 |
| FR-12.4 | History is append-only. It cannot be edited or deleted, including by an admin | P2 |

### 5.4 Markups

| ID | Requirement | Pri |
|---|---|---|
| FR-4.1 | A user can draw box, revision cloud, arrow, freehand, and text markups | P1 |
| FR-4.2 | A user can set markup colour and stroke weight | P1 |
| FR-4.3 | A user can select, move, and delete a markup | P1 |
| FR-4.4 | **Every action is undoable**, including clearing a sheet | P1 |
| FR-4.5 | A markup can be linked to a punch item so they export together | P3 |

### 5.5 Assignment and workflow

| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | An admin or power collaborator can assign a task to a responsible company | P1 |
| FR-5.2 | A user can filter tasks to those assigned to their own company | P2 |
| FR-5.3 | A power collaborator can move a task Open → Ready for review | P2 |
| FR-5.4 | An admin or power collaborator can close a task, or reject it with a required reason | P2 |
| FR-5.5 | The system enforces the transitions above by role (D4) | P2 |

### 5.6 Report and export

| ID | Requirement | Pri |
|---|---|---|
| FR-6.1 | A user can export the drawing set with all markups and punch items embedded, **openable in any PDF software** | P1 |
| FR-6.2 | The export offers **Flattened** (visible everywhere) and **Editable** (native PDF annotations, selectable in Acrobat) | P1 |
| FR-6.3 | The export **never modifies the original drawing** — verified by comparing the page content streams before and after | P1 |
| FR-6.4 | The export appends **punch list report pages**: a summary table, then one detail page per item with its photos (D1, D2) | P1 |
| FR-6.5 | A user can export the punch list as CSV | P2 |
| FR-6.6 | A user can filter the report — by status, trade, responsible company, or sheet — before exporting | P2 |
| FR-6.7 | Report pages are print-ready at US Letter | P2 |
| FR-6.8 | A flattened export **asks for confirmation first**, naming how many markups on how many sheets will become permanent | P1 |
| FR-6.9 | Every export is **recorded** — mode, what it contained, by whom, when. A flattened one seals its contents; an editable one does not (D5, D14) | P1 |
| FR-6.10 | Issuing clears the undo history, so no reversal can reach behind a seal | P1 |
| FR-6.11 | The confirmation before issuing **names how many items still have no description**, so unfinished work is caught while it can still be fixed (D16) | P1 |
| FR-6.11 | The confirmation before issuing **names how many items still have no description**, so unfinished work is caught while it can still be fixed (D16) | P1 |

### 5.7 Interoperability with PlanGrid / Autodesk Build

| ID | Requirement | Pri |
|---|---|---|
| FR-8.1 | The exported PDF uploads into PlanGrid or Autodesk Build **as a sheet, with no post-processing** — standard PDF, no proprietary structures | P1 |
| FR-8.2 | Sheet numbers are preserved in the export so the receiving system can match them to its own sheets | P1 |
| FR-8.3 | CSV columns map to Autodesk Build's issue-import fields — title, description, location, status, assignee, due date | P2 |
| FR-8.4 | The export carries no app-specific structures, so nothing depends on our software to be read later | P1 |

> **Note for the team:** this is the reason FR-6.3 (never modify the drawing) and
> the flattened export matter so much. A file that another system has to
> special-case is a file that fails the moment it leaves us.

### 5.8 Offline

| ID | Requirement | Pri |
|---|---|---|
| FR-7.1 | A user can view previously opened sheets with no connection | P3 |
| FR-7.2 | A user can create and edit items offline; changes queue and sync on reconnect | P3 |
| FR-7.3 | On conflict the server copy wins and the user is shown a list of what conflicted | P3 |

---

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Primary device: iPad, Safari.** Desktop Chrome supported. Installable as a PWA — no app store |
| NFR-2 | A sheet from a 300-page set renders in under 2 seconds on the target iPad |
| NFR-3 | Supports 500 punch items per project and 5 photos per item without degrading |
| NFR-4 | Photos are downscaled to 1600px on the longest edge before storage and embedding, so a 200-item export stays in the tens of megabytes |
| NFR-5 | All traffic over HTTPS. Files in S3, never served from the application server |
| NFR-6 | A user only sees projects they are a member of, enforced server-side |
| NFR-7 | Adding a markup type or a status must not require changing existing code or a database migration |

---

## 8. Out of scope

Stated explicitly so it is a decision and not an omission.

- **Live API integration with PlanGrid, Autodesk Build or BIM 360.** The export
  opens there; the app does not connect to it (D11)
- Native iOS or Android apps
- Revit or Procore integration
- Editing the drawing itself — text, dimensions, sheet content
- E-signature on closeout
- Scheduling, cost tracking, RFIs, submittals

---

## 9. Open questions for the stakeholder

Still genuinely needed. Each changes what gets built.

1. ~~**When you said "we can change anything anytime" — does that include a
   task that has already been closed?**~~ **Resolved 2026-09-18.** Closing does
   not lock anything; issuing does. A task stays fully editable, closed or not,
   until it is included in a flattened PDF export — at which point it becomes
   part of the permanent record, because the file the architect is holding
   cannot be changed either. See D5 and FR-3.8. Built and verified.

2. **Which PlanGrid or Autodesk Build version will the export be opened in, and
   can we get a test account?** Now that interoperability is the target (D11),
   the export needs verifying in the exact product the team uses — PlanGrid and
   Autodesk Build handle sheet uploads differently. A viewer account is enough;
   no API access needed.

3. **Does the report need to be emailed from the app, or is downloading enough?**
   Sending mail means an email service, deliverability, and bounce handling — a
   real chunk of work for something a user can do from their own mail client.

4. **Is there an existing list of subcontractors we should import?**
   If companies already live in a spreadsheet or another system, assignment
   should start from that list rather than making users type names.

5. **Does closeout require a signature or formal sign-off?**
   If an owner has to sign the completed punch list, that is a significant
   feature and needs to be scoped now, not in November.

6. **Are sheet numbers reliably in the PDF** — as page text, or only in the
   filename? This determines whether items can carry across a re-issue
   automatically (D7) or need manual matching.

7. **Roughly how many items on a typical walk, and how many trades?** Twenty
   items and three trades is a different product from four hundred items and
   twenty trades.

8. **Can they share a real drawing set** — ideally one an architect has already
   marked up? Our best test file is synthetic.

---

## 10. Traceability

| Requirement | Sprint | Status |
|---|---|---|
| FR-2.1, FR-2.2 | 1 | Done (SCRUM-18) |
| FR-2.3 | 1 | Done (SCRUM-19) |
| FR-3.1, FR-3.5, FR-4.1–4.4 | 1 | Done |
| FR-6.1, FR-6.2, FR-6.3 | 1 | Done |
| FR-1.1, FR-1.2, FR-1.4 | 2 | Not started |
| FR-3.2, FR-3.3, FR-5.1 | 2 | Not started |
| FR-6.4, FR-6.5 | 2 | Not started |
| FR-3.6, FR-5.2–5.5 | 2–3 | Not started |
| FR-1.5, FR-7.1–7.3 | 3 | Not started |

---

## 11. Assumptions

- One drawing set per project. Multiple projects per user.
- Sheets are vector PDFs from CAD. Scanned raster sheets render but cannot be
  searched by sheet number.
- Users are invited to a project; there is no public sign-up.
- Photos are taken on the same device that raises the item.
