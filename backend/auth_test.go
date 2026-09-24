package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testPassword = "a long test passphrase 123!"

type harness struct {
	t       *testing.T
	app     *application
	handler http.Handler
}

func setup(t *testing.T) *harness {
	t.Helper()
	a := newApplication("http://localhost:5173", true)
	return &harness{t, a, a.routes()}
}
func (h *harness) request(method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	h.t.Helper()
	var b bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&b).Encode(body); err != nil {
			h.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &b)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Punchlist-Request", "1")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res := httptest.NewRecorder()
	h.handler.ServeHTTP(res, req)
	return res
}
func status(t *testing.T, r *httptest.ResponseRecorder, want int) {
	t.Helper()
	if r.Code != want {
		t.Fatalf("status=%d want=%d body=%s", r.Code, want, r.Body.String())
	}
}
func bodyMap(t *testing.T, r *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func (h *harness) register(email string) *httptest.ResponseRecorder {
	return h.request("POST", "/api/auth/register", map[string]string{"email": email, "password": testPassword, "name": "Tester", "company": "Construction Co", "title": "Engineer"}, nil)
}
func (h *harness) login(email string) *http.Cookie {
	h.t.Helper()
	r := h.request("POST", "/api/auth/login", map[string]string{"email": email, "password": testPassword}, nil)
	status(h.t, r, 200)
	return r.Result().Cookies()[0]
}
func (h *harness) user(email string) *http.Cookie {
	h.t.Helper()
	status(h.t, h.register(email), 201)
	return h.login(email)
}
func (h *harness) project(cookie *http.Cookie) string {
	h.t.Helper()
	r := h.request("POST", "/api/projects", map[string]string{"name": "Site A"}, cookie)
	status(h.t, r, 201)
	return bodyMap(h.t, r)["id"].(string)
}
func (h *harness) sheet(cookie *http.Cookie, pid string) string {
	h.t.Helper()
	r := h.request("POST", "/api/projects/"+pid+"/sheets", nil, cookie)
	status(h.t, r, 201)
	return bodyMap(h.t, r)["id"].(string)
}
func (h *harness) member(cookie *http.Cookie, pid, email string, r role) *httptest.ResponseRecorder {
	return h.request("PUT", "/api/projects/"+pid+"/members", map[string]string{"email": email, "role": string(r)}, cookie)
}
func annotation(sid string) map[string]any {
	return map[string]any{"sheetId": sid, "kind": "pin", "x": 42, "y": 57, "payload": map[string]any{"status": "open"}}
}

func TestAccountSessionLifecycle(t *testing.T) {
	h := setup(t)
	r := h.register("  Person@Example.com  ")
	status(t, r, 201)
	if strings.Contains(r.Body.String(), "password") || strings.Contains(r.Body.String(), "Hash") || strings.Contains(r.Body.String(), testPassword) {
		t.Fatal("credential material leaked")
	}
	if len(r.Result().Cookies()) != 0 {
		t.Fatal("registration must not silently log in")
	}
	user := h.app.users["person@example.com"]
	if bytes.Equal(user.Hash, []byte(testPassword)) || len(user.Salt) == 0 {
		t.Fatal("password not salted and hashed")
	}
	status(t, h.register("person@example.com"), 409)
	cookie := h.login("PERSON@example.com")
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api" {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
	if _, exists := h.app.sessions[cookie.Value]; exists {
		t.Fatal("raw token stored on server")
	}
	status(t, h.request("GET", "/api/auth/me", nil, cookie), 200)
	projects := h.request("GET", "/api/projects", nil, cookie)
	status(t, projects, 200)
	if strings.TrimSpace(projects.Body.String()) != "[]" {
		t.Fatal("registration granted project access")
	}
	for _, email := range []string{"person@example.com", "unknown@example.com"} {
		bad := h.request("POST", "/api/auth/login", map[string]string{"email": email, "password": "wrong password"}, nil)
		status(t, bad, 401)
		if bodyMap(t, bad)["error"] != "invalid email or password" {
			t.Fatal("login discloses account existence")
		}
	}
	rotated := h.login("person@example.com")
	if cookie.Value == rotated.Value {
		t.Fatal("login did not rotate session")
	}
	status(t, h.request("GET", "/api/auth/me", nil, cookie), 401)
	status(t, h.request("POST", "/api/auth/logout", nil, rotated), 204)
	status(t, h.request("GET", "/api/auth/me", nil, rotated), 401)
	cookie = h.login("person@example.com")
	h.app.now = func() time.Time { return time.Now().Add(sessionLifetime + time.Minute) }
	status(t, h.request("GET", "/api/auth/me", nil, cookie), 401)
}
func TestRegistrationValidationAndRoleInjection(t *testing.T) {
	for _, change := range []map[string]string{{"email": "invalid"}, {"password": "short"}, {"name": " "}, {"company": ""}, {"title": ""}, {"role": "admin"}} {
		t.Run(fmt.Sprint(change), func(t *testing.T) {
			h := setup(t)
			body := map[string]string{"email": "a@example.com", "password": testPassword, "name": "A", "company": "B", "title": "C"}
			for k, v := range change {
				body[k] = v
			}
			status(t, h.request("POST", "/api/auth/register", body, nil), 400)
			if len(h.app.users) != 0 {
				t.Fatal("invalid input created account")
			}
		})
	}
}
func TestAnonymousRoutes(t *testing.T) {
	h := setup(t)
	for _, route := range [][2]string{{"GET", "/api/auth/me"}, {"GET", "/api/projects"}, {"POST", "/api/projects"}, {"PUT", "/api/projects/p/members"}, {"POST", "/api/projects/p/sheets"}, {"DELETE", "/api/projects/p/sheets/s"}, {"GET", "/api/sheets/s/annotations"}, {"DELETE", "/api/sheets/s/annotations"}, {"PUT", "/api/annotations/x"}, {"DELETE", "/api/annotations/x"}} {
		t.Run(route[0]+route[1], func(t *testing.T) { status(t, h.request(route[0], route[1], nil, nil), 401) })
	}
}
func TestProjectRolesAndAnnotationIsolation(t *testing.T) {
	h := setup(t)
	owner := h.user("owner@example.com")
	editor := h.user("editor@example.com")
	reader := h.user("reader@example.com")
	outsider := h.user("outsider@example.com")
	pid := h.project(owner)
	sid := h.sheet(owner, pid)
	status(t, h.member(owner, pid, "editor@example.com", power), 204)
	status(t, h.member(owner, pid, "reader@example.com", collaborator), 204)
	status(t, h.member(owner, pid, "reader@example.com", "inspector"), 400)
	status(t, h.member(reader, pid, "reader@example.com", admin), 403)
	status(t, h.member(owner, pid, "owner@example.com", collaborator), 409)
	for _, tc := range []struct {
		name               string
		cookie             *http.Cookie
		read, write, sheet int
	}{{"admin", owner, 200, 204, 201}, {"power", editor, 200, 204, 403}, {"collaborator", reader, 200, 403, 403}, {"outsider", outsider, 403, 403, 403}} {
		t.Run(tc.name, func(t *testing.T) {
			status(t, h.request("GET", "/api/sheets/"+sid+"/annotations", nil, tc.cookie), tc.read)
			status(t, h.request("PUT", "/api/annotations/"+tc.name, annotation(sid), tc.cookie), tc.write)
			status(t, h.request("POST", "/api/projects/"+pid+"/sheets", nil, tc.cookie), tc.sheet)
			status(t, h.request("DELETE", "/api/annotations/admin", nil, reader), 403)
			status(t, h.request("DELETE", "/api/sheets/"+sid+"/annotations", nil, reader), 403)
		})
	}
	// Being an admin in B grants no privileges in A. An existing ID cannot be stolen.
	otherPID := h.project(outsider)
	otherSID := h.sheet(outsider, otherPID)
	status(t, h.request("PUT", "/api/annotations/admin", annotation(otherSID), outsider), 403)
	status(t, h.request("PUT", "/api/annotations/foreign", annotation(sid), outsider), 403)
	status(t, h.request("DELETE", "/api/annotations/admin", nil, outsider), 403)
	status(t, h.request("DELETE", "/api/projects/"+otherPID+"/sheets/"+sid, nil, outsider), 404)
	// Ownership cannot be moved even by a user with edit access to both sheets.
	sid2 := h.sheet(owner, pid)
	status(t, h.request("PUT", "/api/annotations/admin", annotation(sid2), owner), 409)
	// Downgrades take effect on an existing session immediately.
	status(t, h.member(owner, pid, "editor@example.com", collaborator), 204)
	status(t, h.request("PUT", "/api/annotations/power", annotation(sid), editor), 403)
	status(t, h.request("DELETE", "/api/annotations/admin", nil, owner), 204)
	status(t, h.request("DELETE", "/api/annotations/admin", nil, owner), 404)
	status(t, h.request("DELETE", "/api/sheets/"+sid+"/annotations", nil, owner), 204)
	if len(h.app.annotations) != 0 {
		t.Fatal("clear did not remove annotations")
	}
}
func TestAnnotationContract(t *testing.T) {
	h := setup(t)
	cookie := h.user("owner@example.com")
	pid := h.project(cookie)
	sid := h.sheet(cookie, pid)
	input := annotation(sid)
	input["id"] = "spoofed"
	input["createdAt"] = "spoofed"
	status(t, h.request("PUT", "/api/annotations/real", input, cookie), 204)
	original := h.app.annotations["real"].CreatedAt
	if original == "spoofed" || original == "" {
		t.Fatal("creation date must be server assigned")
	}
	input["x"] = 100
	status(t, h.request("PUT", "/api/annotations/real", input, cookie), 204)
	r := h.request("GET", "/api/sheets/"+sid+"/annotations", nil, cookie)
	status(t, r, 200)
	var items []Annotation
	if err := json.Unmarshal(r.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "real" || items[0].X != 100 || items[0].CreatedAt != original {
		t.Fatalf("bad roundtrip: %+v", items)
	}
	status(t, h.request("DELETE", "/api/projects/"+pid+"/sheets/"+sid, nil, cookie), 204)
	if len(h.app.annotations) != 0 {
		t.Fatal("sheet deletion left annotations")
	}
	status(t, h.request("GET", "/api/sheets/"+sid+"/annotations", nil, cookie), 403)
	status(t, h.request("GET", "/api/sheets/anything", nil, cookie), 404)
}
func TestCSRFAndInputBoundaries(t *testing.T) {
	h := setup(t)
	for _, tc := range []struct {
		name, origin, header, body, contentType string
		want                                    int
	}{
		{"no header", "", "", `{}`, "application/json", 403},
		{"foreign origin", "https://evil.example", "1", `{}`, "application/json", 403},
		{"bad JSON", "", "1", `{`, "application/json", 400},
		{"trailing JSON", "", "1", `{} {}`, "application/json", 400},
		{"text content", "", "1", `{}`, "text/plain", 415},
		{"too large", "", "1", strings.Repeat(" ", 1<<20) + `{}`, "application/json", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(tc.body))
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-Punchlist-Request", tc.header)
			req.Header.Set("Content-Type", tc.contentType)
			r := httptest.NewRecorder()
			h.handler.ServeHTTP(r, req)
			status(t, r, tc.want)
		})
	}
}
func TestAuthRateLimit(t *testing.T) {
	h := setup(t)
	for i := 0; i < 20; i++ {
		status(t, h.request("POST", "/api/auth/login", nil, nil), 400)
	}
	r := h.request("POST", "/api/auth/login", nil, nil)
	status(t, r, 429)
	if r.Header().Get("Retry-After") == "" {
		t.Fatal("missing retry guidance")
	}
	h.app.now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	status(t, h.request("POST", "/api/auth/login", nil, nil), 400)
}

func TestTamperedSessionAndLogoutCookie(t *testing.T) {
	h := setup(t)
	cookie := h.user("a@example.com")
	bad := *cookie
	bad.Value += "tampered"
	status(t, h.request("GET", "/api/auth/me", nil, &bad), 401)
	response := h.request("POST", "/api/auth/logout", nil, cookie)
	status(t, response, 204)
	cleared := response.Result().Cookies()[0]
	if cleared.MaxAge != -1 || cleared.Path != cookie.Path || !cleared.HttpOnly || !cleared.Secure {
		t.Fatal("logout did not clear session cookie correctly")
	}
}
func TestConcurrentAnnotationRequests(t *testing.T) {
	h := setup(t)
	cookie := h.user("parallel@example.com")
	pid := h.project(cookie)
	sid := h.sheet(cookie, pid)
	results := make(chan int, 20)
	for i := 0; i < 20; i++ {
		go func(i int) {
			// Exercise the real HTTP handler concurrently; assertions stay on the test goroutine.
			input := fmt.Sprintf(`{"sheetId":%q,"kind":"pin","x":1,"y":2,"payload":{}}`, sid)
			req := httptest.NewRequest("PUT", fmt.Sprintf("/api/annotations/item-%d", i), strings.NewReader(input))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Punchlist-Request", "1")
			req.AddCookie(cookie)
			res := httptest.NewRecorder()
			h.handler.ServeHTTP(res, req)
			results <- res.Code
		}(i)
	}
	for i := 0; i < 20; i++ {
		if code := <-results; code != 204 {
			t.Fatalf("concurrent write returned %d", code)
		}
	}
	if len(h.app.annotations) != 20 {
		t.Fatal("concurrent writes lost data")
	}
}
