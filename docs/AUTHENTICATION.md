# Authentication and testing — Joey's implementation

## Current integration base

Rebuilt against main commit `4bf3519` (merged issue-lock and attribution work).
The composition root retains CommandHistory, CompositeEditPolicy,
SealedByExportPolicy, StaticIdentityProvider, export history and change logging.
Authentication is added alongside those services, not in place of them.
The editor still uses the existing local identity until login UI integration.

## What this branch adds

The Go backend on main had four unauthenticated annotation routes and an in-memory
map. This branch keeps its HTTP/JSON contract, adds account/session endpoints,
and enforces project permissions on the server. It does **not** add PostgreSQL,
AWS, PDF upload storage, or a login screen. All server data, including accounts,
is lost when the process restarts. Use test accounts only.

The React editor still uses LocalStorageAnnotationRepository. It is an independent
local prototype, not an authenticated shared project editor yet. The tested
HttpAuthRepository is exposed as `useServices().auth` for the login UI. The HTTP
annotation adapter now sends the required CSRF header and session cookie.

## Run locally

Use Go 1.27.1 (the existing backend/go.mod version) and Node 22. Install dependencies
from the lockfile. Run in two terminals:

```sh
cd backend
LOCAL_DEV=true go run .
```

```sh
cd web
npm ci
npm run dev
```

The API binds to 127.0.0.1:8080 in local mode. Vite proxies `/api` so frontend
requests use the same origin and cookies. Visit `http://localhost:5173`.
Use `go run .`, not `go run main.go`, because the package now has multiple files.

For a future HTTPS deployment, omit LOCAL_DEV and set APP_ORIGIN to the exact
frontend origin, for example `https://punchlist.example.edu`. The server then
sets Secure cookies. Serve `/api` behind the same HTTPS origin; this is not a
cross-origin CORS deployment. Persistent storage and deployment hardening remain
required before a public rollout.

## API contract

Every POST/PUT/DELETE requires `X-Punchlist-Request: 1`. JSON bodies require
`Content-Type: application/json`. Browser Origin, when present, must equal
APP_ORIGIN (local default: http://localhost:5173). Fetch through `/api`, with
same-origin credentials. Do not store session tokens in localStorage.

| Method | Path | Request / result |
|---|---|---|
| POST | /api/auth/register | `{email,password,name,company,title}` → 201 profile; no automatic session or memberships |
| POST | /api/auth/login | `{email,password}` → 200 profile + HttpOnly session cookie |
| GET | /api/auth/me | 200 profile or 401 |
| POST | /api/auth/logout | Revokes current session, clears cookie → 204 |
| GET | /api/projects | Projects visible to current account, each with its project role |
| POST | /api/projects | `{name}` → 201 `{id,name}`; creator administers only that new project |
| PUT | /api/projects/{projectID}/members | Admin assigns an existing account via `{email,role}` → 204 |
| POST | /api/projects/{projectID}/sheets | Admin creates sheet identity (no PDF upload yet) → 201 `{id,projectId}` |
| DELETE | /api/projects/{projectID}/sheets/{sheetID} | Admin deletes sheet and its annotations → 204 |
| GET | /api/sheets/{sheetID}/annotations | Project member reads annotation array |
| DELETE | /api/sheets/{sheetID}/annotations | Admin/Power Collaborator clears sheet annotations → 204 |
| PUT | /api/annotations/{id} | Admin/Power Collaborator upserts existing annotation DTO → 204 |
| DELETE | /api/annotations/{id} | Admin/Power Collaborator deletes annotation → 204; missing ID → 404 |

Errors are `{ "error": "message" }`. Unauthorized sessions return 401; insufficient
project permissions return 403. Existing annotation IDs cannot be reassigned to
another sheet. Creation timestamps are assigned by the server and retained on
updates. Sheet IDs are allocated by the server and belong to exactly one project.

Role values are `admin`, `power_collaborator`, `collaborator`, matching the
stakeholder meeting rather than the older Inspector/PM names.

| Action | Admin | Power Collaborator | Collaborator |
|---|---|---|---|
| Read project annotations | Yes | Yes | Yes |
| Create/edit/delete/clear annotations | Yes | Yes | No |
| Add/delete sheets | Yes | No | No |
| Assign project roles | Yes | No | No |
| Add photos/comments | Future endpoints | Future endpoints | Future endpoints |

Never enable the unrestricted annotation PUT route for Collaborators to implement
comments/photos. Those need dedicated endpoints with narrowly validated changes.
There is no global admin role. Permissions are rechecked on each request, so
changing a role affects an existing session immediately. Last-admin demotion is
rejected to prevent stranding a project.

**Implementation choice for team review:** any signed-in account may create a new
project and administer it. The meeting did not specify project creation policy.
This grants no access to anyone else's projects. One active session per account,
a 12-hour session lifetime, and a 15-character password minimum are also prototype
implementation choices, not stakeholder-confirmed requirements.

## A repeatable API demo

With the backend running, open browser DevTools on localhost:5173. The following
uses fake test data, creates an account, logs in, creates a project/sheet and
saves an annotation. Restart the backend or change the email to repeat registration.

```js
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Punchlist-Request': '1' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}
await api('/auth/register', 'POST', {
  email: 'demo@example.com', password: 'class demo passphrase 123!',
  name: 'Demo Student', company: 'Example Construction', title: 'Inspector',
});
await api('/auth/login', 'POST', {
  email: 'demo@example.com', password: 'class demo passphrase 123!',
});
const project = await api('/projects', 'POST', { name: 'Demo site' });
const sheet = await api(`/projects/${project.id}/sheets`, 'POST');
await api('/annotations/demo-pin', 'PUT', {
  id: 'demo-pin', sheetId: sheet.id, kind: 'pin', x: 10, y: 20,
  payload: { label: 'Repair door', status: 'open' },
});
console.log(await api(`/sheets/${sheet.id}/annotations`));
await api('/auth/logout', 'POST');
// Now this must fail with 401:
await api(`/sheets/${sheet.id}/annotations`);
```

## Handoff to Fawaz and Saumya

Fawaz's PostgreSQL integration needs: users (unique normalized email and password
hash/salt/algorithm/iteration metadata), sessions (token digest, user, expiry),
projects, project memberships (unique project/user), sheets with project foreign
keys, and annotations with sheet foreign keys and payload JSONB. Preserve the
atomic ownership checks when replacing the process mutex with database transactions.
Do not add a global role field to users. Persist session expiry and revocation.
The current maps are prototype storage, not a database migration specification.

Joey/Saumya's frontend integration needs: registration/login forms using the auth
port; project selection; admin membership controls; imported PDF page-to-sheet
mapping using server sheet IDs; logout resetting editor history and displayed
project data; role-aware controls and visible 401/403 errors. Only then change
the default repository to HttpAnnotationRepository. The current `filename#page`
identity must not be used for shared projects because names can collide.

Pending features: membership removal, password recovery/change, email verification,
comment/photo endpoints, persistent import lists, and audit history. The current
rate limiter is process-local (20 auth requests/minute/source IP); a reverse
proxy requires a deliberate trusted-client-IP policy and a deployment-level
limit. No browser/iPad/end-to-end login-form verification is claimed.

## Security decisions

Passwords use Go's standard-library PBKDF2-HMAC-SHA256, random per-account salts,
and 600,000 iterations; password inputs are bounded at 1024 bytes. Raw passwords
are never returned or stored. Sessions are random opaque values; the server stores
only a SHA-256 digest. Cookies are HttpOnly, SameSite=Strict, and Secure outside
explicit localhost development mode. Unknown-account and wrong-password login
responses match. Registration returns 409 for an existing email.

References: [Go PBKDF2](https://go.dev/pkg/crypto/pbkdf2/),
[Go cookies](https://pkg.go.dev/net/http#Cookie),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Tests

```sh
cd backend
go test -race -cover ./...
go vet ./...
```

```sh
cd web
npm ci
npm test
npm run verify
npm run build
npm run lint
```

`backend/auth_test.go` exercises actual HTTP handlers using httptest, including
registration validation, role injection, cookie flags, login failure, token
rotation/tampering, logout/expiry, unauthenticated requests, the role matrix,
cross-project ID attacks, immediate role downgrades, last-admin protection,
annotation CRUD, CSRF, malformed/oversized bodies, rate limits and concurrent
writes. No database or AWS account is needed.

Vitest covers the HTTP auth/annotation adapters, undo/redo (including failed
writes), registry round trips, and coordinate-space guards. Coordinate adapter
tests use a known viewport fixture: they do not prove all PDF.js rotations or
physical tablet behavior. All 16 Vitest tests, 10 sealing checks and 18 rule/attribution checks passed on this integration. CI runs Go tests/vet and frontend tests/verify/build/lint.
