package main

import (
	"net/http"
	"time"
)

func (a *application) sheetAnnotations(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	sid := r.PathValue("sheetID")
	if !a.permission(w, uid, a.sheets[sid], r.Method == http.MethodDelete, false) {
		return
	}
	if r.Method == http.MethodGet {
		result := []Annotation{}
		for _, v := range a.annotations {
			if v.SheetID == sid {
				result = append(result, v)
			}
		}
		reply(w, 200, result)
		return
	}
	for id, v := range a.annotations {
		if v.SheetID == sid {
			delete(a.annotations, id)
		}
	}
	w.WriteHeader(204)
}
func (a *application) singleAnnotation(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	uid, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	existing, exists := a.annotations[id]
	if r.Method == http.MethodDelete {
		if !exists {
			fail(w, 404, "annotation not found")
			return
		}
		if !a.permission(w, uid, a.sheets[existing.SheetID], true, false) {
			return
		}
		delete(a.annotations, id)
		w.WriteHeader(204)
		return
	}
	var input Annotation
	if !decode(w, r, &input) {
		return
	}
	// Check existing ownership BEFORE trusting the sheet ID provided by a client.
	if exists && !a.permission(w, uid, a.sheets[existing.SheetID], true, false) {
		return
	}
	if !a.permission(w, uid, a.sheets[input.SheetID], true, false) {
		return
	}
	if exists && existing.SheetID != input.SheetID {
		fail(w, 409, "annotation cannot move between sheets")
		return
	}
	if input.Kind == "" || len(input.Kind) > 100 || len(id) > 200 {
		fail(w, 400, "valid annotation ID and kind required")
		return
	}
	input.ID = id
	if exists {
		input.CreatedAt = existing.CreatedAt
	} else {
		input.CreatedAt = a.now().UTC().Format(time.RFC3339)
	}
	a.annotations[id] = input
	w.WriteHeader(204)
}
