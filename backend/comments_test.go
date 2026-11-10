package main

// Comments and replies (spec 7.1): change records with intent "comment",
// open to everyone on the project, a reply pointing at the comment it answers.

import (
	"strings"
	"testing"
)

func comment(id, annotationID, sheetID, text, replyTo string) map[string]any {
	c := changeRecord(id, annotationID, sheetID, "comment", "2026-11-10T10:00:00.000Z")
	c["detail"] = text
	if replyTo != "" {
		c["replyTo"] = replyTo
	}
	return c
}

func TestAnyoneOnTheProjectCanCommentAndReply(t *testing.T) {
	tm := newTeam(t)
	item := uid(tm, "item")
	expect(t, tm.admin.call("PUT", annotationPath(item), markup(item, tm.sheet, "pin")), 204, "the admin adds a pin")

	first := uid(tm, "c1")
	expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), comment(first, item, tm.sheet, "North or south door?", "")), 204, "a collaborator comments")
	expect(t, tm.power.call("POST", sheetPath(tm.sheet, "/changes"), comment(uid(tm, "c2"), item, tm.sheet, "North.", first)), 204, "a power collaborator replies")
	expect(t, tm.outsider.call("POST", sheetPath(tm.sheet, "/changes"), comment(uid(tm, "c3"), item, tm.sheet, "Hello", "")), 403, "an outsider comments")

	r := tm.collab.call("GET", annotationPath(item)+"/changes", nil)
	expect(t, r, 200, "the item's history")
	var history []ChangeRecord
	r.json(&history)
	if len(history) != 2 || history[0].Detail != "North." || history[0].ReplyTo != first || history[1].ReplyTo != "" {
		t.Fatalf("expected the reply over the comment it answers, got %+v", history)
	}
	if !strings.Contains(string(history[1].Actor), "TeamCollab") {
		t.Fatalf("the comment should be signed by the collaborator, got %s", history[1].Actor)
	}
}

func TestACommentNeedsWordsAndAReplyNeedsACommentOnTheSameItem(t *testing.T) {
	tm := newTeam(t)
	item, other := uid(tm, "item"), uid(tm, "other")
	post := func(c map[string]any) reply { return tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), c) }

	expect(t, post(comment(uid(tm, "empty"), item, tm.sheet, "   ", "")), 400, "an empty comment")
	expect(t, post(comment(uid(tm, "long"), item, tm.sheet, strings.Repeat("x", 2001), "")), 400, "a comment over 2000 characters")

	elsewhere := uid(tm, "elsewhere")
	expect(t, post(comment(elsewhere, other, tm.sheet, "On the other item", "")), 204, "a comment on another item")
	expect(t, post(comment(uid(tm, "stray"), item, tm.sheet, "Re", elsewhere)), 400, "a reply to a comment on another item")
	expect(t, post(comment(uid(tm, "ghost"), item, tm.sheet, "Re", uid(tm, "nothing"))), 400, "a reply to nothing")
}

func TestTheTasksTabCountsEachTasksComments(t *testing.T) {
	tm := newTeam(t)
	a, b := uid(tm, "a"), uid(tm, "b")
	post := func(c map[string]any) {
		t.Helper()
		expect(t, tm.collab.call("POST", sheetPath(tm.sheet, "/changes"), c), 204, "record a change")
	}
	post(comment(uid(tm, "a1"), a, tm.sheet, "One", ""))
	post(comment(uid(tm, "a2"), a, tm.sheet, "Two", ""))
	post(comment(uid(tm, "b1"), b, tm.sheet, "Three", ""))
	expect(t, tm.admin.call("POST", sheetPath(tm.sheet, "/changes"), changeRecord(uid(tm, "b-edit"), b, tm.sheet, "update", "2026-11-10T11:00:00.000Z")), 204, "an edit, which is not a comment")

	r := tm.collab.call("GET", projectPath(tm.project, "/comments/counts"), nil)
	expect(t, r, 200, "the counts")
	var counts map[string]int
	r.json(&counts)
	if len(counts) != 2 || counts[a] != 2 || counts[b] != 1 {
		t.Fatalf("expected a:2 b:1, got %v", counts)
	}
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/comments/counts"), nil), 403, "an outsider reads them")
}
