package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// newTestServer builds a Server backed by a throwaway database, with the same
// route wiring and guards as production.
func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	srv := &Server{store: store, caddy: NewCaddyClient()}
	return srv.Routes(http.NotFoundHandler())
}

// do issues a request and returns the recorder. headers are applied as
// key/value pairs.
func do(t *testing.T, h http.Handler, method, path, body string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestGuardAllowsSameOriginJSON(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "POST", "/api/configs", `{"name":"ok","content":"a"}`,
		"Content-Type", "application/json",
		"Sec-Fetch-Site", "same-origin")
	if res.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", res.Code, res.Body)
	}
}

// A charset parameter is normal from fetch() and must not be rejected.
func TestGuardAllowsJSONWithCharset(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "POST", "/api/configs", `{"name":"ok","content":"a"}`,
		"Content-Type", "application/json; charset=utf-8",
		"Sec-Fetch-Site", "same-origin")
	if res.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", res.Code, res.Body)
	}
}

// Non-browser clients send no Sec-Fetch-Site; no third-party site can steer
// them, so they stay allowed.
func TestGuardAllowsMissingSecFetchSite(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "POST", "/api/configs", `{"name":"cli","content":"a"}`,
		"Content-Type", "application/json")
	if res.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", res.Code, res.Body)
	}
}

func TestGuardRejectsCrossSiteWrites(t *testing.T) {
	h := newTestServer(t)
	for _, site := range []string{"cross-site", "same-site", "none"} {
		res := do(t, h, "POST", "/api/configs", `{"name":"evil","content":"x"}`,
			"Content-Type", "application/json",
			"Sec-Fetch-Site", site)
		if res.Code != http.StatusForbidden {
			t.Errorf("Sec-Fetch-Site %q: want 403, got %d: %s", site, res.Code, res.Body)
		}
	}
}

// The CSRF vector this closes: a cross-origin form can only send text/plain,
// url-encoded or multipart bodies, and a text/plain body can be shaped so that
// json.Decode accepts it.
func TestGuardRejectsNonJSONBody(t *testing.T) {
	h := newTestServer(t)
	for _, ct := range []string{
		"text/plain",
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=x",
		"",
	} {
		res := do(t, h, "POST", "/api/load",
			`{"caddyfile":":80 {\n}\n","endpoint":"http://localhost:2019"}`,
			"Content-Type", ct)
		if res.Code != http.StatusUnsupportedMediaType {
			t.Errorf("Content-Type %q: want 415, got %d: %s", ct, res.Code, res.Body)
		}
	}
}

// DELETE carries no body, so it is origin-checked but not content-type checked.
func TestGuardChecksOriginOnDelete(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "DELETE", "/api/configs/1", "", "Sec-Fetch-Site", "cross-site")
	if res.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", res.Code, res.Body)
	}
}

// Reads are safe and must stay usable from anywhere, including a bare browser
// navigation with no headers set.
func TestGuardLeavesReadsAlone(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "GET", "/api/configs", "", "Sec-Fetch-Site", "cross-site")
	if res.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", res.Code, res.Body)
	}
}

// CAM-04 shows the user the endpoint Camer will really call, which means the
// normalization rules must be readable over the API rather than reimplemented
// in the browser.
func TestResolveEndpoint(t *testing.T) {
	h := newTestServer(t)
	cases := map[string]string{
		"http://localhost:2019/load":    "http://localhost:2019",
		"http://localhost:2019/adapt":   "http://localhost:2019",
		"http://localhost:2019/config/": "http://localhost:2019",
		"localhost:2019":                "http://localhost:2019",
		"http://localhost:2019/":        "http://localhost:2019",
		"":                              "http://localhost:2019",
	}
	for in, want := range cases {
		res := do(t, h, "GET", "/api/endpoint?url="+in, "")
		if res.Code != http.StatusOK {
			t.Fatalf("%q: want 200, got %d", in, res.Code)
		}
		var out struct{ Base string }
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatalf("%q: decode: %v", in, err)
		}
		if out.Base != want {
			t.Errorf("%q: want base %q, got %q", in, want, out.Base)
		}
	}
}

// CAM-06: an unreachable admin API must be reported as such, never as an
// invalid Caddyfile. Port 1 is reserved and refuses connections.
func TestUnreachableEndpointIsNotAConfigError(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "POST", "/api/adapt",
		`{"caddyfile":":80 {\n}\n","endpoint":"http://127.0.0.1:1"}`,
		"Content-Type", "application/json",
		"Sec-Fetch-Site", "same-origin")

	if res.Code != http.StatusBadGateway {
		t.Fatalf("want 502 for an unreachable endpoint, got %d: %s", res.Code, res.Body)
	}
	var out struct {
		Kind     string `json:"kind"`
		Endpoint string `json:"endpoint"`
		Error    string `json:"error"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Kind != "unreachable" {
		t.Errorf("want kind %q, got %q", "unreachable", out.Kind)
	}
	if out.Endpoint != "http://127.0.0.1:1" {
		t.Errorf("want the contacted base reported back, got %q", out.Endpoint)
	}
	if strings.Contains(strings.ToLower(out.Error), "invalid") {
		t.Errorf("message should not suggest the Caddyfile is invalid: %q", out.Error)
	}
}

// CAM-07: the pre-apply confirmation diffs the editor against what is live, so
// /api/diff must default its base to the latest successful deploy.
func TestDiffAgainstLiveDeploy(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	h := (&Server{store: store, caddy: NewCaddyClient()}).Routes(http.NotFoundHandler())

	ctx := context.Background()
	// A failed deploy must not become the diff base.
	if err := store.RecordDeploy(ctx, nil, "old line\n", "e", true, "ok"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordDeploy(ctx, nil, "garbage\n", "e", false, "rejected"); err != nil {
		t.Fatal(err)
	}

	post := func(body string) map[string]any {
		res := do(t, h, "POST", "/api/diff", body,
			"Content-Type", "application/json", "Sec-Fetch-Site", "same-origin")
		if res.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", res.Code, res.Body)
		}
		var out map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	out := post(`{"content":"new line\n"}`)
	base, ok := out["base"].(map[string]any)
	if !ok {
		t.Fatalf("want a base deploy, got %v", out["base"])
	}
	if got := base["id"].(float64); got != 1 {
		t.Errorf("base should be the last SUCCESSFUL deploy (#1), got #%v", got)
	}
	// Content is omitempty, so stripping it drops the field entirely.
	if c, present := base["content"]; present && c != "" {
		t.Errorf("base content should be stripped; the diff already carries the lines, got %q", c)
	}
	diff := out["diff"].(map[string]any)
	if diff["added"].(float64) != 1 || diff["removed"].(float64) != 1 {
		t.Errorf("want +1/-1, got +%v/-%v", diff["added"], diff["removed"])
	}

	// Re-applying the live config must read as "no change", not as a rewrite.
	if !post(`{"content":"old line\n"}`)["diff"].(map[string]any)["identical"].(bool) {
		t.Error("identical content should report identical")
	}

	// An explicit base id selects that deploy even when it failed.
	if got := post(`{"content":"garbage\n","base_deploy_id":2}`)["diff"].(map[string]any)["identical"].(bool); !got {
		t.Error("explicit base_deploy_id should be honoured")
	}
}

// With nothing applied yet there is no base; the UI presents that as a
// first-time apply rather than an error.
func TestDiffWithNoDeploysYet(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "POST", "/api/diff", `{"content":"a\nb\n"}`,
		"Content-Type", "application/json", "Sec-Fetch-Site", "same-origin")
	if res.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", res.Code, res.Body)
	}
	var out map[string]any
	json.Unmarshal(res.Body.Bytes(), &out)
	if out["base"] != nil {
		t.Errorf("want nil base, got %v", out["base"])
	}
	if got := out["diff"].(map[string]any)["added"].(float64); got != 2 {
		t.Errorf("want both lines as additions, got %v", got)
	}
}

// CAM-13: the probe reports unreachable without pretending the config is bad.
func TestEndpointProbeUnreachable(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "GET", "/api/endpoint?url=http://127.0.0.1:1&probe=1", "")
	if res.Code != http.StatusOK {
		t.Fatalf("want 200 (the probe result is the payload), got %d", res.Code)
	}
	var out struct {
		Base      string `json:"base"`
		Reachable bool   `json:"reachable"`
		Error     string `json:"error"`
	}
	json.Unmarshal(res.Body.Bytes(), &out)
	if out.Reachable {
		t.Error("port 1 should not be reachable")
	}
	if out.Error == "" {
		t.Error("want an explanation of why it is unreachable")
	}
	if out.Base != "http://127.0.0.1:1" {
		t.Errorf("want base echoed, got %q", out.Base)
	}
}

// Without ?probe the handler must not make any network call, so it stays cheap
// enough to sit in the apply path.
func TestEndpointResolveDoesNotProbe(t *testing.T) {
	h := newTestServer(t)
	res := do(t, h, "GET", "/api/endpoint?url=http://127.0.0.1:1", "")
	var out map[string]any
	json.Unmarshal(res.Body.Bytes(), &out)
	if _, present := out["reachable"]; present {
		t.Error("reachable should be absent when probe was not requested")
	}
}

// CAM-30: the audit write must survive a request whose context is already done.
// Sharing the request context meant a slow Caddy, or a client that navigated
// away, silently lost the record.
func TestAuditRecordSurvivesCancelledRequest(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	h := (&Server{store: store, caddy: NewCaddyClient()}).Routes(http.NotFoundHandler())

	// Cancel before serving: the handler's own r.Context() is dead on arrival,
	// which is the worst case for the audit write.
	ctx, cancel := context.WithCancel(context.Background())
	r := httptest.NewRequest("POST", "/api/load",
		strings.NewReader(`{"caddyfile":":80 {\n}\n","endpoint":"http://127.0.0.1:1"}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	cancel()

	h.ServeHTTP(httptest.NewRecorder(), r)

	// The apply could not succeed (port 1), but the attempt must be on record.
	n, err := store.CountDeploys(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want the failed apply recorded despite the cancelled request, got %d rows", n)
	}
}

func TestIsLoopbackAddr(t *testing.T) {
	loopback := []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787", "127.0.0.53:80"}
	public := []string{":8787", "0.0.0.0:8787", "[::]:8787", "192.168.1.10:8787", "example.com:8787"}

	for _, a := range loopback {
		if !isLoopbackAddr(a) {
			t.Errorf("%q should be loopback", a)
		}
	}
	for _, a := range public {
		if isLoopbackAddr(a) {
			t.Errorf("%q should not be loopback", a)
		}
	}
}

func TestDisplayURL(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1:8787": "http://127.0.0.1:8787",
		":8787":          "http://localhost:8787",
		"0.0.0.0:8787":   "http://localhost:8787",
		"[::1]:8787":     "http://[::1]:8787",
	}
	for in, want := range cases {
		if got := displayURL(in); got != want {
			t.Errorf("displayURL(%q) = %q, want %q", in, got, want)
		}
	}
}
