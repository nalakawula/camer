package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a config row does not exist.
var ErrNotFound = errors.New("config not found")

// Config is a stored Caddyfile draft.
type Config struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Deploy is one recorded attempt at applying a Caddyfile to Caddy.
type Deploy struct {
	ID       int64  `json:"id"`
	ConfigID *int64 `json:"config_id"`
	// ConfigName is the name of the source config, empty when the deploy was
	// made from an unsaved draft or the config has since been deleted.
	ConfigName string `json:"config_name"`
	// Content is only populated for single-deploy lookups.
	Content   string    `json:"content,omitempty"`
	Endpoint  string    `json:"endpoint"`
	OK        bool      `json:"ok"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS configs (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	content    TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deploys (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	config_id  INTEGER,
	content    TEXT NOT NULL,
	endpoint   TEXT NOT NULL,
	ok         INTEGER NOT NULL,
	message    TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

// OpenStore opens (creating if needed) the SQLite database at path and
// ensures the schema exists. It uses the pure-Go modernc.org/sqlite driver
// so no CGO/gcc is required.
func OpenStore(path string) (*Store, error) {
	// _pragma options keep a single-file DB responsive under the web UI.
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// modernc's driver is not safe for unbounded concurrent writers on one conn.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// List returns all configs, most recently updated first.
func (s *Store) List(ctx context.Context) ([]Config, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, content, created_at, updated_at FROM configs ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Config{}
	for rows.Next() {
		var c Config
		if err := rows.Scan(&c.ID, &c.Name, &c.Content, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Get returns a single config by id.
func (s *Store) Get(ctx context.Context, id int64) (Config, error) {
	var c Config
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, content, created_at, updated_at FROM configs WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Content, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Config{}, ErrNotFound
	}
	return c, err
}

// Create inserts a new config and returns it.
func (s *Store) Create(ctx context.Context, name, content string) (Config, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO configs (name, content) VALUES (?, ?)`, name, content)
	if err != nil {
		return Config{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Config{}, err
	}
	return s.Get(ctx, id)
}

// Update replaces the name and content of an existing config.
func (s *Store) Update(ctx context.Context, id int64, name, content string) (Config, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE configs SET name = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		name, content, id)
	if err != nil {
		return Config{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Config{}, ErrNotFound
	}
	return s.Get(ctx, id)
}

// Delete removes a config by id.
func (s *Store) Delete(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM configs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordDeploy stores the outcome of a deploy attempt for auditing.
func (s *Store) RecordDeploy(ctx context.Context, configID *int64, content, endpoint string, ok bool, message string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO deploys (config_id, content, endpoint, ok, message) VALUES (?, ?, ?, ?, ?)`,
		configID, content, endpoint, ok, message)
	return err
}

// deploySelect is the common projection for deploy queries. The join yields a
// NULL name when the deploy came from an unsaved draft or its config was
// deleted. Deploys are ordered by id: created_at has only second resolution.
const deploySelect = `
SELECT d.id, d.config_id, COALESCE(c.name, ''), %s, d.endpoint, d.ok, d.message, d.created_at
FROM deploys d LEFT JOIN configs c ON c.id = d.config_id`

func scanDeploy(sc interface{ Scan(...any) error }, withContent bool) (Deploy, error) {
	var (
		d       Deploy
		content string
		targets = []any{&d.ID, &d.ConfigID, &d.ConfigName}
	)
	if withContent {
		targets = append(targets, &content)
	} else {
		targets = append(targets, new(any))
	}
	targets = append(targets, &d.Endpoint, &d.OK, &d.Message, &d.CreatedAt)
	if err := sc.Scan(targets...); err != nil {
		return Deploy{}, err
	}
	d.Content = content
	return d, nil
}

// ListDeploys returns the most recent deploy attempts, newest first, without
// their content.
func (s *Store) ListDeploys(ctx context.Context, limit int) ([]Deploy, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		fmt.Sprintf(deploySelect, `''`)+` ORDER BY d.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Deploy{}
	for rows.Next() {
		d, err := scanDeploy(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDeploy returns one deploy including the Caddyfile that was submitted.
func (s *Store) GetDeploy(ctx context.Context, id int64) (Deploy, error) {
	row := s.db.QueryRowContext(ctx, fmt.Sprintf(deploySelect, `d.content`)+` WHERE d.id = ?`, id)
	d, err := scanDeploy(row, true)
	if errors.Is(err, sql.ErrNoRows) {
		return Deploy{}, ErrNotFound
	}
	return d, err
}

// LatestAppliedDeploy returns the most recent successful deploy — the config
// Caddy is actually running, as far as Camer knows.
func (s *Store) LatestAppliedDeploy(ctx context.Context) (Deploy, error) {
	return s.appliedBefore(ctx, 0)
}

// PreviousAppliedDeploy returns the newest successful deploy older than id,
// i.e. the configuration that deploy id replaced.
func (s *Store) PreviousAppliedDeploy(ctx context.Context, id int64) (Deploy, error) {
	return s.appliedBefore(ctx, id)
}

// appliedBefore returns the newest successful deploy with an id below before,
// or the newest overall when before is 0.
func (s *Store) appliedBefore(ctx context.Context, before int64) (Deploy, error) {
	q := fmt.Sprintf(deploySelect, `d.content`) + ` WHERE d.ok = 1`
	args := []any{}
	if before > 0 {
		q += ` AND d.id < ?`
		args = append(args, before)
	}
	q += ` ORDER BY d.id DESC LIMIT 1`

	d, err := scanDeploy(s.db.QueryRowContext(ctx, q, args...), true)
	if errors.Is(err, sql.ErrNoRows) {
		return Deploy{}, ErrNotFound
	}
	return d, err
}
