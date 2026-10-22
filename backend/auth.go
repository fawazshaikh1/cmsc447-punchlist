package main

// Accounts and sign-in (SCRUM-42).
//
// Ported from the prototype on feat/auth-current, which kept everything in
// process memory, onto the Postgres tables in schema.sql. The security choices
// are the prototype's and are kept on purpose:
//
//   - passwords are PBKDF2-HMAC-SHA256 with a random salt per account, from
//     the standard library — no third-party crypto
//   - the session cookie is an opaque random value; only its SHA-256 digest
//     is stored, so the sessions table cannot be replayed if it leaks
//   - the cookie is HttpOnly and SameSite=Strict, so page scripts cannot read
//     it and other sites cannot send it
//   - an unknown email and a wrong password get the same answer, and take the
//     same time, so the login form cannot be used to find out who has an
//     account
//   - sign-in attempts are rate limited per client address

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

//go:embed auth_schema.sql
var authSchema string

const (
	sessionCookie   = "punchlist_session"
	sessionLifetime = 12 * time.Hour

	// NIST SP 800-63B: when a password is the only factor, at least 15
	// characters. A passphrase is easier to type on a tablet than a short
	// password full of symbols, and much harder to guess.
	minPasswordRunes = 15
	maxPasswordBytes = 1024
)

// passwordIterations is a variable only so tests can lower it; hashing at the
// production cost makes a test suite that registers dozens of accounts slow.
var passwordIterations = 600_000

// User is an account, minus anything secret.
type User struct {
	ID          int
	Email       string
	DisplayName string
	Company     string
	Title       string
}

// Profile is what the browser is told about the signed-in account. The id is
// a string because the frontend's Actor requires one.
type Profile struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Company     string `json:"company"`
	Title       string `json:"title"`
}

func (u *User) profile() Profile {
	return Profile{
		ID:          strconv.Itoa(u.ID),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Company:     u.Company,
		Title:       u.Title,
	}
}

// migrate brings an existing database up to what the server needs: sign-in
// (auth_schema.sql), then photos (media_schema.sql). Each is idempotent.
func migrate(ctx context.Context) error {
	for _, schema := range []string{authSchema, mediaSchema} {
		if _, err := db.Exec(ctx, schema); err != nil {
			return err
		}
	}
	return nil
}

// --- responses ---------------------------------------------------------------

// jsonError answers with {"error": message}. The frontend shows the message
// as it is, so it is written for the person using the app.
func jsonError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// decodeJSON reads exactly one JSON object of at most 64 KB into v. Unknown
// fields are refused, so a client cannot slip in a field like "role".
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		jsonError(w, http.StatusBadRequest, "The request must be a single JSON object.")
		return false
	}
	return true
}

// --- passwords ---------------------------------------------------------------

// hashPassword returns "pbkdf2_sha256$iterations$salt$hash", so the cost can
// be raised later without invalidating existing accounts.
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", passwordIterations, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// checkPassword compares in constant time. A malformed stored hash never
// matches.
func checkPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 1 {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash is checked against when the email is unknown, so a login for an
// account that does not exist costs the same as one that does.
var dummyHash = sync.OnceValue(func() string {
	h, _ := hashPassword("not a real password, only here for timing")
	return h
})

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// --- sessions ----------------------------------------------------------------

func tokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// startSession signs the user in on this browser.
func startSession(w http.ResponseWriter, r *http.Request, userID int) error {
	token := rand.Text()
	expires := time.Now().Add(sessionLifetime)

	// Expired sessions are swept whenever someone signs in, which keeps the
	// table small without a background job.
	if _, err := db.Exec(r.Context(), `DELETE FROM sessions WHERE expires_at < now()`); err != nil {
		return err
	}
	if _, err := db.Exec(r.Context(),
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		tokenDigest(token), userID, expires); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/api",
		Expires:  expires,
		MaxAge:   int(sessionLifetime.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
	return nil
}

// isHTTPS decides the cookie's Secure flag. Secure on plain-http localhost
// would stop sign-in working in development (and on an iPad testing against a
// laptop's address); behind the HTTPS load balancer it is always set.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/api", MaxAge: -1,
		HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteStrictMode,
	})
}

var errNotSignedIn = errors.New("not signed in")

// currentUser is the account behind this request's session cookie.
func currentUser(r *http.Request) (*User, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, errNotSignedIn
	}
	var u User
	err = db.QueryRow(r.Context(),
		`SELECT u.id, u.email, u.display_name, COALESCE(u.company, ''), u.title
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = $1 AND s.expires_at > now()`,
		tokenDigest(cookie.Value)).Scan(&u.ID, &u.Email, &u.DisplayName, &u.Company, &u.Title)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotSignedIn
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// signedIn answers 401 (or 500) itself when there is no usable session.
func signedIn(w http.ResponseWriter, r *http.Request) (*User, bool) {
	u, err := currentUser(r)
	if errors.Is(err, errNotSignedIn) {
		jsonError(w, http.StatusUnauthorized, "Sign in to continue.")
		return nil, false
	}
	if err != nil {
		dbError(w, "current user", err)
		return nil, false
	}
	return u, true
}

// --- rate limiting -----------------------------------------------------------

// authLimiter allows 20 sign-in or registration attempts per minute per
// client address. In memory, so it resets on restart and is per-server — a
// deployment behind several servers needs a limit at the load balancer too.
type authLimiter struct {
	mu       sync.Mutex
	attempts map[string]*window
}

type window struct {
	count int
	until time.Time
}

const authAttemptsPerMinute = 20

var limiter = &authLimiter{attempts: map[string]*window{}}

// allow records an attempt and reports whether it may go ahead. The address
// is taken from the connection, never from a forwarded header a client could
// set itself.
func (l *authLimiter) allow(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()
	for key, win := range l.attempts {
		if now.After(win.until) {
			delete(l.attempts, key)
		}
	}
	win := l.attempts[host]
	if win == nil {
		win = &window{until: now.Add(time.Minute)}
		l.attempts[host] = win
	}
	if win.count >= authAttemptsPerMinute {
		w.Header().Set("Retry-After", "60")
		jsonError(w, http.StatusTooManyRequests, "Too many sign-in attempts. Wait a minute and try again.")
		return false
	}
	win.count++
	return true
}

// --- handlers ----------------------------------------------------------------

// POST /api/auth/register  {email, password, displayName, company, title}
//
// Creates the account and signs it in. It confers no project role: an admin
// of a project adds the person afterwards, as the stakeholder described.
func handleRegister(w http.ResponseWriter, r *http.Request) {
	if !limiter.allow(w, r) {
		return
	}
	var in struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		Company     string `json:"company"`
		Title       string `json:"title"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Email = normalizeEmail(in.Email)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.Company = strings.TrimSpace(in.Company)
	in.Title = strings.TrimSpace(in.Title)

	if msg := validateRegistration(in.Email, in.Password, in.DisplayName, in.Company, in.Title); msg != "" {
		jsonError(w, http.StatusBadRequest, msg)
		return
	}

	hash, err := hashPassword(in.Password)
	if err != nil {
		dbError(w, "hash password", err)
		return
	}
	var u User
	err = db.QueryRow(r.Context(),
		`INSERT INTO users (display_name, email, company, title, password_hash)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, email, display_name, COALESCE(company, ''), title`,
		in.DisplayName, in.Email, in.Company, in.Title, hash).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Company, &u.Title)
	if isUniqueViolation(err) {
		jsonError(w, http.StatusConflict, "An account with that email already exists. Sign in instead.")
		return
	}
	if err != nil {
		dbError(w, "register", err)
		return
	}
	if err := startSession(w, r, u.ID); err != nil {
		dbError(w, "start session", err)
		return
	}
	writeJSON(w, http.StatusCreated, u.profile())
}

// validateRegistration returns what is wrong, in words for the form, or "".
func validateRegistration(email, password, name, company, title string) string {
	parsed, err := mail.ParseAddress(email)
	switch {
	case err != nil || parsed.Address != email || len(email) > 254:
		return "Enter a valid email address."
	case name == "" || utf8.RuneCountInString(name) > 200:
		return "Enter your name."
	case company == "" || utf8.RuneCountInString(company) > 200:
		return "Enter the company you work for."
	case utf8.RuneCountInString(title) > 200:
		return "That job title is too long."
	case utf8.RuneCountInString(password) < minPasswordRunes:
		return fmt.Sprintf("Use a password of at least %d characters — a short phrase works well.", minPasswordRunes)
	case len(password) > maxPasswordBytes:
		return "That password is too long."
	}
	return ""
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// POST /api/auth/login  {email, password}
func handleLogin(w http.ResponseWriter, r *http.Request) {
	if !limiter.allow(w, r) {
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Password) > maxPasswordBytes || len(in.Email) > 254 {
		jsonError(w, http.StatusUnauthorized, "Wrong email or password.")
		return
	}

	var u User
	var stored string
	err := db.QueryRow(r.Context(),
		`SELECT id, email, display_name, COALESCE(company, ''), title, password_hash
		 FROM users WHERE email = $1`, normalizeEmail(in.Email)).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Company, &u.Title, &stored)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		dbError(w, "login", err)
		return
	}
	if !found {
		stored = dummyHash()
	}
	// Checked even when the account does not exist — see dummyHash.
	if !checkPassword(in.Password, stored) || !found {
		jsonError(w, http.StatusUnauthorized, "Wrong email or password.")
		return
	}
	if err := startSession(w, r, u.ID); err != nil {
		dbError(w, "start session", err)
		return
	}
	writeJSON(w, http.StatusOK, u.profile())
}

// POST /api/auth/logout
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		if _, err := db.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, tokenDigest(cookie.Value)); err != nil {
			dbError(w, "logout", err)
			return
		}
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/auth/me — the signed-in account, or null.
//
// "Nobody" is an ordinary answer to "who am I?", asked every time the app
// starts, so it is a 200 with null rather than a 401: a 401 here is logged by
// the browser as an error on every visit to the sign-in screen. Every other
// endpoint still answers 401 without a session.
func handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := currentUser(r)
	if errors.Is(err, errNotSignedIn) {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		dbError(w, "current user", err)
		return
	}
	writeJSON(w, http.StatusOK, u.profile())
}

// GET /api/session?project=ID
//
// Who is working, in the shape of the frontend's Actor: the signed-in person
// plus their role on the given project ("" when they are not on it, or no
// project is given). This is what attributes every change in the history.
func handleSession(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	role := ""
	if raw := r.URL.Query().Get("project"); raw != "" {
		projectID, err := strconv.Atoi(raw)
		if err != nil {
			jsonError(w, http.StatusBadRequest, "project must be a number.")
			return
		}
		found, err := roleOn(r.Context(), u.ID, projectID)
		if err != nil {
			dbError(w, "session role", err)
			return
		}
		role = string(found)
	}
	writeJSON(w, http.StatusOK, actorFor(u, Role(role)))
}

// Actor is the frontend's Actor.toJSON(): who did something, as they were at
// the time. Written into every change record by the server itself, so a
// change cannot be attributed to someone else.
type Actor struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Company     string `json:"company"`
	Role        string `json:"role"`
}

func actorFor(u *User, role Role) Actor {
	return Actor{ID: strconv.Itoa(u.ID), DisplayName: u.DisplayName, Company: u.Company, Role: string(role)}
}

// String matches Actor.toString() in the frontend: "Name (Company)".
func (a Actor) String() string {
	if a.Company == "" {
		return a.DisplayName
	}
	return a.DisplayName + " (" + a.Company + ")"
}
