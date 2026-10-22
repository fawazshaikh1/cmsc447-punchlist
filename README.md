# Punch List

A tablet-first app for construction punch lists. Open a drawing set, drop a pin
exactly where the problem is, say what is wrong, attach a photo, assign it to a
trade and a person — then issue the marked-up drawing as a PDF that opens in
Acrobat, Bluebeam or PlanGrid. Everyone on the project works on the same items,
from any device.

**Course** UMBC CMSC 447 — Software Engineering I, Fall 2026  
**Team** Fawaz Shaikh, Joey Peralta, Saumya Patel

## What it does

- **Markups that stay put.** Pins, boxes, clouds, arrows, freehand sketches,
  callouts and photos, stored in PDF coordinates — zoom, rotate, pinch or reload
  and every one is exactly where it was placed.
- **Punch items.** A pin is an item: description, status (open → ready for
  review → closed), trade, responsible company, assignee and due date. Overdue
  items are flagged on the drawing and in the list.
- **The punch list.** Every item in the project, filtered by status, company,
  trade or "assigned to me", numbered the same as the pins and the issued PDF.
- **Accounts, projects and roles.** Sign in, start a project, add your team.
  Admins manage people; power collaborators edit; collaborators view and add
  photos. The server enforces it, not just the screen.
- **Photos.** From the camera or a file, downscaled on the device, kept on the
  server so every teammate sees them.
- **Two exports.** A *working copy* whose markups stay editable in Acrobat (and
  come back live when reopened here), or an *issued* PDF with every markup
  painted in, a punch list page appended, and the markups locked for good.
- **History.** Every change records who made it and when.

## Stack

| Part | Built with |
|---|---|
| App | React 19, Vite, pdf.js (rendering), pdf-lib (export) — plain JavaScript |
| Server | Go (`net/http`), pgx |
| Database | PostgreSQL 17 |
| Hosting (planned) | AWS — S3, RDS, HTTPS |

## Run it (macOS)

You need Node 22+, Go 1.27 and PostgreSQL 17.

```bash
brew install node go postgresql@17
brew services start postgresql@17

# A login and two databases: the app's, and one the Go tests may wipe.
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres \
  -c "CREATE ROLE postgres LOGIN PASSWORD 'dev';" \
  -c "CREATE DATABASE punchlist OWNER postgres;" \
  -c "CREATE DATABASE punchlist_test OWNER postgres;"
PGPASSWORD=dev /opt/homebrew/opt/postgresql@17/bin/psql -h localhost -U postgres \
  -d punchlist -f backend/schema.sql
```

Then, in two terminals:

```bash
cd backend && go run .          # the API on :8080 — it brings the database up to date itself
```

```bash
cd web && npm install && npm run dev   # the app on http://localhost:5173
```

Create an account, start a project, and open a drawing —
`web/public/sample-drawing-set.pdf` is a four-sheet set to try it with.

**Without the server:** `cd web && npm run dev:browser` keeps everything in the
browser instead — no sign-in, no Go, no Postgres. Handy for working on the
interface.

## Check it

```bash
cd web && npm run verify     # every domain suite (15 of them, no test framework)
cd web && npm run lint && npm run build
cd backend && go test ./...  # integration tests against the punchlist_test database
```

GitHub runs all of these on every pull request (`.github/workflows/checks.yml`).

## How it is built

Three tiers — presentation (React), domain (plain classes, no imports), and
infrastructure (pdf.js, pdf-lib, HTTP, storage) — with new features added as new
files that plug into registries and ports rather than by editing what exists.
Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Document | What is in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The tiers, the registries, how to add a markup type or a field, sign-in, roles, photos, the punch list |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Requirements and user stories, as agreed with the stakeholder |
| [docs/PROGRESS.md](docs/PROGRESS.md) | What is done, how it was verified, and what is left |
| [docs/DEMO.md](docs/DEMO.md) | A ten-minute demo, step by step |
