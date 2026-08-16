package main

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
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

// Routes builds the HTTP mux for the API and static UI. Every /api/ route is
// wrapped in guardAPI; Camer has no authentication, so those checks are what
// stand between a stray browser tab and a rewritten proxy config.
func (s *Server) Routes(static http.Handler) http.Handler {
	api := http.NewServeMux()

	api.HandleFunc("GET /api/configs", s.handleListConfigs)
	api.HandleFunc("POST /api/configs", s.handleCreateConfig)
	api.HandleFunc("GET /api/configs/{id}", s.handleGetConfig)
	api.HandleFunc("PUT /api/configs/{id}", s.handleUpdateConfig)
	api.HandleFunc("DELETE /api/configs/{id}", s.handleDeleteConfig)

	api.HandleFunc("GET /api/deploys", s.handleListDeploys)
	api.HandleFunc("GET /api/deploys/latest", s.handleLatestDeploy)
	api.HandleFunc("GET /api/deploys/{id}", s.handleGetDeploy)

	api.HandleFunc("GET /api/endpoint", s.handleResolveEndpoint)
	api.HandleFunc("POST /api/diff", s.handleDiff)
	api.HandleFunc("POST /api/adapt", s.handleAdapt)
	api.HandleFunc("POST /api/load", s.handleLoad)
	api.HandleFunc("POST /api/current", s.handleCurrent)

	mux := http.NewServeMux()
	mux.Handle("/api/", guardAPI(api))
	mux.Handle("/", static)
	return mux
}

// guardAPI rejects requests a browser would only make on another site's behalf,
// and request bodies that are not JSON.
//
// The Content-Type check is what closes the CSRF hole: a cross-origin form can
// send text/plain, and a text/plain body can be crafted so that json.Decode
// accepts it — which would let any page the user visits POST to /api/load and
// reconfigure their server. Only fetch/XHR can set application/json, and doing
// so cross-origin requires a CORS preflight that Camer never answers.
func guardAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutating := r.Method == http.MethodPost || r.Method == http.MethodPut ||
			r.Method == http.MethodPatch || r.Method == http.MethodDelete

		// Sec-Fetch-Site is set by the browser and cannot be forged by script.
		// Its absence means a non-browser client (curl, a script), which no
		// third-party site is able to steer, so absence is allowed.
		if mutating {
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
				writeError(w, http.StatusForbidden,
					"cross-origin request rejected: this endpoint is only callable from Camer's own UI")
				return
			}
		}

		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			if !isJSONContentType(r.Header.Get("Content-Type")) {
				writeError(w, http.StatusUnsupportedMediaType,
					"expected Content-Type: application/json")
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// isJSONContentType reports whether the header names the JSON media type,
// ignoring parameters such as "; charset=utf-8".
func isJSONContentType(header string) bool {
	if header == "" {
		return false
	}
	mt, _, err := mime.ParseMediaType(header)
	if err != nil {
		return false
	}
	return mt == "application/json"
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

// handleResolveEndpoint reports the base URL Camer will actually call for a
// given endpoint string. normalizeBase silently rewrites pasted /load, /adapt
// and /config URLs, so the UI needs a way to show the effective target rather
// than duplicating those rules in JavaScript and drifting from them.
//
// With ?probe=1 it also reports whether a Caddy admin API answers there, which
// is what lets the UI say "unreachable" beside the field before the user has
// tried to apply anything.
func (s *Server) handleResolveEndpoint(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	out := map[string]any{"base": normalizeBase(raw)}

	if r.URL.Query().Get("probe") != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := s.caddy.Probe(ctx, raw); err != nil {
			out["reachable"] = false
			out["error"] = err.Error()
		} else {
			out["reachable"] = true
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleDiff compares a Caddyfile against a recorded deploy — by default the
// one that is live. It backs the pre-apply confirmation, so the question "what
// will this change?" is answered before the change lands rather than after it
// in the audit log.
func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content string `json:"content"`
		// BaseDeployID selects what to compare against; omitted means the last
		// successful deploy, i.e. what Caddy is running.
		BaseDeployID *int64 `json:"base_deploy_id"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var (
		base *Deploy
		err  error
	)
	if in.BaseDeployID != nil {
		var d Deploy
		d, err = s.store.GetDeploy(r.Context(), *in.BaseDeployID)
		if err == nil {
			base = &d
		}
	} else {
		var d Deploy
		d, err = s.store.LatestAppliedDeploy(r.Context())
		if err == nil {
			base = &d
		}
	}
	switch {
	case err == nil, errors.Is(err, ErrNotFound):
		// A missing base is normal: nothing has been applied yet.
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := map[string]any{"base": nil}
	baseContent := ""
	if base != nil {
		baseContent = base.Content
		b := *base
		b.Content = "" // the diff already carries the relevant lines
		out["base"] = b
	}
	out["diff"] = DiffText(baseContent, in.Content)
	writeJSON(w, http.StatusOK, out)
}

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
		// Caddy rejecting the Caddyfile is a 422 the UI shows in the preview
		// pane; an unreachable admin API is a 502 that belongs next to the
		// endpoint field instead. Conflating them makes a valid Caddyfile look
		// invalid whenever the endpoint is wrong.
		writeCaddyError(w, err, http.StatusUnprocessableEntity, "invalid")
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
		writeCaddyError(w, err, http.StatusUnprocessableEntity, "invalid")
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
		writeCaddyError(w, err, http.StatusBadGateway, "caddy_error")
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

// writeCaddyError maps an error from the Caddy client onto a status and a
// machine-readable kind, so the UI can tell "I cannot reach Caddy" apart from
// "your config is wrong" instead of rendering both as one red failure.
//
// kind is "unreachable" for transport failures, otherwise the caller's
// invalidKind — "invalid" for adapt/load, where a Caddy rejection really does
// mean the config is bad, and "caddy_error" for reads, where it does not.
func writeCaddyError(w http.ResponseWriter, err error, invalidStatus int, invalidKind string) {
	var te *TransportError
	if errors.As(err, &te) {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error":    te.Error(),
			"kind":     "unreachable",
			"endpoint": te.Base,
		})
		return
	}
	writeJSON(w, invalidStatus, map[string]string{
		"error": err.Error(),
		"kind":  invalidKind,
	})
}
