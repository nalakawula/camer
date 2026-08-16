package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", envOr("CAMER_ADDR", "127.0.0.1:8787"), "HTTP listen address")
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

	warnIfPubliclyBound(*addr)

	go func() {
		log.Printf("camer listening on %s (db: %s)", displayURL(*addr), *dbPath)
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

// warnIfPubliclyBound logs a prominent warning when Camer listens on anything
// other than loopback. Camer has no authentication, and POST /api/load
// reconfigures a live web server, so a non-loopback bind hands control of the
// proxy to anyone who can reach the port.
func warnIfPubliclyBound(addr string) {
	if isLoopbackAddr(addr) {
		return
	}
	log.Printf("WARNING: listening on %q, which is not loopback-only.", addr)
	log.Printf("WARNING: Camer has no authentication and can reconfigure the live Caddy server.")
	log.Printf("WARNING: prefer -addr 127.0.0.1:8787 with SSH port forwarding, or put an")
	log.Printf("WARNING: authenticating reverse proxy in front of Camer.")
}

// isLoopbackAddr reports whether addr binds the loopback interface only. A
// missing host (":8787") means every interface, so it is not loopback.
func isLoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// displayURL turns a listen address into a URL a user can click. A wildcard
// bind has no single correct hostname, so it is shown as localhost.
func displayURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return "http://" + host + ":" + port
}
