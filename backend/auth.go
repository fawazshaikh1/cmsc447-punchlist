package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

const sessionCookie = "punchlist_session"
const passwordIterations = 600000
const sessionLifetime = 12 * time.Hour

type profile struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Company string `json:"company"`
	Title   string `json:"title"`
}
type account struct {
	Profile profile
	Salt    []byte
	Hash    []byte
}
type session struct {
	UserID  string
	Expires time.Time
}
type attempt struct {
	Count int
	Until time.Time
}

func randomToken() string { return rand.Text() }
func tokenKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func passwordHash(password string, salt []byte) []byte {
	hash, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		panic(err)
	} // Fixed, valid PBKDF2 parameters.
	return hash
}
func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// Bound expensive password operations by source address. Never trust forwarded headers.
func (a *application) allowAuth(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for key, v := range a.attempts {
		if !now.Before(v.Until) {
			delete(a.attempts, key)
		}
	}
	key := host
	v := a.attempts[key]
	if v.Count >= 20 || (v.Count == 0 && len(a.attempts) >= 10000) {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "too many authentication attempts; retry later")
		return false
	}
	if v.Count == 0 {
		v.Until = now.Add(time.Minute)
	}
	v.Count++
	a.attempts[key] = v
	return true
}
func (a *application) register(w http.ResponseWriter, r *http.Request) {
	if !a.allowAuth(w, r) {
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Company  string `json:"company"`
		Title    string `json:"title"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Email = normalizeEmail(input.Email)
	input.Name = strings.TrimSpace(input.Name)
	input.Company = strings.TrimSpace(input.Company)
	input.Title = strings.TrimSpace(input.Title)
	parsed, err := mail.ParseAddress(input.Email)
	if err != nil || parsed.Address != input.Email || len(input.Email) > 254 || input.Name == "" || input.Company == "" || input.Title == "" || len(input.Name) > 200 || len(input.Company) > 200 || len(input.Title) > 200 || utf8.RuneCountInString(input.Password) < 15 || len(input.Password) > 1024 {
		fail(w, 400, "valid email, name, company, title and a password of 15+ characters (max 1024 bytes) required")
		return
	}
	salt := []byte(randomToken())
	user := account{Profile: profile{ID: randomToken(), Email: input.Email, Name: input.Name, Company: input.Company, Title: input.Title}, Salt: salt, Hash: passwordHash(input.Password, salt)}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, exists := a.users[input.Email]; exists {
		fail(w, 409, "account already exists")
		return
	}
	a.users[input.Email] = user
	// Registration confers no memberships, project roles, or session.
	reply(w, 201, user.Profile)
}
func (a *application) login(w http.ResponseWriter, r *http.Request) {
	if !a.allowAuth(w, r) {
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Password) > 1024 || len(input.Email) > 254 {
		fail(w, 400, "invalid credentials input")
		return
	}
	a.mu.Lock()
	user, exists := a.users[normalizeEmail(input.Email)]
	a.mu.Unlock()
	salt := user.Salt
	if !exists {
		salt = []byte("punchlist-dummy-password-salt")
	}
	hash := passwordHash(input.Password, salt) // Unknown accounts also pay the password-hash cost.
	if !exists || subtle.ConstantTimeCompare(hash, user.Hash) != 1 {
		fail(w, 401, "invalid email or password")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for key, s := range a.sessions {
		if !now.Before(s.Expires) || s.UserID == user.Profile.ID {
			delete(a.sessions, key)
		}
	}
	// One active session per account in this prototype. Each login rotates the token.
	token := randomToken()
	a.sessions[tokenKey(token)] = session{UserID: user.Profile.ID, Expires: now.Add(sessionLifetime)}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/api", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds()), Expires: now.Add(sessionLifetime)})
	reply(w, 200, user.Profile)
}
func (a *application) logout(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		delete(a.sessions, tokenKey(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/api", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(204)
}
func (a *application) me(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	id, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	for _, user := range a.users {
		if user.Profile.ID == id {
			reply(w, 200, user.Profile)
			return
		}
	}
	fail(w, 401, "authentication required")
}
