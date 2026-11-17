package main

// Reversing the workflow (spec 8): every delete kept for 30 days, an issue
// voided to unlock what it locked, and who may do either (SCRUM-81).

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

type trashRow struct {
	Annotation
	DeletedAt      string          `json:"deletedAt"`
	DeletedBy      json.RawMessage `json:"deletedBy"`
	DrawingRemoved bool            `json:"drawingRemoved"`
}

type issueRow struct {
	ID          string `json:"id"`
	Document    string `json:"documentName"`
	SealedCount int    `json:"sealedCount"`
	Void        *struct {
		By     string `json:"by"`
		At     string `json:"at"`
		Reason string `json:"reason"`
	} `json:"void"`
}

func readTrash(t *testing.T, tm team) []trashRow {
	t.Helper()
	r := tm.admin.call("GET", projectPath(tm.project, "/trash"), nil)
	expect(t, r, 200, "the admin reads the trash")
	var rows []trashRow
	r.json(&rows)
	return rows
}

func trashIDs(rows []trashRow) []string {
	ids := []string{}
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func pinWithStatus(id, sheetID, status string) map[string]any {
	m := markup(id, sheetID, "pin")
	m["payload"] = map[string]any{"label": "Door sticks", "status": status}
	return m
}

func TestEveryDeleteIsKeptAndSavingTheMarkupAgainForgetsTheCopy(t *testing.T) {
	tm := newTeam(t)
	a, b, c := uid(tm, "a"), uid(tm, "b"), uid(tm, "c")
	for _, id := range []string{a, b, c} {
		expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tm.sheet, "pin")), 204, "the admin adds "+id)
	}

	expect(t, tm.power.call("DELETE", annotationPath(a), nil), 204, "a power collaborator deletes one")
	expect(t, tm.power.call("POST", sheetPath(tm.sheet, "/changes"), changeRecord(uid(tm, "del-a"), a, tm.sheet, "delete", "2026-11-10T10:00:00.000Z")), 204, "and it is recorded")
	expect(t, tm.admin.call("DELETE", sheetPath(tm.sheet, "/annotations"), nil), 204, "the admin clears the sheet")

	rows := readTrash(t, tm)
	if got := strings.Join(trashIDs(rows), ","); !strings.Contains(got, a) || !strings.Contains(got, b) || !strings.Contains(got, c) || len(rows) != 3 {
		t.Fatalf("expected all three deleted markups, got %v", got)
	}
	for _, row := range rows {
		if row.ID == a {
			if !strings.Contains(string(row.DeletedBy), "TeamPower") {
				t.Fatalf("the single delete should name who did it, got %s", row.DeletedBy)
			}
			if row.Kind != "pin" || row.SheetID != tm.sheet || !strings.Contains(string(row.Payload), "Patch drywall") || row.CreatedAt != "2026-10-17T12:00:00Z" {
				t.Fatalf("the copy should be the markup exactly as it was, got %+v", row.Annotation)
			}
		} else if string(row.DeletedBy) != "null" {
			t.Fatalf("nothing recorded who cleared %s, so nobody should be named, got %s", row.ID, row.DeletedBy)
		}
	}

	// Restore (or undo) is the markup saved again with the same id.
	expect(t, tm.admin.call("PUT", annotationPath(a), markup(a, tm.sheet, "pin")), 204, "the admin brings one back")
	if ids := trashIDs(readTrash(t, tm)); len(ids) != 2 || strings.Contains(strings.Join(ids, ","), a) {
		t.Fatalf("a markup saved again should leave the trash, got %v", ids)
	}

	// Deleted again, it is back in the trash once — not twice.
	expect(t, tm.admin.call("DELETE", annotationPath(a), nil), 204, "deleted again")
	if ids := trashIDs(readTrash(t, tm)); len(ids) != 3 {
		t.Fatalf("expected one copy per markup, got %v", ids)
	}
}

func TestOnlyAnAdminSeesTheTrashAndItForgetsAfterThirtyDays(t *testing.T) {
	tm := newTeam(t)
	old, recent := uid(tm, "old"), uid(tm, "recent")
	for _, id := range []string{old, recent} {
		expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tm.sheet, "pin")), 204, "the admin adds "+id)
		expect(t, tm.admin.call("DELETE", annotationPath(id), nil), 204, "and deletes it")
	}
	if _, err := db.Exec(context.Background(), `UPDATE annotation_trash SET deleted_at = now() - interval '31 days' WHERE id = $1`, old); err != nil {
		t.Fatal(err)
	}

	expect(t, tm.power.call("GET", projectPath(tm.project, "/trash"), nil), 403, "a power collaborator reads the trash")
	expect(t, tm.collab.call("GET", projectPath(tm.project, "/trash"), nil), 403, "a collaborator reads the trash")
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/trash"), nil), 403, "an outsider reads the trash")

	if ids := trashIDs(readTrash(t, tm)); len(ids) != 1 || ids[0] != recent {
		t.Fatalf("expected only the recent delete, got %v", ids)
	}
	var left int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM annotation_trash WHERE id = $1`, old).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatal("a copy older than 30 days should be removed when the trash is read")
	}
}

func TestATrashedMarkupSaysWhenItsDrawingHasLeftTheProject(t *testing.T) {
	tm := newTeam(t)
	kept, gone, task := uid(tm, "kept"), uid(tm, "gone"), uid(tm, "task")
	keptSheet, goneSheet := sheet(tm.project, "Kept.pdf"), sheet(tm.project, "Gone.pdf")
	if _, err := db.Exec(context.Background(),
		`INSERT INTO documents (project_id, name, sha256, bytes, byte_size) VALUES ($1, 'Kept.pdf', 'x', '\x00', 1)`, tm.project); err != nil {
		t.Fatal(err)
	}
	for id, sheetID := range map[string]string{kept: keptSheet, gone: goneSheet, task: tasksSheet(tm.project)} {
		kind := "pin"
		if sheetID == tasksSheet(tm.project) {
			kind = "task"
		}
		expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, sheetID, kind)), 204, "the admin adds "+id)
		expect(t, tm.admin.call("DELETE", annotationPath(id), nil), 204, "and deletes it")
	}

	removed := map[string]bool{}
	for _, row := range readTrash(t, tm) {
		removed[row.ID] = row.DrawingRemoved
	}
	if len(removed) != 3 || removed[kept] || !removed[gone] || removed[task] {
		t.Fatalf("expected only the markup on Gone.pdf to be marked, got %v", removed)
	}
}

func TestVoidingAnIssueUnlocksWhatOnlyItLocked(t *testing.T) {
	tm := newTeam(t)
	x, y := uid(tm, "x"), uid(tm, "y")
	for _, id := range []string{x, y} {
		expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tm.sheet, "pin")), 204, "the admin adds "+id)
	}
	first, second, native := uid(tm, "first"), uid(tm, "second"), uid(tm, "native")
	expect(t, tm.admin.call("POST", "/api/exports", flattenedExport(first, map[string][]string{tm.sheet: {x, y}})), 204, "the first issue")
	later := flattenedExport(second, map[string][]string{tm.sheet: {y}})
	later["exportedAt"] = "2026-11-02T12:00:00.000Z"
	expect(t, tm.admin.call("POST", "/api/exports", later), 204, "a later issue that also holds y")
	plain := flattenedExport(native, map[string][]string{tm.sheet: {x}})
	plain["mode"] = "native"
	expect(t, tm.admin.call("POST", "/api/exports", plain), 204, "a native export, which locks nothing")

	sealed := func() (string, string) {
		t.Helper()
		var onSheet, inProject []string
		r := tm.collab.call("GET", fmt.Sprintf("/api/exports/sealed?document=A-101.pdf&sheetId=%s", strings.ReplaceAll(tm.sheet, "#", "%23")), nil)
		expect(t, r, 200, "the sheet's locks")
		r.json(&onSheet)
		r = tm.collab.call("GET", projectPath(tm.project, "/sealed"), nil)
		expect(t, r, 200, "the project's locks")
		r.json(&inProject)
		return strings.Join(onSheet, ","), strings.Join(inProject, ",")
	}
	if s, p := sealed(); s != x+","+y && s != y+","+x || p != x+","+y && p != y+","+x {
		t.Fatalf("both should be locked before the void, got sheet %q project %q", s, p)
	}

	voidPath := "/api/exports/" + first + "/void"
	why := map[string]string{"reason": "Issued to the wrong subcontractor"}
	expect(t, tm.power.call("POST", voidPath, why), 403, "a power collaborator voids")
	expect(t, tm.collab.call("POST", voidPath, why), 403, "a collaborator voids")
	expect(t, tm.outsider.call("POST", voidPath, why), 403, "an outsider voids")
	expect(t, tm.admin.call("POST", voidPath, map[string]string{"reason": "  "}), 400, "a void without a reason")
	expect(t, tm.admin.call("POST", "/api/exports/"+native+"/void", why), 400, "voiding an export that locked nothing")
	expect(t, tm.admin.call("POST", "/api/exports/"+uid(tm, "nothing")+"/void", why), 404, "voiding nothing")
	expect(t, tm.admin.call("POST", voidPath, why), 204, "the admin voids the first issue")
	expect(t, tm.admin.call("POST", voidPath, why), 409, "voiding it twice")

	if s, p := sealed(); s != y || p != y {
		t.Fatalf("only the later issue's lock should remain, got sheet %q project %q", s, p)
	}

	r := tm.admin.call("GET", projectPath(tm.project, "/issues"), nil)
	expect(t, r, 200, "the admin reads the issue history")
	var issues []issueRow
	r.json(&issues)
	if len(issues) != 2 || issues[0].ID != second || issues[1].ID != first {
		t.Fatalf("expected the two issued PDFs, newest first, got %+v", issues)
	}
	if issues[0].Void != nil || issues[0].SealedCount != 1 {
		t.Fatalf("the later issue is untouched, got %+v", issues[0])
	}
	if v := issues[1].Void; v == nil || v.Reason != why["reason"] || !strings.Contains(v.By, "TeamAdmin") || v.At == "" || issues[1].SealedCount != 2 {
		t.Fatalf("the voided issue should stay in the log with who, when and why, got %+v", issues[1])
	}
	expect(t, tm.power.call("GET", projectPath(tm.project, "/issues"), nil), 403, "a power collaborator reads the issue history")
}

// SCRUM-81: sending a task back is a status change, so it is the editors'.
// The reason goes in as a comment, which anyone on the project may add.
func TestOnlyEditorsSendATaskBackButAnyoneCanSayWhy(t *testing.T) {
	tm := newTeam(t)
	task := uid(tm, "task")
	expect(t, tm.admin.call("PUT", annotationPath(task), pinWithStatus(task, tm.sheet, "closed")), 204, "the admin closes a task")

	reopen := pinWithStatus(task, tm.sheet, "open")
	expect(t, tm.collab.call("PUT", annotationPath(task), reopen), 403, "a collaborator sends it back")
	expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), changeRecord(uid(tm, "c-back"), task, tm.sheet, "update", "2026-11-10T10:00:00.000Z")), 403, "a collaborator records a send back")

	expect(t, tm.power.call("PUT", annotationPath(task), reopen), 204, "a power collaborator sends it back")
	expect(t, tm.power.call("POST", sheetPath(tm.sheet, "/changes"), changeRecord(uid(tm, "p-back"), task, tm.sheet, "update", "2026-11-10T10:00:00.000Z")), 204, "and it is recorded")
	expect(t, tm.power.call("POST", sheetPath(tm.sheet, "/changes"), comment(uid(tm, "why"), task, tm.sheet, "Sent back from Closed to Open: hinge still loose", "")), 204, "with the reason as a comment")
	expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), comment(uid(tm, "ack"), task, tm.sheet, "On it.", uid(tm, "why"))), 204, "and the collaborator answers")
}
