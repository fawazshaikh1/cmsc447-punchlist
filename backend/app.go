package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Same annotation DTO as HttpAnnotationRepository; project ownership belongs to sheets.
type Annotation struct {
	ID        string                 `json:"id"`
	SheetID   string                 `json:"sheetId"`
	Kind      string                 `json:"kind"`
	CreatedAt string                 `json:"createdAt"`
	X         float64                `json:"x"`
	Y         float64                `json:"y"`
	Payload   map[string]interface{} `json:"payload"`
}
type application struct {
	mu          sync.Mutex
	users       map[string]account // normalized email -> account
	sessions    map[string]session // SHA-256 of opaque cookie -> session
	projects    map[string]*project
	sheets      map[string]string // sheet ID -> project ID, never supplied on annotation updates
	annotations map[string]Annotation
	attempts    map[string]attempt
	origin      string
	secure      bool
	now         func() time.Time
}

func newApplication(origin string, secure bool) *application {
	return &application{users: map[string]account{}, sessions: map[string]session{}, projects: map[string]*project{}, sheets: map[string]string{}, annotations: map[string]Annotation{}, attempts: map[string]attempt{}, origin: origin, secure: secure, now: time.Now}
}
func (a *application) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("POST /api/auth/register", a.register)
	m.HandleFunc("POST /api/auth/login", a.login)
	m.HandleFunc("POST /api/auth/logout", a.logout)
	m.HandleFunc("GET /api/auth/me", a.me)
	m.HandleFunc("POST /api/projects", a.createProject)
	m.HandleFunc("GET /api/projects", a.listProjects)
	m.HandleFunc("PUT /api/projects/{projectID}/members", a.setMember)
	m.HandleFunc("POST /api/projects/{projectID}/sheets", a.addSheet)
	m.HandleFunc("DELETE /api/projects/{projectID}/sheets/{sheetID}", a.deleteSheet)
	m.HandleFunc("GET /api/sheets/{sheetID}/annotations", a.sheetAnnotations)
	m.HandleFunc("DELETE /api/sheets/{sheetID}/annotations", a.sheetAnnotations)
	m.HandleFunc("PUT /api/annotations/{id}", a.singleAnnotation)
	m.HandleFunc("DELETE /api/annotations/{id}", a.singleAnnotation)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			// Custom header requires a browser preflight; this API deliberately enables no CORS.
			// Check Origin as well, including login (login CSRF). CLI clients omit Origin.
			if r.Header.Get("X-Punchlist-Request") != "1" || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.origin) {
				fail(w, http.StatusForbidden, "request origin or CSRF header rejected")
				return
			}
		}
		m.ServeHTTP(w, r)
	})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		fail(w, 415, "application/json required")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "invalid JSON body")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		fail(w, 400, "one JSON object required")
		return false
	}
	return true
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}

// Call with a.mu held: session lookup and permission decisions share a lock with mutations.
func (a *application) currentUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err == nil {
		key := tokenKey(cookie.Value)
		if s, ok := a.sessions[key]; ok {
			if a.now().Before(s.Expires) {
				return s.UserID, true
			}
			delete(a.sessions, key)
		}
	}
	fail(w, 401, "authentication required")
	return "", false
}
