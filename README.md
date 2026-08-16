# Camer — Caddyfile Manager

A web UI to edit Caddyfiles, preview the adapted native JSON live, and apply the
config to a running Caddy via its admin API.

- **Go 1.26** — single static binary, embedded web assets
- **SQLite** via `modernc.org/sqlite` — pure Go, **no CGO / no gcc** required
- Design follows `ui-prototype/` (Material dark "Developer" theme)

## Features

- Edit Caddyfiles in a syntax-highlighted editor (CodeMirror).
- Live **JSON preview** — the Caddyfile is adapted through Caddy's `/adapt`
  endpoint as you type (debounced), with adaptation warnings surfaced inline.
- **Save drafts** to SQLite and reopen them from the sidebar.
- **Submit to Admin API** — applies the Caddyfile to the running server via
  `/load`. Every apply is recorded in a `deploys` audit table.
- **Opens where you left off** — on load the editor starts from the last
  successfully applied Caddyfile (its saved draft when one still exists, with a
  notice if that draft has drifted from what is actually running), not a sample.
- **Deploy History** — an audit trail of every submit: who/what/when, the
  endpoint, success or the Caddy error, and a line **diff against the
  configuration it replaced** (the previous successful apply). Any past deploy
  can be loaded back into the editor.
- **Pull Current** — load the running config's JSON into the preview.
- `Ctrl/Cmd+S` to save. Unsaved-changes guard on navigation.

The browser only ever talks to Camer; Camer proxies to the Caddy admin API
server-side, so there are no CORS issues and the admin endpoint may be bound to
localhost or a private address.

## Run

```sh
go run .                 # listens on :8787, db at ./camer.db
# or
go build -o camer . && ./camer
```

Flags / env:

| Flag     | Env          | Default            | Description               |
|----------|--------------|--------------------|---------------------------|
| `-addr`  | `CAMER_ADDR` | `:8787`            | HTTP listen address       |
| `-db`    | `CAMER_DB`   | `camer.db`         | SQLite database file path  |

Open http://localhost:8787, set the **Admin API Endpoint** (e.g.
`http://localhost:2019` — a full `/load` URL is also accepted), edit, preview,
and submit.

## API

| Method | Path                 | Purpose                                   |
|--------|----------------------|-------------------------------------------|
| GET    | `/api/configs`       | list saved Caddyfiles                      |
| POST   | `/api/configs`       | create `{name, content}`                   |
| GET    | `/api/configs/{id}`  | fetch one                                  |
| PUT    | `/api/configs/{id}`  | update `{name, content}`                   |
| DELETE | `/api/configs/{id}`  | delete                                     |
| POST   | `/api/adapt`         | adapt `{caddyfile, endpoint}` → JSON       |
| POST   | `/api/load`          | apply `{caddyfile, endpoint, config_id?}`  |
| POST   | `/api/current`       | pull running config `{endpoint}` → JSON    |
| GET    | `/api/deploys`       | deploy history, newest first (`?limit=`)   |
| GET    | `/api/deploys/latest`| last **successful** deploy + source config |
| GET    | `/api/deploys/{id}`  | one deploy + diff vs the config it replaced|
