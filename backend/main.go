package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Annotation matches the shape the frontend sends and expects.
type Annotation struct {
	ID        string          `json:"id"`
	SheetID   string          `json:"sheetId"`
	Kind      string          `json:"kind"`
	CreatedAt string          `json:"createdAt"`
	X         float64         `json:"x"`
	Y         float64         `json:"y"`
	Payload   json.RawMessage `json:"payload"`
}

var db *pgxpool.Pool

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:dev@localhost:5432/punchlist"
	}

	var err error
	db, err = pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("cannot create db pool: %v", err)
	}
	defer db.Close()

	if err := db.Ping(context.Background()); err != nil {
		log.Fatalf("cannot reach database: %v", err)
	}
	log.Println("connected to database")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/sheets/", handleSheetAnnotations)
	mux.HandleFunc("/api/annotations/", handleSingleAnnotation)

	log.Println("server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", withCORS(mux)))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// /api/sheets/{sheetId}/annotations
func handleSheetAnnotations(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/sheets/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "annotations" {
		http.NotFound(w, r)
		return
	}
	sheetID := parts[0]

	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query(r.Context(),
			`SELECT id, sheet_id, kind, COALESCE(x, 0), COALESCE(y, 0), payload, created_at
			 FROM annotations WHERE sheet_id = $1 ORDER BY created_at, id`, sheetID)
		if err != nil {
			log.Printf("list annotations: %v", err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		list := []Annotation{}
		for rows.Next() {
			var a Annotation
			var created time.Time
			if err := rows.Scan(&a.ID, &a.SheetID, &a.Kind, &a.X, &a.Y, &a.Payload, &created); err != nil {
				log.Printf("scan annotation: %v", err)
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			a.CreatedAt = created.UTC().Format(time.RFC3339)
			list = append(list, a)
		}
		if err := rows.Err(); err != nil {
			log.Printf("rows: %v", err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, list)

	case http.MethodDelete:
		if _, err := db.Exec(r.Context(), `DELETE FROM annotations WHERE sheet_id = $1`, sheetID); err != nil {
			log.Printf("delete sheet annotations: %v", err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// /api/annotations/{id}
func handleSingleAnnotation(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/annotations/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodPut:
		var a Annotation
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		a.ID = id
		if len(a.Payload) == 0 || string(a.Payload) == "null" {
			a.Payload = json.RawMessage("{}")
		}
		created := time.Now().UTC()
		if a.CreatedAt != "" {
			if t, err := time.Parse(time.RFC3339, a.CreatedAt); err == nil {
				created = t
			}
		}

		// Upsert: PUT is idempotent. created_at is kept from the first save.
		_, err := db.Exec(r.Context(),
			`INSERT INTO annotations (id, sheet_id, kind, x, y, payload, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE
			 SET sheet_id = EXCLUDED.sheet_id,
			     kind     = EXCLUDED.kind,
			     x        = EXCLUDED.x,
			     y        = EXCLUDED.y,
			     payload  = EXCLUDED.payload`,
			a.ID, a.SheetID, a.Kind, a.X, a.Y, []byte(a.Payload), created)
		if err != nil {
			log.Printf("save annotation: %v", err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case http.MethodDelete:
		if _, err := db.Exec(r.Context(), `DELETE FROM annotations WHERE id = $1`, id); err != nil {
			log.Printf("delete annotation: %v", err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
