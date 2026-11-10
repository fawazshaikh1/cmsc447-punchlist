package main

// Comments and replies (spec 7.1). A comment is a change record with intent
// "comment", which anyone on the project may append (access.go), so it is
// signed by the server and can never be edited or deleted. A reply names the
// comment it answers in reply_to.
//
//   GET /api/projects/{projectID}/comments/counts   { markup id: comments }

import (
	"context"
	_ "embed"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

//go:embed comments_schema.sql
var commentsSchema string

func init() { registerSchema(commentsSchema) }

// maxCommentLength is in characters, not bytes.
const maxCommentLength = 2000

// checkComment returns why a change record cannot be stored, or "".
func checkComment(ctx context.Context, c ChangeRecord) (string, error) {
	if c.Intent != "comment" {
		if c.ReplyTo != "" {
			return "Only a comment can be a reply.", nil
		}
		return "", nil
	}
	text := strings.TrimSpace(c.Detail)
	if text == "" {
		return "A comment needs some words.", nil
	}
	if utf8.RuneCountInString(text) > maxCommentLength {
		return "A comment can be at most 2000 characters.", nil
	}
	if c.ReplyTo == "" {
		return "", nil
	}
	var annotationID string
	err := db.QueryRow(ctx,
		`SELECT annotation_id FROM change_history WHERE id = $1 AND intent = 'comment'`, c.ReplyTo).Scan(&annotationID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && annotationID != c.AnnotationID) {
		return "A reply must answer a comment on the same item.", nil
	}
	return "", err
}

// handleCommentCounts returns how many comments each markup in the project
// has, for the Tasks tab's list and CSV.
func handleCommentCounts(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectReader(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT annotation_id, count(*) FROM change_history
		 WHERE intent = 'comment' AND sheet_id LIKE $1
		 GROUP BY annotation_id`, projectSheets(projectID))
	if err != nil {
		dbError(w, "comment counts", err)
		return
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			dbError(w, "scan comment count", err)
			return
		}
		counts[id] = n
	}
	if err := rows.Err(); err != nil {
		dbError(w, "comment counts rows", err)
		return
	}
	writeJSON(w, http.StatusOK, counts)
}
