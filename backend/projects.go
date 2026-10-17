package main

// Projects, members and per-project roles (SCRUM-43).
//
// Roles are per project, never global: the stakeholder was specific that a
// person can administer one project and be a collaborator on another. There is
// no site-wide admin.
//
//	admin               adds people, changes roles, removes people; edits everything
//	power_collaborator  edits everything on the sheets
//	collaborator        adds photos (and, later, comments); cannot change items
//
// What each role may do to a markup is decided in access.go, in one table.

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Role is a project role, as stored in the member_role enum.
type Role string

const (
	RoleAdmin        Role = "admin"
	RolePower        Role = "power_collaborator"
	RoleCollaborator Role = "collaborator"
)

func (r Role) valid() bool { return r == RoleAdmin || r == RolePower || r == RoleCollaborator }

// roleOn is the user's role on the project, or "" when they are not on it.
func roleOn(ctx context.Context, userID, projectID int) (Role, error) {
	var role string
	err := db.QueryRow(ctx,
		`SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2`,
		projectID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return Role(role), err
}

// projectIDParam reads {projectID} from the path.
func projectIDParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("projectID"))
	if err != nil || id < 1 {
		jsonError(w, http.StatusNotFound, "No such project.")
		return 0, false
	}
	return id, true
}

// memberOf answers 403 itself unless the user is on the project, and when
// adminOnly is set, unless they administer it. A project that does not exist
// gets the same 403 as one the user is not on, so ids cannot be probed.
func memberOf(w http.ResponseWriter, r *http.Request, u *User, projectID int, adminOnly bool) (Role, bool) {
	role, err := roleOn(r.Context(), u.ID, projectID)
	if err != nil {
		dbError(w, "project role", err)
		return "", false
	}
	if role == "" {
		jsonError(w, http.StatusForbidden, "You are not on this project.")
		return "", false
	}
	if adminOnly && role != RoleAdmin {
		jsonError(w, http.StatusForbidden, "Only a project admin can do that.")
		return "", false
	}
	return role, true
}

// ProjectSummary is one project as the person signed in sees it.
type ProjectSummary struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Role      Role   `json:"role"`
	CreatedAt string `json:"createdAt"`
}

// GET /api/projects — the projects the signed-in person is on, with their role.
func handleListProjects(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT p.id, p.name, m.role, p.created_at
		 FROM memberships m JOIN projects p ON p.id = m.project_id
		 WHERE m.user_id = $1
		 ORDER BY p.name, p.id`, u.ID)
	if err != nil {
		dbError(w, "list projects", err)
		return
	}
	defer rows.Close()

	list := []ProjectSummary{}
	for rows.Next() {
		var p ProjectSummary
		var created time.Time
		if err := rows.Scan(&p.ID, &p.Name, &p.Role, &created); err != nil {
			dbError(w, "scan project", err)
			return
		}
		p.CreatedAt = jsTime(created)
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list projects rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// POST /api/projects  {name}
//
// Any signed-in person may start a project, and administers only that one.
// It grants nothing on anyone else's project. (The stakeholder did not say who
// may create projects; this is the least surprising rule, and one place to
// change if they decide otherwise.)
func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 200 {
		jsonError(w, http.StatusBadRequest, "Give the project a name.")
		return
	}

	tx, err := db.Begin(r.Context())
	if err != nil {
		dbError(w, "create project", err)
		return
	}
	defer tx.Rollback(r.Context())

	var p ProjectSummary
	var created time.Time
	if err := tx.QueryRow(r.Context(),
		`INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id, name, created_at`,
		in.Name, u.ID).Scan(&p.ID, &p.Name, &created); err != nil {
		dbError(w, "create project", err)
		return
	}
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'admin')`,
		p.ID, u.ID); err != nil {
		dbError(w, "create project admin", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbError(w, "create project commit", err)
		return
	}
	p.Role = RoleAdmin
	p.CreatedAt = jsTime(created)
	writeJSON(w, http.StatusCreated, p)
}

// Member is one person on a project.
type Member struct {
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Company     string `json:"company"`
	Title       string `json:"title"`
	Role        Role   `json:"role"`
}

// GET /api/projects/{projectID}/members — anyone on the project may see who
// else is on it; assigning work needs to know.
func handleListMembers(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT u.id, u.email, u.display_name, COALESCE(u.company, ''), u.title, m.role
		 FROM memberships m JOIN users u ON u.id = m.user_id
		 WHERE m.project_id = $1
		 ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'power_collaborator' THEN 1 ELSE 2 END,
		          u.display_name, u.id`, projectID)
	if err != nil {
		dbError(w, "list members", err)
		return
	}
	defer rows.Close()

	list := []Member{}
	for rows.Next() {
		var m Member
		var id int
		if err := rows.Scan(&id, &m.Email, &m.DisplayName, &m.Company, &m.Title, &m.Role); err != nil {
			dbError(w, "scan member", err)
			return
		}
		m.UserID = strconv.Itoa(id)
		list = append(list, m)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list members rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// PUT /api/projects/{projectID}/members  {email, role}
//
// Admin only. Adds the account with that email, or changes the role of
// someone already on the project. The person must have created an account
// first: there is no email verification, so letting an invitation wait for
// whoever registers with an address would hand the role to anyone who typed
// it in first.
func handleSetMember(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, true); !ok {
		return
	}
	var in struct {
		Email string `json:"email"`
		Role  Role   `json:"role"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !in.Role.valid() {
		jsonError(w, http.StatusBadRequest, "Choose a role: admin, power collaborator or collaborator.")
		return
	}

	var target Member
	var targetID int
	err := db.QueryRow(r.Context(),
		`SELECT id, email, display_name, COALESCE(company, ''), title FROM users WHERE email = $1`,
		normalizeEmail(in.Email)).Scan(&targetID, &target.Email, &target.DisplayName, &target.Company, &target.Title)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "Nobody has an account with that email yet. Ask them to create one, then add them.")
		return
	}
	if err != nil {
		dbError(w, "find member", err)
		return
	}

	err = withAdminsLocked(r.Context(), projectID, func(tx pgx.Tx, admins int) error {
		current, err := roleIn(r.Context(), tx, targetID, projectID)
		if err != nil {
			return err
		}
		if current == RoleAdmin && in.Role != RoleAdmin && admins <= 1 {
			return errLastAdmin
		}
		_, err = tx.Exec(r.Context(),
			`INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3)
			 ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
			projectID, targetID, string(in.Role))
		return err
	})
	if errors.Is(err, errLastAdmin) {
		jsonError(w, http.StatusConflict, "A project needs at least one admin. Make someone else admin first.")
		return
	}
	if err != nil {
		dbError(w, "set member", err)
		return
	}
	target.UserID = strconv.Itoa(targetID)
	target.Role = in.Role
	writeJSON(w, http.StatusOK, target)
}

// DELETE /api/projects/{projectID}/members/{userID} — admin only.
func handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, true); !ok {
		return
	}
	targetID, err := strconv.Atoi(r.PathValue("userID"))
	if err != nil {
		jsonError(w, http.StatusNotFound, "That person is not on this project.")
		return
	}

	removed := false
	err = withAdminsLocked(r.Context(), projectID, func(tx pgx.Tx, admins int) error {
		current, err := roleIn(r.Context(), tx, targetID, projectID)
		if err != nil {
			return err
		}
		if current == "" {
			return nil
		}
		if current == RoleAdmin && admins <= 1 {
			return errLastAdmin
		}
		_, err = tx.Exec(r.Context(),
			`DELETE FROM memberships WHERE project_id = $1 AND user_id = $2`, projectID, targetID)
		removed = err == nil
		return err
	})
	if errors.Is(err, errLastAdmin) {
		jsonError(w, http.StatusConflict, "A project needs at least one admin. Make someone else admin first.")
		return
	}
	if err != nil {
		dbError(w, "remove member", err)
		return
	}
	if !removed {
		jsonError(w, http.StatusNotFound, "That person is not on this project.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var errLastAdmin = errors.New("project must keep an admin")

// withAdminsLocked runs fn in a transaction holding a lock on the project's
// memberships, and tells it how many admins there are. The lock is what makes
// "never leave a project without an admin" hold when two admins demote each
// other at the same moment: without it, both would see two admins and both
// demotions would succeed.
func withAdminsLocked(ctx context.Context, projectID int, fn func(tx pgx.Tx, admins int) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Locks the project row: every membership change on this project queues
	// behind it.
	if _, err := tx.Exec(ctx, `SELECT id FROM projects WHERE id = $1 FOR UPDATE`, projectID); err != nil {
		return err
	}
	var admins int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM memberships WHERE project_id = $1 AND role = 'admin'`,
		projectID).Scan(&admins); err != nil {
		return err
	}
	if err := fn(tx, admins); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// roleIn is roleOn inside a transaction.
func roleIn(ctx context.Context, tx pgx.Tx, userID, projectID int) (Role, error) {
	var role string
	err := tx.QueryRow(ctx,
		`SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2`,
		projectID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return Role(role), err
}
