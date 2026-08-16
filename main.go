package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", envOr("CAMER_ADDR", ":8787"), "HTTP listen address")
	dbPath := flag.String("db", envOr("CAMER_DB", "camer.db"), "path to SQLite database file")
	flag.Parse()

	store, err := OpenStore(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer store.Close()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("mount web assets: %v", err)
	}

	srv := &Server{store: store, caddy: NewCaddyClient()}
	handler := srv.Routes(http.FileServer(http.FS(sub)))

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("camer listening on http://localhost%s (db: %s)", *addr, *dbPath)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
