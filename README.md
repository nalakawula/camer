# Camer — Caddyfile Manager

A web UI to edit Caddyfiles, preview the adapted native JSON live, and apply the
config to a running Caddy via its admin API.

- **Go 1.26** — single static binary, embedded web assets
- **SQLite** via `modernc.org/sqlite` — pure Go, **no CGO / no gcc** required
- **CodeMirror 6** and all web fonts are vendored under `web/vendor/` and
  embedded in the binary, so the editor works with no network. See
  [Vendored assets](#vendored-assets).
- Design follows `ui-prototype/` (Material dark "Developer" theme)

## Features

- Edit Caddyfiles in a syntax-highlighted editor (CodeMirror 6), with brace
  matching, auto-closing braces and block-aware indentation from the language.
- **Patterns** inserts a snippet and selects its first placeholder; `Tab` steps
  through the rest. A placeholder that repeats — the domain in the www-redirect
  pattern, say — is filled everywhere at once as you type it.
- Live **JSON preview** — the Caddyfile is adapted through Caddy's `/adapt`
  endpoint as you type (debounced), with adaptation warnings surfaced inline.
- The JSON pane has three explicit views: **Adapted** (your Caddyfile),
  **Running** (what Caddy is serving), and **Compare** (a diff of the two, with
  both sides key-sorted so only real differences show). Documents support
  **find**, **collapsible objects** and a wrap toggle — real configs run to
  thousands of lines. Search reaches inside collapsed blocks and opens them.
- **Save drafts** to SQLite and reopen them from the sidebar.
- **Apply to the running server** via `/load`, behind a confirmation that shows
  the target endpoint and a **line diff against the configuration that is
  currently live** — so "what will this change?" is answered before the change
  lands. Every apply is recorded in a `deploys` audit table.
- **Re-apply any past deploy** from the history, for one-click rollback.
- **Opens where you left off** — on load the editor starts from the last
  successfully applied Caddyfile (its saved draft when one still exists, with a
  notice if that draft has drifted from what is actually running), not a sample.
- **Deploy History** — an audit trail of every apply: what/when, the
  endpoint, success or the Caddy error, and a line **diff against the
  configuration it replaced** (the previous successful apply). Any past deploy
  can be loaded back into the editor.
- **Pull Running** — fetch the running config into its own tab, where it stays
  put instead of vanishing on the next keystroke.
- `Ctrl/Cmd+S` to save, `Ctrl/Cmd+Enter` to open the apply confirmation, `?`
  for the full shortcut list. Unsaved-changes guard on navigation.
- Draggable editor/JSON split (arrow keys when the divider has focus); the
  ratio, endpoint and wrap setting persist across sessions.
- Keyboard- and screen-reader accessible; responsive down to phone widths;
  honours `prefers-reduced-motion`.

The browser only ever talks to Camer; Camer proxies to the Caddy admin API
server-side, so there are no CORS issues and the admin endpoint may be bound to
localhost or a private address.

## Run

```sh
go run .                 # listens on 127.0.0.1:8787, db at ./camer.db
# or
go build -o camer . && ./camer
```

Flags / env:

| Flag     | Env          | Default            | Description               |
|----------|--------------|--------------------|---------------------------|
| `-addr`  | `CAMER_ADDR` | `127.0.0.1:8787`   | HTTP listen address       |
| `-db`    | `CAMER_DB`   | `camer.db`         | SQLite database file path  |

Open http://localhost:8787, set the **Admin API Endpoint** (e.g.
`http://localhost:2019` — a full `/load` URL is also accepted), edit, preview,
and apply.

## Vendored assets

`web/vendor/` holds CodeMirror 6 (one 310 KB Rollup bundle) and the web fonts,
including a Material Symbols subset containing only the icons the UI uses. They
are committed, so **`go build` alone produces a working binary** — no Node, no
npm, no network.

The tooling in `tools/` only exists to regenerate them; see `tools/README.md`.

The one exception is Tailwind, still loaded from `cdn.tailwindcss.com`. Without
it the page renders unstyled but stays fully functional — a far softer failure
than a missing editor, which used to leave a page that looked fine and did
nothing.

## Security

**Camer has no authentication, and applying a config reconfigures a live web
server.** It therefore listens on loopback only by default. Anyone who can reach
the port can rewrite your Caddy configuration.

To use it on a remote host, forward the port over SSH rather than binding a
public interface:

```sh
ssh -L 8787:127.0.0.1:8787 user@host
```

Overriding `-addr` with a non-loopback address logs a warning at startup. If you
must expose Camer, put an authenticating reverse proxy in front of it.

Mutating API requests are rejected unless they are same-origin and carry
`Content-Type: application/json`, which prevents another site in the user's
browser from driving Camer's API. That is a CSRF defence, not authentication.

## API

| Method | Path                 | Purpose                                   |
|--------|----------------------|-------------------------------------------|
| GET    | `/api/configs`       | list saved Caddyfiles                      |
| POST   | `/api/configs`       | create `{name, content}`                   |
| GET    | `/api/configs/{id}`  | fetch one                                  |
| PUT    | `/api/configs/{id}`  | update `{name, content}`                   |
| DELETE | `/api/configs/{id}`  | delete                                     |
| GET    | `/api/endpoint`      | `?url=` → base URL; `&probe=1` adds reachability |
| POST   | `/api/diff`          | `{content, base_deploy_id?}` → diff vs a deploy (default: live) |
| POST   | `/api/adapt`         | adapt `{caddyfile, endpoint}` → JSON       |
| POST   | `/api/load`          | apply `{caddyfile, endpoint, config_id?}`  |
| POST   | `/api/current`       | pull running config `{endpoint}` → JSON    |
| POST   | `/api/compare`       | adapted vs running JSON, key-sorted → diff |
| GET    | `/api/deploys`       | history page → `{deploys, total, offset}` (`?limit=&offset=`) |
| GET    | `/api/deploys/latest`| last **successful** deploy + source config |
| GET    | `/api/deploys/{id}`  | one deploy + diff vs the config it replaced|

Errors carry a `kind` so the UI can react appropriately: `unreachable` (502 —
the admin API could not be contacted, and the payload names the `endpoint`
tried), `invalid` (422 — Caddy rejected the config), `caddy_error` (502 — Caddy
refused a read).
