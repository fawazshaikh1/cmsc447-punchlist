package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Annotation is the shape the frontend expects (from HttpAnnotationRepository.js).
type Annotation struct {
	ID        string                 `json:"id"`
	SheetID   string                 `json:"sheetId"`
	Kind      string                 `json:"kind"`
	CreatedAt string                 `json:"createdAt"`
	X         float64                `json:"x"`
	Y         float64                `json:"y"`
	Payload   map[string]interface{} `json:"payload"`
}

// In-memory storage. The map key is the annotation's ID.
// A mutex protects it so concurrent requests don't corrupt the map.
var (
	store = make(map[string]Annotation)
	mu    sync.Mutex
)

func main() {
	// Handles /api/sheets/{sheetId}/annotations  (GET all, DELETE all)
	http.HandleFunc("/api/sheets/", handleSheetAnnotations)

	// Handles /api/annotations/{id}  (PUT save, DELETE one)
	http.HandleFunc("/api/annotations/", handleSingleAnnotation)

	fmt.Println("Backend running on http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}

// GET    /api/sheets/{sheetId}/annotations -> all annotations for that sheet
// DELETE /api/sheets/{sheetId}/annotations -> delete all for that sheet
func handleSheetAnnotations(w http.ResponseWriter, r *http.Request) {
	// URL looks like: /api/sheets/sheet-1/annotations
	// Pull out the sheetId (the piece between "sheets/" and "/annotations").
	path := strings.TrimPrefix(r.URL.Path, "/api/sheets/")
	sheetID := strings.TrimSuffix(path, "/annotations")

	mu.Lock()
	defer mu.Unlock()

	switch r.Method {
	case http.MethodGet:
		result := []Annotation{}
		for _, a := range store {
			if a.SheetID == sheetID {
				result = append(result, a)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)

	case http.MethodDelete:
		for id, a := range store {
			if a.SheetID == sheetID {
				delete(store, id)
			}
		}
		w.WriteHeader(http.StatusNoContent) // 204

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// PUT    /api/annotations/{id} -> create or update one annotation
// DELETE /api/annotations/{id} -> delete one annotation
func handleSingleAnnotation(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/annotations/")

	mu.Lock()
	defer mu.Unlock()

	switch r.Method {
	case http.MethodPut:
		var a Annotation
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		a.ID = id // trust the ID from the URL
		if a.CreatedAt == "" {
			a.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		store[id] = a
		w.WriteHeader(http.StatusNoContent) // 204

	case http.MethodDelete:
		delete(store, id)
		w.WriteHeader(http.StatusNoContent) // 204

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
