package main

// Integration tests for accounts, projects and permissions (SCRUM-42, 43, 46).
//
// They run the real routes against a real Postgres database, punchlist_test,
// which is wiped and rebuilt from schema.sql at the start of every run — never
// point TEST_DATABASE_URL at a database you care about. Create it once:
//
//	createdb -O postgres punchlist_test
//
// Without it every test is skipped (with the reason), not failed.
//
//	cd backend && go test ./...

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	server     *httptest.Server
	skipReason string
)

func TestMain(m *testing.M) {
	// Production cost makes every registration take a noticeable moment; the
	// tests register dozens of accounts. The format records the count, so
	// checkPassword is exercised exactly as in production.
	passwordIterations = 1_000

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:dev@localhost:5432/punchlist_test"
	}
	ctx := context.Background()
	var err error
	db, err = pgxpool.New(ctx, dsn)
	if err == nil {
		err = db.Ping(ctx)
	}
	if err != nil {
		skipReason = "no test database (createdb -O postgres punchlist_test): " + err.Error()
		os.Exit(m.Run())
	}

	// A clean slate every run, so tests never see each other's leftovers.
	_, err = db.Exec(ctx, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
	if err == nil {
		var schema []byte
		schema, err = os.ReadFile("schema.sql")
		if err == nil {
			_, err = db.Exec(ctx, string(schema))
		}
	}
	if err == nil {
		err = migrate(ctx)
	}
	if err == nil {
		// Twice, as every restart of the server does: it must be idempotent.
		err = migrate(ctx)
	}
	if err != nil {
		fmt.Println("cannot load schema into the test database:", err)
		os.Exit(1)
	}

	server = httptest.NewServer(routes())
	code := m.Run()
	server.Close()
	db.Close()
	os.Exit(code)
}

// --- helpers -----------------------------------------------------------------

// browser is one signed-in (or not) browser: its own cookie jar.
type browser struct {
	t      *testing.T
	client *http.Client
	user   Profile
}

func newBrowser(t *testing.T) *browser {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
	jar, _ := cookiejar.New(nil)
	return &browser{t: t, client: &http.Client{Jar: jar}}
}

type reply struct {
	status int
	body   []byte
	header http.Header
}

func (r reply) json(v any) {
	_ = json.Unmarshal(r.body, v)
}

func (r reply) errorText() string {
	var e struct{ Error string }
	_ = json.Unmarshal(r.body, &e)
	return e.Error
}

// call sends a request as the app would, with the anti-forgery header.
func (b *browser) call(method, path string, body any) reply {
	return b.send(method, path, body, map[string]string{"X-Punchlist-Request": "1"})
}

func (b *browser) send(method, path string, body any, headers map[string]string) reply {
	b.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			b.t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, server.URL+path, reader)
	if err != nil {
		b.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := b.client.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return reply{status: res.StatusCode, body: raw, header: res.Header}
}

func expect(t *testing.T, r reply, status int, what string) {
	t.Helper()
	if r.status != status {
		t.Fatalf("%s: got %d %s, want %d", what, r.status, strings.TrimSpace(string(r.body)), status)
	}
}

// signedOutOf reports whether /api/auth/me says nobody is signed in: 200 null.
func signedOutOf(t *testing.T, b *browser, what string) {
	t.Helper()
	r := b.call("GET", "/api/auth/me", nil)
	if r.status != 200 || strings.TrimSpace(string(r.body)) != "null" {
		t.Fatalf("%s: want 200 null from /api/auth/me, got %d %s", what, r.status, strings.TrimSpace(string(r.body)))
	}
}

// signedInTo reports whether /api/auth/me names an account.
func signedInTo(t *testing.T, b *browser, what string) Profile {
	t.Helper()
	r := b.call("GET", "/api/auth/me", nil)
	var p Profile
	r.json(&p)
	if r.status != 200 || p.ID == "" {
		t.Fatalf("%s: want a signed-in profile from /api/auth/me, got %d %s", what, r.status, strings.TrimSpace(string(r.body)))
	}
	return p
}

var emailCounter atomic.Int64

func uniqueEmail(name string) string {
	return fmt.Sprintf("%s.%d@example.test", strings.ToLower(name), emailCounter.Add(1))
}

const goodPassword = "correct horse battery staple"

// signUp registers a fresh account and leaves the browser signed in.
func signUp(t *testing.T, name string) *browser {
	t.Helper()
	b := newBrowser(t)
	limiter.reset()
	r := b.call("POST", "/api/auth/register", map[string]string{
		"email": uniqueEmail(name), "password": goodPassword,
		"displayName": name, "company": name + " Co", "title": "Inspector",
	})
	expect(t, r, 201, "register "+name)
	r.json(&b.user)
	return b
}

func (l *authLimiter) reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.attempts = map[string]*window{}
}

// newProject creates a project owned (administered) by b.
func (b *browser) newProject(name string) int {
	b.t.Helper()
	r := b.call("POST", "/api/projects", map[string]string{"name": name})
	expect(b.t, r, 201, "create project")
	var p ProjectSummary
	r.json(&p)
	return p.ID
}

// add puts other on the project with a role, as its admin b.
func (b *browser) add(projectID int, other *browser, role Role) {
	b.t.Helper()
	r := b.call("PUT", fmt.Sprintf("/api/projects/%d/members", projectID),
		map[string]string{"email": other.user.Email, "role": string(role)})
	expect(b.t, r, 200, "add "+other.user.DisplayName+" as "+string(role))
}

func sheet(projectID int, name string) string {
	return fmt.Sprintf("p%d:%s#0", projectID, name)
}

func markup(id, sheetID, kind string) map[string]any {
	return map[string]any{
		"id": id, "sheetId": sheetID, "kind": kind,
		"createdAt": "2026-10-17T12:00:00Z", "x": 10, "y": 20,
		"payload": map[string]any{"text": "Patch drywall"},
	}
}

func annotationPath(id string) string { return "/api/annotations/" + url.PathEscape(id) }

func sheetPath(sheetID, rest string) string {
	return "/api/sheets/" + url.PathEscape(sheetID) + rest
}

// =============================================================================
// SCRUM-42 — accounts and sign-in
// =============================================================================

func TestRegisterSignsInAndNormalisesEmail(t *testing.T) {
	b := newBrowser(t)
	limiter.reset()
	email := uniqueEmail("Mixed")
	r := b.call("POST", "/api/auth/register", map[string]string{
		"email": "  " + strings.ToUpper(email) + " ", "password": goodPassword,
		"displayName": " Jo Rivera ", "company": "Apex Electrical", "title": "Foreman",
	})
	expect(t, r, 201, "register")

	var p Profile
	r.json(&p)
	if p.Email != email || p.DisplayName != "Jo Rivera" || p.Company != "Apex Electrical" || p.Title != "Foreman" {
		t.Fatalf("profile not cleaned: %+v", p)
	}
	if strings.Contains(string(r.body), "password") {
		t.Fatal("the password (or its hash) must never be sent back")
	}

	cookie := r.header.Get("Set-Cookie")
	for _, flag := range []string{"punchlist_session=", "HttpOnly", "SameSite=Strict", "Path=/api"} {
		if !strings.Contains(cookie, flag) {
			t.Errorf("session cookie missing %q: %s", flag, cookie)
		}
	}
	if strings.Contains(cookie, "Secure") {
		t.Error("plain-http development must not get a Secure cookie, or sign-in silently fails there")
	}

	signedInTo(t, b, "signed in straight after registering")
}

func TestRegisterRefusesBadInput(t *testing.T) {
	b := newBrowser(t)
	cases := map[string]map[string]any{
		"bad email":      {"email": "not-an-email", "password": goodPassword, "displayName": "A", "company": "B"},
		"short password": {"email": uniqueEmail("x"), "password": "fourteen chars", "displayName": "A", "company": "B"},
		"no name":        {"email": uniqueEmail("x"), "password": goodPassword, "displayName": "  ", "company": "B"},
		"no company":     {"email": uniqueEmail("x"), "password": goodPassword, "displayName": "A", "company": ""},
		"huge password":  {"email": uniqueEmail("x"), "password": strings.Repeat("a", 1025), "displayName": "A", "company": "B"},
		"sneaky role":    {"email": uniqueEmail("x"), "password": goodPassword, "displayName": "A", "company": "B", "role": "admin"},
	}
	for name, body := range cases {
		limiter.reset()
		r := b.call("POST", "/api/auth/register", body)
		expect(t, r, 400, name)
		if r.errorText() == "" {
			t.Errorf("%s: no message for the form to show", name)
		}
	}
}

func TestRegisterTwiceIsAConflictWhateverTheCase(t *testing.T) {
	first := signUp(t, "Dup")
	b := newBrowser(t)
	r := b.call("POST", "/api/auth/register", map[string]string{
		"email": strings.ToUpper(first.user.Email), "password": goodPassword,
		"displayName": "Someone Else", "company": "Other",
	})
	expect(t, r, 409, "same email, different case")
}

func TestLoginLogoutAndTheSameAnswerForUnknownAccounts(t *testing.T) {
	owner := signUp(t, "Login")
	b := newBrowser(t)

	wrong := b.call("POST", "/api/auth/login", map[string]string{"email": owner.user.Email, "password": "wrong password, but long"})
	unknown := b.call("POST", "/api/auth/login", map[string]string{"email": uniqueEmail("nobody"), "password": goodPassword})
	expect(t, wrong, 401, "wrong password")
	expect(t, unknown, 401, "unknown account")
	if wrong.errorText() != unknown.errorText() {
		t.Fatalf("unknown and wrong must read the same: %q vs %q", wrong.errorText(), unknown.errorText())
	}
	signedOutOf(t, b, "still signed out")

	r := b.call("POST", "/api/auth/login", map[string]string{"email": strings.ToUpper(owner.user.Email), "password": goodPassword})
	expect(t, r, 200, "login, email in capitals")
	signedInTo(t, b, "me after login")

	// Grab the cookie value so it can be replayed after logout.
	u, _ := url.Parse(server.URL + "/api")
	stolen := b.client.Jar.Cookies(u)

	expect(t, b.call("POST", "/api/auth/logout", nil), 204, "logout")
	signedOutOf(t, b, "me after logout")

	replay := newBrowser(t)
	replay.client.Jar.SetCookies(u, stolen)
	signedOutOf(t, replay, "a signed-out cookie is dead on the server, not just deleted in the browser")

	// The other browser the owner signed in on is unaffected.
	signedInTo(t, owner, "other sessions survive one logout")
}

func TestTamperedAndExpiredSessionsAreRefused(t *testing.T) {
	b := signUp(t, "Expiry")
	u, _ := url.Parse(server.URL + "/api")

	forged := newBrowser(t)
	forged.client.Jar.SetCookies(u, []*http.Cookie{{Name: sessionCookie, Value: "made-up-token", Path: "/api"}})
	signedOutOf(t, forged, "forged cookie")

	_, err := db.Exec(context.Background(),
		`UPDATE sessions SET expires_at = now() - interval '1 minute'
		 WHERE user_id = (SELECT id FROM users WHERE email = $1)`, b.user.Email)
	if err != nil {
		t.Fatal(err)
	}
	signedOutOf(t, b, "expired session")
}

func TestStoredSessionIsADigestNotTheCookie(t *testing.T) {
	b := signUp(t, "Digest")
	u, _ := url.Parse(server.URL + "/api")
	value := b.client.Jar.Cookies(u)[0].Value

	var n int
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM sessions WHERE token_hash = $1`, value).Scan(&n)
	if n != 0 {
		t.Fatal("the raw cookie value must never be stored")
	}
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM sessions WHERE token_hash = $1`, tokenDigest(value)).Scan(&n)
	if n != 1 {
		t.Fatal("the digest should be stored")
	}
}

func TestPasswordHashing(t *testing.T) {
	h, err := hashPassword(goodPassword)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "pbkdf2_sha256$1000$") {
		t.Fatalf("unexpected format %q", h)
	}
	if !checkPassword(goodPassword, h) {
		t.Fatal("right password rejected")
	}
	if checkPassword(goodPassword+" ", h) {
		t.Fatal("wrong password accepted")
	}
	h2, _ := hashPassword(goodPassword)
	if h == h2 {
		t.Fatal("two hashes of one password must differ (random salt)")
	}
	for _, broken := range []string{"", "plain", "pbkdf2_sha256$x$y$z", "bcrypt$1$a$b", "pbkdf2_sha256$0$AA$AA"} {
		if checkPassword(goodPassword, broken) {
			t.Fatalf("malformed hash %q matched", broken)
		}
	}
}

func TestStateChangesNeedTheAppHeader(t *testing.T) {
	b := newBrowser(t)
	limiter.reset()
	r := b.send("POST", "/api/auth/register", map[string]string{
		"email": uniqueEmail("csrf"), "password": goodPassword, "displayName": "A", "company": "B",
	}, nil)
	expect(t, r, 403, "register without X-Punchlist-Request")

	owner := signUp(t, "Csrf")
	p := owner.newProject("Forgery target")
	r = owner.send("PUT", annotationPath("forged"), markup("forged", sheet(p, "a.pdf"), "pin"), nil)
	expect(t, r, 403, "a signed-in browser's cookie alone cannot write")

	// Reads are unaffected — the header only guards changes.
	expect(t, owner.send("GET", "/api/projects", nil, nil), 200, "GET without the header")
}

func TestSignInAttemptsAreRateLimited(t *testing.T) {
	b := newBrowser(t)
	limiter.reset()
	defer limiter.reset()
	for i := 0; i < authAttemptsPerMinute; i++ {
		b.call("POST", "/api/auth/login", map[string]string{"email": "x@example.test", "password": "guess"})
	}
	r := b.call("POST", "/api/auth/login", map[string]string{"email": "x@example.test", "password": "guess"})
	expect(t, r, 429, "attempt past the limit")
	if r.header.Get("Retry-After") == "" {
		t.Error("tell the client when to try again")
	}
}

func TestEverythingNeedsASession(t *testing.T) {
	anon := newBrowser(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/projects"},
		{"GET", "/api/session"},
		{"GET", sheetPath("p1:a.pdf#0", "/annotations")},
		{"PUT", annotationPath("x")},
		{"DELETE", annotationPath("x")},
		{"GET", "/api/exports?document=a.pdf"},
		{"GET", "/api/exports/sealed?document=a.pdf&sheetId=p1:a.pdf%230"},
	} {
		var body any
		if c.method == "PUT" {
			body = markup("x", "p1:a.pdf#0", "pin")
		}
		expect(t, anon.call(c.method, c.path, body), 401, c.method+" "+c.path)
	}
	expect(t, anon.call("GET", "/api/health", nil), 200, "health stays open for the load balancer")
}

// =============================================================================
// SCRUM-43 — projects, members, roles
// =============================================================================

func TestCreatorAdministersTheirProjectAndNobodyElses(t *testing.T) {
	alice := signUp(t, "Alice")
	bob := signUp(t, "Bob")
	p := alice.newProject("  Engineering Building  ")

	var list []ProjectSummary
	alice.call("GET", "/api/projects", nil).json(&list)
	if len(list) != 1 || list[0].ID != p || list[0].Role != RoleAdmin || list[0].Name != "Engineering Building" {
		t.Fatalf("alice's projects: %+v", list)
	}

	bob.call("GET", "/api/projects", nil).json(&list)
	if len(list) != 0 {
		t.Fatalf("bob sees someone else's project: %+v", list)
	}
	expect(t, bob.call("GET", fmt.Sprintf("/api/projects/%d/members", p), nil), 403, "outsider lists members")
	expect(t, bob.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": bob.user.Email, "role": "admin"}), 403, "outsider adds himself as admin")
	expect(t, bob.call("GET", "/api/projects/999999/members", nil), 403, "a missing project looks like a forbidden one")
	expect(t, alice.call("POST", "/api/projects", map[string]string{"name": "   "}), 400, "blank project name")
}

func TestAdminAddsPeopleAndSetsRoles(t *testing.T) {
	admin := signUp(t, "Admin")
	power := signUp(t, "Power")
	collab := signUp(t, "Collab")
	p := admin.newProject("Roles")

	admin.add(p, power, RolePower)
	admin.add(p, collab, RoleCollaborator)

	var members []Member
	collab.call("GET", fmt.Sprintf("/api/projects/%d/members", p), nil).json(&members)
	if len(members) != 3 || members[0].Role != RoleAdmin || members[1].Role != RolePower || members[2].Role != RoleCollaborator {
		t.Fatalf("members, admins first: %+v", members)
	}

	r := admin.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": uniqueEmail("ghost"), "role": "collaborator"})
	expect(t, r, 404, "no account with that email")
	if !strings.Contains(r.errorText(), "create one") {
		t.Errorf("tell the admin what to do: %q", r.errorText())
	}
	expect(t, admin.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": collab.user.Email, "role": "owner"}), 400, "unknown role")

	// Only admins manage people.
	expect(t, power.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": collab.user.Email, "role": "admin"}), 403, "power collaborator promotes someone")
	expect(t, collab.call("DELETE", fmt.Sprintf("/api/projects/%d/members/%s", p, power.user.ID), nil), 403, "collaborator removes someone")

	// The role is per project, and /api/session reports the right one.
	var actor Actor
	collab.call("GET", fmt.Sprintf("/api/session?project=%d", p), nil).json(&actor)
	if actor.Role != "collaborator" || actor.DisplayName != "Collab" || actor.ID != collab.user.ID {
		t.Fatalf("session actor: %+v", actor)
	}
	other := collab.newProject("Collab's own")
	collab.call("GET", fmt.Sprintf("/api/session?project=%d", other), nil).json(&actor)
	if actor.Role != "admin" {
		t.Fatalf("admin of their own project: %+v", actor)
	}
	admin.call("GET", fmt.Sprintf("/api/session?project=%d", other), nil).json(&actor)
	if actor.Role != "" {
		t.Fatalf("no role on a project you are not on: %+v", actor)
	}

	// Removal.
	expect(t, admin.call("DELETE", fmt.Sprintf("/api/projects/%d/members/%s", p, collab.user.ID), nil), 204, "remove")
	expect(t, collab.call("GET", fmt.Sprintf("/api/projects/%d/members", p), nil), 403, "removed person loses access at once")
	expect(t, admin.call("DELETE", fmt.Sprintf("/api/projects/%d/members/%s", p, collab.user.ID), nil), 404, "remove twice")
}

func TestAProjectAlwaysKeepsAnAdmin(t *testing.T) {
	admin := signUp(t, "Solo")
	second := signUp(t, "Second")
	p := admin.newProject("Keep an admin")

	r := admin.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": admin.user.Email, "role": "collaborator"})
	expect(t, r, 409, "the only admin demotes themselves")
	expect(t, admin.call("DELETE", fmt.Sprintf("/api/projects/%d/members/%s", p, admin.user.ID), nil), 409, "the only admin leaves")

	admin.add(p, second, RoleAdmin)
	r = admin.call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
		map[string]string{"email": admin.user.Email, "role": "power_collaborator"})
	expect(t, r, 200, "with a second admin, stepping down is fine")
}

func TestTwoAdminsDemotingEachOtherAtOnceLeaveOne(t *testing.T) {
	a := signUp(t, "RaceA")
	b := signUp(t, "RaceB")
	p := a.newProject("Race")
	a.add(p, b, RoleAdmin)

	var wg sync.WaitGroup
	results := make([]int, 2)
	for i, pair := range [][2]*browser{{a, b}, {b, a}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = pair[0].call("PUT", fmt.Sprintf("/api/projects/%d/members", p),
				map[string]string{"email": pair[1].user.Email, "role": "collaborator"}).status
		}()
	}
	wg.Wait()

	var admins int
	_ = db.QueryRow(context.Background(),
		`SELECT count(*) FROM memberships WHERE project_id = $1 AND role = 'admin'`, p).Scan(&admins)
	if admins != 1 {
		t.Fatalf("after simultaneous demotions (%v) the project has %d admins", results, admins)
	}
}

// =============================================================================
// SCRUM-46 — the server refuses what a role does not allow
// =============================================================================

// team is one project with one person in each role, plus an outsider.
type team struct {
	project                        int
	sheet                          string
	admin, power, collab, outsider *browser
}

func newTeam(t *testing.T) team {
	tm := team{
		admin: signUp(t, "TeamAdmin"), power: signUp(t, "TeamPower"),
		collab: signUp(t, "TeamCollab"), outsider: signUp(t, "Outsider"),
	}
	tm.project = tm.admin.newProject("Team")
	tm.admin.add(tm.project, tm.power, RolePower)
	tm.admin.add(tm.project, tm.collab, RoleCollaborator)
	tm.sheet = sheet(tm.project, "A-101.pdf")
	return tm
}

func TestRoleMatrixForMarkups(t *testing.T) {
	tm := newTeam(t)
	put := func(b *browser, id, kind string) reply {
		return b.call("PUT", annotationPath(id), markup(id, tm.sheet, kind))
	}

	expect(t, put(tm.admin, "m-admin", "pin"), 204, "admin adds a pin")
	expect(t, put(tm.power, "m-power", "cloud"), 204, "power collaborator adds a cloud")
	expect(t, put(tm.power, "m-admin", "pin"), 204, "power collaborator edits the admin's pin")
	expect(t, put(tm.collab, "m-collab-photo", "photo"), 204, "collaborator adds a photo")

	expect(t, put(tm.collab, "m-collab-pin", "pin"), 403, "collaborator adds a pin")
	expect(t, put(tm.collab, "m-admin", "pin"), 403, "collaborator edits a pin")
	expect(t, put(tm.collab, "m-collab-photo", "photo"), 403, "collaborator edits even their own photo")
	expect(t, tm.collab.call("DELETE", annotationPath("m-power"), nil), 403, "collaborator deletes")
	expect(t, tm.collab.call("DELETE", sheetPath(tm.sheet, "/annotations"), nil), 403, "collaborator clears the sheet")

	expect(t, put(tm.outsider, "m-outsider", "pin"), 403, "outsider adds")
	expect(t, tm.outsider.call("GET", sheetPath(tm.sheet, "/annotations"), nil), 403, "outsider reads")
	expect(t, tm.outsider.call("DELETE", annotationPath("m-admin"), nil), 403, "outsider deletes")

	var list []Annotation
	r := tm.collab.call("GET", sheetPath(tm.sheet, "/annotations"), nil)
	expect(t, r, 200, "collaborator reads")
	r.json(&list)
	if len(list) != 3 {
		t.Fatalf("expected the three permitted markups, got %d", len(list))
	}

	expect(t, tm.power.call("DELETE", annotationPath("m-collab-photo"), nil), 204, "power collaborator deletes")
	expect(t, tm.power.call("DELETE", annotationPath("m-collab-photo"), nil), 404, "deleting twice")
	expect(t, tm.admin.call("DELETE", sheetPath(tm.sheet, "/annotations"), nil), 204, "admin clears")
}

func TestARoleChangeTakesEffectOnTheNextRequest(t *testing.T) {
	tm := newTeam(t)
	expect(t, tm.power.call("PUT", annotationPath("before"), markup("before", tm.sheet, "pin")), 204, "as power collaborator")
	tm.admin.add(tm.project, tm.power, RoleCollaborator)
	expect(t, tm.power.call("PUT", annotationPath("after"), markup("after", tm.sheet, "pin")), 403, "same session, now a collaborator")
}

func TestSheetsWithoutAProjectAreUnreachable(t *testing.T) {
	tm := newTeam(t)
	for _, id := range []string{"A-101.pdf#0", "p:A.pdf#0", "pX:A.pdf#0", "p0:A.pdf#0", "p01:A.pdf#0", fmt.Sprintf("p%d:", tm.project)} {
		expect(t, tm.admin.call("GET", sheetPath(id, "/annotations"), nil), 403, "read "+id)
		expect(t, tm.admin.call("PUT", annotationPath("legacy"), markup("legacy", id, "pin")), 403, "write "+id)
	}
}

func TestAMarkupCannotBeMovedIntoAnotherProject(t *testing.T) {
	victim := newTeam(t)
	expect(t, victim.admin.call("PUT", annotationPath("victim-pin"), markup("victim-pin", victim.sheet, "pin")), 204, "victim's pin")

	// An attacker who knows (or guesses) the id, writing it onto their own sheet.
	attacker := signUp(t, "Attacker")
	own := attacker.newProject("Attacker's")
	r := attacker.call("PUT", annotationPath("victim-pin"), markup("victim-pin", sheet(own, "x.pdf"), "pin"))
	expect(t, r, 403, "overwrite another project's markup via your own sheet")

}

func TestMovingBetweenSheetsIsRefusedEvenForAnAdminOfBoth(t *testing.T) {
	tm := newTeam(t)
	other := tm.admin.newProject("Second project")
	expect(t, tm.admin.call("PUT", annotationPath("mover"), markup("mover", tm.sheet, "pin")), 204, "create")
	r := tm.admin.call("PUT", annotationPath("mover"), markup("mover", sheet(other, "b.pdf"), "pin"))
	expect(t, r, 409, "move to a sheet in another project")
}

func TestChangeRecordsAreAttributedByTheServer(t *testing.T) {
	tm := newTeam(t)
	record := func(id, intent string) map[string]any {
		return map[string]any{
			"id": id, "annotationId": "a1", "sheetId": tm.sheet, "intent": intent,
			"at":    "2026-10-17T12:00:00.000Z",
			"actor": map[string]string{"id": "1", "displayName": "The CEO", "company": "Owner", "role": "admin"},
		}
	}
	expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), record("c1", "create")), 204, "collaborator records a create")
	expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), record("c2", "move")), 403, "collaborator records a move")
	expect(t, tm.power.call("POST", sheetPath(tm.sheet, "/changes"), record("c3", "move")), 204, "power collaborator records a move")
	expect(t, tm.outsider.call("POST", sheetPath(tm.sheet, "/changes"), record("c4", "create")), 403, "outsider records anything")

	var history []struct {
		ID    string
		Actor Actor
	}
	r := tm.admin.call("GET", sheetPath(tm.sheet, "/annotations/a1/changes"), nil)
	expect(t, r, 200, "history")
	r.json(&history)
	if len(history) != 2 {
		t.Fatalf("expected 2 records, got %d: %s", len(history), r.body)
	}
	for _, c := range history {
		if c.Actor.DisplayName == "The CEO" {
			t.Fatalf("record %s kept the actor the browser claimed", c.ID)
		}
	}
	byID := map[string]Actor{}
	for _, c := range history {
		byID[c.ID] = c.Actor
	}
	if a := byID["c1"]; a.DisplayName != "TeamCollab" || a.Role != "collaborator" || a.ID != tm.collab.user.ID {
		t.Fatalf("c1 attributed to %+v", a)
	}
	if a := byID["c3"]; a.DisplayName != "TeamPower" || a.Role != "power_collaborator" {
		t.Fatalf("c3 attributed to %+v", a)
	}
	expect(t, tm.outsider.call("GET", sheetPath(tm.sheet, "/changes/latest"), nil), 403, "outsider reads history")
}

func TestHistoryFromBeforeSignInStaysAnonymous(t *testing.T) {
	tm := newTeam(t)
	record := func(id string, actor map[string]string) map[string]any {
		return map[string]any{
			"id": id, "annotationId": "old", "sheetId": tm.sheet, "intent": "create",
			"at": "2026-09-30T12:00:00.000Z", "actor": actor,
		}
	}
	// Uploaded from a browser that saved it before accounts existed.
	expect(t, tm.admin.call("POST", sheetPath(tm.sheet, "/changes"),
		record("h1", map[string]string{"id": "anonymous", "displayName": "this device"})), 204, "anonymous history")
	// "Anonymous" with a name smuggled in is still just anonymous.
	expect(t, tm.admin.call("POST", sheetPath(tm.sheet, "/changes"),
		record("h2", map[string]string{"id": "anonymous", "displayName": "The CEO", "role": "admin"})), 204, "anonymous with a name")

	var history []struct {
		ID    string
		Actor Actor
	}
	tm.admin.call("GET", sheetPath(tm.sheet, "/annotations/old/changes"), nil).json(&history)
	if len(history) != 2 {
		t.Fatalf("expected 2 records, got %d", len(history))
	}
	for _, c := range history {
		if c.Actor != anonymousActor {
			t.Fatalf("%s: want the canonical anonymous actor, got %+v", c.ID, c.Actor)
		}
	}
}

func TestExportsBelongToAProject(t *testing.T) {
	tm := newTeam(t)
	export := func(id, mode string, sheets ...string) map[string]any {
		bySheet := map[string][]string{}
		for _, s := range sheets {
			bySheet[s] = []string{"m1"}
		}
		return map[string]any{
			"id": id, "documentName": "A-101.pdf", "mode": mode,
			"exportedAt": "2026-10-17T12:00:00.000Z", "exportedBy": "Somebody Else",
			"annotationIdsBySheet": bySheet,
		}
	}

	expect(t, tm.collab.call("POST", "/api/exports", export("e1", "flattened", tm.sheet)), 403, "collaborator seals")
	expect(t, tm.collab.call("POST", "/api/exports", export("e2", "native", tm.sheet)), 204, "collaborator records a working copy")
	expect(t, tm.power.call("POST", "/api/exports", export("e3", "flattened", tm.sheet)), 204, "power collaborator seals")
	expect(t, tm.outsider.call("POST", "/api/exports", export("e4", "native", tm.sheet)), 403, "outsider records")
	expect(t, tm.admin.call("POST", "/api/exports", export("e5", "native")), 400, "no sheets")
	expect(t, tm.admin.call("POST", "/api/exports", export("e6", "native", "A-101.pdf#0")), 403, "a sheet outside any project")
	other := tm.admin.newProject("Other")
	expect(t, tm.admin.call("POST", "/api/exports", export("e7", "native", tm.sheet, sheet(other, "b.pdf"))), 400, "two projects in one export")

	var list []ExportRecord
	tm.collab.call("GET", "/api/exports?document=A-101.pdf", nil).json(&list)
	if len(list) != 2 {
		t.Fatalf("project members see the project's 2 exports, got %d", len(list))
	}
	for _, e := range list {
		if e.ExportedBy == "Somebody Else" {
			t.Fatalf("exportedBy came from the browser: %+v", e)
		}
	}
	tm.outsider.call("GET", "/api/exports?document=A-101.pdf", nil).json(&list)
	if len(list) != 0 {
		t.Fatalf("an outsider sees another project's exports: %+v", list)
	}

	var sealed []string
	r := tm.collab.call("GET", "/api/exports/sealed?document=A-101.pdf&sheetId="+url.QueryEscape(tm.sheet), nil)
	expect(t, r, 200, "sealed ids")
	r.json(&sealed)
	if len(sealed) != 1 || sealed[0] != "m1" {
		t.Fatalf("sealed: %v", sealed)
	}
	expect(t, tm.outsider.call("GET", "/api/exports/sealed?document=A-101.pdf&sheetId="+url.QueryEscape(tm.sheet), nil), 403, "outsider reads seals")
}

func TestSessionsSurviveARestartOfTheServer(t *testing.T) {
	b := signUp(t, "Restart")
	// A new handler stack over the same database is what a restart is.
	fresh := httptest.NewServer(routes())
	defer fresh.Close()
	u, _ := url.Parse(server.URL + "/api")
	req, _ := http.NewRequest("GET", fresh.URL+"/api/auth/me", nil)
	for _, c := range b.client.Jar.Cookies(u) {
		req.AddCookie(c)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var p Profile
	_ = json.NewDecoder(res.Body).Decode(&p)
	if res.StatusCode != 200 || p.ID != b.user.ID {
		t.Fatalf("session lost across restart: %d %+v", res.StatusCode, p)
	}
}

func TestTheProjectPunchListCoversEveryDrawingAndOnlyThatProject(t *testing.T) {
	tm := newTeam(t)
	other := newTeam(t)
	put := func(b *browser, id, sheetID string) {
		expect(t, b.call("PUT", annotationPath(id), markup(id, sheetID, "pin")), 204, "put "+id)
	}
	put(tm.admin, "list-a1", sheet(tm.project, "A-101.pdf"))
	put(tm.admin, "list-b1", fmt.Sprintf("p%d:B-201.pdf#3", tm.project))
	put(other.admin, "list-x1", sheet(other.project, "A-101.pdf"))

	var items []Annotation
	r := tm.collab.call("GET", fmt.Sprintf("/api/projects/%d/items", tm.project), nil)
	expect(t, r, 200, "a collaborator reads the project's punch list")
	r.json(&items)
	ids := []string{}
	for _, a := range items {
		ids = append(ids, a.ID)
	}
	if strings.Join(ids, ",") != "list-a1,list-b1" {
		t.Fatalf("want both drawings of this project and nothing else, got %v", ids)
	}
	expect(t, tm.outsider.call("GET", fmt.Sprintf("/api/projects/%d/items", tm.project), nil), 403, "an outsider reads it")
}
