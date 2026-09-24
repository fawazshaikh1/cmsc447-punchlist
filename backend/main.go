package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	local := os.Getenv("LOCAL_DEV") == "true"
	origin := os.Getenv("APP_ORIGIN")
	if origin == "" {
		if !local {
			log.Fatal("APP_ORIGIN is required (or use LOCAL_DEV=true for localhost)")
		}
		origin = "http://localhost:5173"
	}
	addr := ":8080"
	if local {
		addr = "127.0.0.1:8080"
	}
	app := newApplication(origin, !local)
	server := &http.Server{Addr: addr, Handler: app.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Prototype API on %s; ALL data is in memory and lost on restart", addr)
	log.Fatal(server.ListenAndServe())
}
