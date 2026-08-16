package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CaddyClient talks to a Caddy admin API endpoint.
type CaddyClient struct {
	http *http.Client
}

// NewCaddyClient builds a client with sensible timeouts.
func NewCaddyClient() *CaddyClient {
	return &CaddyClient{http: &http.Client{Timeout: 15 * time.Second}}
}

// AdaptResult is the response of Caddy's /adapt endpoint.
type AdaptResult struct {
	// Result is the adapted native JSON config.
	Result json.RawMessage `json:"result"`
	// Warnings are non-fatal adaptation warnings.
	Warnings []AdaptWarning `json:"warnings"`
}

// AdaptWarning is a single warning emitted while adapting a Caddyfile.
type AdaptWarning struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Directive string `json:"directive"`
	Message   string `json:"message"`
}

// normalizeBase strips a known admin sub-path (e.g. /load, /adapt, /config)
// and any trailing slash so callers may paste either a base URL or a full
// endpoint URL as shown in the UI.
func normalizeBase(endpoint string) string {
	e := strings.TrimSpace(endpoint)
	if e == "" {
		e = "http://localhost:2019"
	}
	if !strings.HasPrefix(e, "http://") && !strings.HasPrefix(e, "https://") {
		e = "http://" + e
	}
	e = strings.TrimRight(e, "/")
	for _, suffix := range []string{"/load", "/adapt"} {
		if strings.HasSuffix(e, suffix) {
			e = strings.TrimSuffix(e, suffix)
			break
		}
	}
	e = strings.TrimSuffix(e, "/config")
	return strings.TrimRight(e, "/")
}

// Adapt converts a Caddyfile to native JSON without loading it, using the
// admin API's /adapt endpoint.
func (c *CaddyClient) Adapt(ctx context.Context, endpoint, caddyfile string) (*AdaptResult, error) {
	base := normalizeBase(endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/adapt", strings.NewReader(caddyfile))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "text/caddyfile")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("contacting caddy admin at %s: %w", base, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s", apiError(body, resp.StatusCode))
	}

	var out AdaptResult
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decoding adapt response: %w", err)
	}
	return &out, nil
}

// Load applies a Caddyfile to the running Caddy instance via the /load
// endpoint. Caddy adapts the Caddyfile server-side.
func (c *CaddyClient) Load(ctx context.Context, endpoint, caddyfile string) error {
	base := normalizeBase(endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/load", strings.NewReader(caddyfile))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "text/caddyfile")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("contacting caddy admin at %s: %w", base, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s", apiError(body, resp.StatusCode))
	}
	return nil
}

// CurrentConfig fetches the running native JSON config from /config/.
func (c *CaddyClient) CurrentConfig(ctx context.Context, endpoint string) (json.RawMessage, error) {
	base := normalizeBase(endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/config/", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("contacting caddy admin at %s: %w", base, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s", apiError(body, resp.StatusCode))
	}
	return json.RawMessage(body), nil
}

// apiError extracts a human-readable message from a Caddy admin error body,
// which is typically {"error":"..."}.
func apiError(body []byte, status int) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return e.Error
	}
	msg := strings.TrimSpace(string(body))
	if msg == "" {
		return fmt.Sprintf("caddy admin returned HTTP %d", status)
	}
	if len(msg) > 500 {
		msg = msg[:500] + "…"
	}
	return msg
}

// prettyJSON re-indents raw JSON for display; on failure it returns the input.
func prettyJSON(raw json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return string(raw)
	}
	return buf.String()
}
