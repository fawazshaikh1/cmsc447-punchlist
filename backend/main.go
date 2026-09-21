package main

import (
	"encoding/json"
	"fmt"
	"net/http"
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

func main() {
	http.HandleFunc("/api/sheets/", func(w http.ResponseWriter, r *http.Request) {
		// One hardcoded annotation, just to prove the server responds correctly.
		annotations := []Annotation{
			{
				ID:        "test-1",
				SheetID:   "sheet-1",
				Kind:      "pin",
				CreatedAt: "2026-09-10T12:00:00Z",
				X:         200,
				Y:         642,
				Payload:   map[string]interface{}{"description": "Cracked tile", "status": "open"},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(annotations)
	})

	fmt.Println("Backend running on http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
