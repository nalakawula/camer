package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Server holds dependencies for the HTTP handlers.
type Server struct {
	store *Store
	caddy *CaddyClient
}

// Routes builds the HTTP mux for the API and static UI.
func (s *Server) Routes(static http.Handler) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/configs", s.handleListConfigs)
	mux.HandleFunc("POST /api/configs", s.handleCreateConfig)
	mux.HandleFunc("GET /api/configs/{id}", s.handleGetConfig)
	mux.HandleFunc("PUT /api/configs/{id}", s.handleUpdateConfig)
	mux.HandleFunc("DELETE /api/configs/{id}", s.handleDeleteConfig)

	mux.HandleFunc("GET /api/deploys", s.handleListDeploys)
	mux.HandleFunc("GET /api/deploys/latest", s.handleLatestDeploy)
	mux.HandleFunc("GET /api/deploys/{id}", s.handleGetDeploy)

	mux.HandleFunc("POST /api/adapt", s.handleAdapt)
	mux.HandleFunc("POST /api/load", s.handleLoad)
	mux.HandleFunc("POST /api/current", s.handleCurrent)

	mux.Handle("/", static)
	return mux
}

// ---- config CRUD ----

func (s *Server) handleListConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := s.store.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, configs)
}

func (s *Server) handleCreateConfig(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		in.Name = "Untitled Caddyfile"
	}
	c, err := s.store.Create(r.Context(), in.Name, in.Content)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	c, err := s.store.Get(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "config not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		in.Name = "Untitled Caddyfile"
	}
	c, err := s.store.Update(r.Context(), id, in.Name, in.Content)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "config not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteConfig(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.Delete(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "config not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- deploy history (audit) ----

func (s *Server) handleListDeploys(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	deploys, err := s.store.ListDeploys(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, deploys)
}

// handleLatestDeploy returns the most recent successful deploy — what the UI
// opens with so the editor starts from the configuration that is live.
func (s *Server) handleLatestDeploy(w http.ResponseWriter, r *http.Request) {
	d, err := s.store.LatestAppliedDeploy(r.Context())
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "no config has been applied yet")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := map[string]any{"deploy": d}
	// Tell the UI whether the source draft still matches what was applied.
	if d.ConfigID != nil {
		if c, err := s.store.Get(r.Context(), *d.ConfigID); err == nil {
			out["config"] = c
			out["drifted"] = c.Content != d.Content
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetDeploy returns one deploy along with a line diff against the
// configuration it replaced (the previous successful deploy).
func (s *Server) handleGetDeploy(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := s.store.GetDeploy(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "deploy not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := map[string]any{"deploy": d, "base": nil}
	baseContent := ""
	prev, err := s.store.PreviousAppliedDeploy(r.Context(), d.ID)
	switch {
	case err == nil:
		baseContent = prev.Content
		prev.Content = "" // the diff carries the relevant lines
		out["base"] = prev
	case !errors.Is(err, ErrNotFound):
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out["diff"] = DiffText(baseContent, d.Content)
	writeJSON(w, http.StatusOK, out)
}

// ---- Caddy admin proxy ----

func (s *Server) handleAdapt(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Caddyfile string `json:"caddyfile"`
		Endpoint  string `json:"endpoint"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	res, err := s.caddy.Adapt(ctx, in.Endpoint, in.Caddyfile)
	if err != nil {
		// A failed adapt is a config/connection problem, not a server fault;
		// surface it as 422 so the UI can show it inline.
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"json":     prettyJSON(res.Result),
		"warnings": res.Warnings,
	})
}

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Caddyfile string `json:"caddyfile"`
		Endpoint  string `json:"endpoint"`
		ConfigID  *int64 `json:"config_id"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	err := s.caddy.Load(ctx, in.Endpoint, in.Caddyfile)
	msg := "configuration applied"
	if err != nil {
		msg = err.Error()
	}
	// Best-effort audit log; never block the response on it.
	_ = s.store.RecordDeploy(ctx, in.ConfigID, in.Caddyfile, in.Endpoint, err == nil, msg)

	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": msg})
}

func (s *Server) handleCurrent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	raw, err := s.caddy.CurrentConfig(ctx, in.Endpoint)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"json": prettyJSON(raw)})
}

// ---- helpers ----

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

func decodeBody(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
