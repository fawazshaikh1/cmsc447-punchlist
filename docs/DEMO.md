# Demo — ten minutes, start to finish

A walk through the whole product as one job site would use it: the project
manager sets up and marks up on a laptop, a subcontractor works the same items
from a tablet, and the drawing is issued at the end.

## Before you start (5 minutes, once)

1. Postgres running, then the API and the app — see the README:
   `cd backend && go run .` and `cd web && npm run dev`.
2. Two windows side by side: a normal one (**the PM**) and a private one, or a
   second browser (**the sub**). They must not share cookies.
3. Have `web/public/sample-drawing-set.pdf` to hand, and one photo to upload.

## 1. Set up the job — the PM (1 min)

- **Create account**: name, company, title, and a passphrase of 15+
  characters. *A passphrase is easier to type on site than symbols.*
- **Start a project**: "Engineering Building". You are its admin.
- **Open drawing** → the sample set. Four sheets; "Sheet 1 of 4" switches them.
  It is saved to the project as it opens: everyone on it can now open it from
  **Drawings**, on any device, without the file.

## 2. Raise punch items (2 min)

- **Pin** → tap a spot → "What needs fixing?" → *Fire door closer missing*.
  The pin is numbered 1.
- **Box**, **Cloud** and **Arrow**: drag on the sheet. **Photo**: tap, choose a
  file, *Place photo*.
- Select the pin. In **Assignment**: trade *Doors*, company *Metro Drywall*,
  **Assigned to** — the project's people are offered — and a due date last
  week. The pin turns overdue, on the sheet and in the panel.
- Undo and redo the last few steps: every change is reversible.

*Point to make:* zoom to 400%, rotate, pinch on a tablet — open **Coordinate
check** at the foot of the panel: the stored PDF points never move, and every
one round-trips exactly. That is the core technical risk of the project,
proven.

## 3. The punch list (1 min)

- Panel → **Punch list**. Every item in the project, numbered like the pins.
- Filter **Overdue**, then a company, then search "door". Tap an item: it goes
  to its sheet and selects it.

## 4. Bring in the subcontractor (2 min)

- PM: account menu (top right) → **People on this project**. The sub must have
  an account first — in the second window, **Create account** as them.
- PM adds them by email as **Collaborator**.
- Sub: sign in → the project → tap the drawing in the list — no file needed. They see every item and
  photo the PM made. Their tool rail is **Select** and **Photo** only; Delete,
  Issue PDF and Clear sheet are gone; dragging a pin does nothing.
- Sub adds a photo. PM clicks back into their window: it appears — the sheet
  re-reads when you return to it.
- Sub: Punch list → **Assigned to me** shows just their items.

*Point to make:* the hiding is a courtesy. The server checks the role on every
request — in DevTools, a collaborator's direct `PUT` to `/api/annotations/…`
comes back `403` with the reason.

## 5. Issue the drawing — the PM (2 min)

- **Working copy**: markups stay selectable and repliable in Acrobat. Reopen
  that file here: the markups come back live, as the same items — not copies.
- **Issue PDF** → the confirmation counts what will be locked → issue. Open
  the PDF: markups painted in, a punch list page appended with trade, company
  and due dates, issued by the PM by name.
- Back in the app, the issued items are read-only, with the reason, and undo
  cannot reach behind the issue.

## 6. Questions you will get

| Question | Answer |
|---|---|
| Where is the data? | PostgreSQL behind a Go API; photos too. `npm run dev:browser` runs with no server at all. |
| How are passwords stored? | PBKDF2-SHA256, 600,000 iterations, a random salt each. Sessions are HttpOnly cookies; the database holds only their digest. |
| What stops a collaborator editing? | The server: every write is checked against the role on that project (`backend/access.go`). |
| How do you add a markup type? | A new class, a marker component and an export writer, each registering itself — no existing file changes. See ARCHITECTURE.md. |
| How is it tested? | 16 domain suites (`npm run verify`), Go integration tests against a real Postgres, and both on every pull request in GitHub Actions. |
