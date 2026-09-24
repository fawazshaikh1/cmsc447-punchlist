package main

import (
	"net/http"
	"strings"
)

type role string

const (
	admin        role = "admin"
	power        role = "power_collaborator"
	collaborator role = "collaborator"
)

type project struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Members map[string]role `json:"-"`
}

func validRole(r role) bool { return r == admin || r == power || r == collaborator }

// Requires a.mu. Unknown resources and inaccessible resources both return 403.
func (a *application) permission(w http.ResponseWriter, userID, projectID string, edit, adminOnly bool) bool {
	p := a.projects[projectID]
	if p != nil {
		r := p.Members[userID]
		if validRole(r) && (!edit || r == admin || r == power) && (!adminOnly || r == admin) {
			return true
		}
	}
	fail(w, 403, "project permission required")
	return false
}
func (a *application) createProject(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 200 {
		fail(w, 400, "project name required (max 200 bytes)")
		return
	}
	// Bootstrap rule: creator administers ONLY the new project. Documented for team review.
	p := &project{ID: randomToken(), Name: input.Name, Members: map[string]role{uid: admin}}
	a.projects[p.ID] = p
	reply(w, 201, p)
}
func (a *application) listProjects(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	type membership struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Role role   `json:"role"`
	}
	result := []membership{}
	for _, p := range a.projects {
		if v, ok := p.Members[uid]; ok {
			result = append(result, membership{p.ID, p.Name, v})
		}
	}
	reply(w, 200, result)
}
func (a *application) setMember(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	pid := r.PathValue("projectID")
	if !a.permission(w, uid, pid, false, true) {
		return
	}
	var input struct {
		Email string `json:"email"`
		Role  role   `json:"role"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !validRole(input.Role) {
		fail(w, 400, "unknown project role")
		return
	}
	user, ok := a.users[normalizeEmail(input.Email)]
	if !ok {
		fail(w, 404, "account not found")
		return
	}
	p := a.projects[pid]
	if p.Members[user.Profile.ID] == admin && input.Role != admin {
		count := 0
		for _, v := range p.Members {
			if v == admin {
				count++
			}
		}
		if count <= 1 {
			fail(w, 409, "project must retain an admin")
			return
		}
	}
	p.Members[user.Profile.ID] = input.Role
	w.WriteHeader(204)
}
func (a *application) addSheet(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	pid := r.PathValue("projectID")
	if !a.permission(w, uid, pid, false, true) {
		return
	}
	// Allocate server-owned identity, not filename#page (which collides across projects).
	id := randomToken()
	a.sheets[id] = pid
	reply(w, 201, map[string]string{"id": id, "projectId": pid})
}
func (a *application) deleteSheet(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	pid := r.PathValue("projectID")
	sid := r.PathValue("sheetID")
	if !a.permission(w, uid, pid, false, true) {
		return
	}
	if a.sheets[sid] != pid {
		fail(w, 404, "sheet not found in project")
		return
	}
	delete(a.sheets, sid)
	for id, item := range a.annotations {
		if item.SheetID == sid {
			delete(a.annotations, id)
		}
	}
	w.WriteHeader(204)
}
