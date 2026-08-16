# Camer — Improvement Plan

Backlog derived from a UX and code review of the working tree at commit `2ef93fa`.
All line references below are as of that commit; re-grep before trusting one.

## How to use this file (agent protocol)

1. **Pick** the lowest-numbered `[ ]` task whose `Depends on` entries are all `[x]`.
   Do not start a task whose dependencies are unmet.
2. **Claim** it by changing `[ ]` to `[~]` and adding `Owner:` on the task's status line.
   Commit that change before starting work, so parallel agents don't collide.
3. **Do** the task. Stay inside its scope — findings outside scope become a new task
   appended to the Unsorted section, not a silent extra change.
4. **Verify** using the task's `Done when` list. Every task must also pass the
   universal gate below.
5. **Close** it: `[~]` → `[x]`, and note anything a future task needs to know under
   `Result:`. If you decided *not* to do it, use `[-]` and record why.

**Universal gate — every task:**

```sh
go vet ./... && go test ./...   # must be clean
go build -o /tmp/camer .        # must compile
```

For UI tasks, also load the page with the browser devtools console open and confirm
there are no errors, and that the editor, the JSON preview, and Submit still work.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

**Priorities:** P0 blocks a safe release · P1 core correctness of the UX ·
P2 quality and accessibility · P3 polish

---

## Index

| ID | P | Task | Status |
|----|----|------|--------|
| CAM-01 | P0 | Vendor CDN assets so the app works offline (except Tailwind → CAM-33) | [x] |
| CAM-02 | P0 | Bind to localhost by default | [x] |
| CAM-03 | P0 | Reject cross-origin writes (CSRF) | [x] |
| CAM-04 | P0 | Confirmation step before applying to live | [x] |
| CAM-05 | P1 | Unified save/live state indicator | [x] |
| CAM-06 | P1 | Distinguish "Caddy unreachable" from "invalid Caddyfile" | [x] |
| CAM-07 | P1 | Show the diff inside the pre-apply confirmation | [x] |
| CAM-08 | P1 | Re-apply (rollback) from deploy history | [x] |
| CAM-09 | P1 | Mark which deploy is currently live | [x] |
| CAM-10 | P1 | Fix trash button on an unsaved draft | [x] |
| CAM-11 | P1 | Warn when restoring over a newer draft | [x] |
| CAM-12 | P1 | Correct the wording on failed-deploy diffs | [x] |
| CAM-13 | P1 | Clarify what the endpoint field controls | [x] |
| CAM-14 | P2 | Give the JSON pane an explicit mode | [x] |
| CAM-15 | P2 | Compare adapted JSON against the live JSON | [x] |
| CAM-16 | P2 | Unify the Submit/Apply/Deploy vocabulary | [x] |
| CAM-17 | P2 | Paginate deploy history | [x] |
| CAM-18 | P2 | Make the sidebar config list identifiable | [x] |
| CAM-19 | P2 | Screen-reader labels for icon buttons | [x] |
| CAM-20 | P2 | Announce toasts to assistive tech | [x] |
| CAM-21 | P2 | Make the history modal a real dialog | [x] |
| CAM-22 | P2 | Honour prefers-reduced-motion | [x] |
| CAM-23 | P2 | Fix sub-AA contrast | [x] |
| CAM-24 | P2 | Responsive layout per DESIGN.md | [x] |
| CAM-25 | P3 | Drop the welcome comment from new configs | [x] |
| CAM-26 | P3 | Select the placeholder after inserting a pattern | [x] |
| CAM-27 | P3 | Resizable editor/preview split | [x] |
| CAM-28 | P3 | Search, fold and wrap in the JSON preview | [x] |
| CAM-29 | P3 | Discoverable keyboard shortcuts | [x] |
| CAM-30 | P3 | Don't let a slow apply drop its audit record | [x] |
| CAM-31 | P3 | Bracket matching and auto-close in the editor | [x] |
| CAM-32 | P3 | Track the test files in git | [ ] |
| CAM-33 | P2 | Vendor or replace the Tailwind CDN build | [ ] |

---

## P0 — Blocks a safe release

### CAM-01 — Vendor CDN assets so the app works offline
`[x]` · P0 · Depends on: none · Files: `web/index.html`, `web/vendor/*`, `tools/*`

**Problem.** `web/index.html` loaded 8 external resources (Tailwind CDN, Google Fonts ×2,
CodeMirror CSS + JS + simple-mode addon). `app.js` called into CodeMirror at top level, so if
cdnjs was unreachable the script threw before any event wiring ran: no editor, no working
buttons, no error message. Camer is a tool for repairing a reverse proxy — it gets opened on
hosts with no egress, and while the proxy under repair is down. This also contradicted
`README.md` ("single static binary, embedded web assets"), and `cdn.tailwindcss.com` is a
dev-only build.

**Scope note.** Tailwind was explicitly excluded from this task by the requester and is
tracked separately as **CAM-33**. Everything else is done.

**Done when**
- No `https://` asset references remain in `web/index.html` *except Tailwind*. ✔ (verified by
  enumerating every `src`/`href` the served page requests)
- No font is fetched at runtime. ✔ (body text comes from the system; only the Material
  Symbols subset is self-hosted in `web/vendor/fonts/` with `@font-face`)
- CodeMirror lives under `web/vendor/`. ✔
- `go build` then running the binary offline gives a working editor. ✔
- `app.js` fails loudly rather than silently if its editor dependency is missing. ✔

**Result.** `tools/vendor-fonts.py` downloads the Material Symbols subset into
`web/vendor/fonts/` and rewrites `fonts.css` to point at the local file. The face is
subsetted via the `icon_names=` parameter to the 36 icons the UI actually uses: **31 KB
instead of several megabytes**.

Body text is *not* vendored. It was at first — Geist, Inter and JetBrains Mono, 18 woff2
files and 384 KB — until the obvious question got asked: why ship fonts at all when the
machine already has some? `index.html` now names those three first and falls through to
`system-ui`/`ui-monospace`, so a machine that has them still gets them and nothing is
downloaded either way. Icons stay vendored because they are ligatures in an icon font and
no OS ships one; dropping it would render every button as the word `delete` or `close`.
`web/vendor/fonts/` went from 20 files and 440 KB to 2 files and 31 KB.

One wrinkle worth keeping: the subset endpoint serves woff2 from a `/l/font?kit=…` URL with
no file extension, so the fetcher matches on the declared `format('woff2')` rather than the
suffix.

CodeMirror was moved to **v6** (see CAM-31) and bundled to a single committed
`web/vendor/codemirror.js` (310 KB) with Rollup and `@rollup/plugin-node-resolve`, per
CodeMirror's own "Bundling with Rollup" guide, plus Terser for the size step that guide
recommends. The `tools/` project is build-time only — the artifacts are committed, so
`go build` alone still produces a working binary with no Node and no network.
`tools/README.md` explains regeneration.

**There is no prebuilt CodeMirror 6 to download instead.** v6 is published only as a graph
of ES modules with bare specifiers, which no browser resolves; cdnjs lists zero files for
`codemirror@6.0.2`. The `codemirror/6.65.7` build on cdnjs is *not* v6 — npm deprecates it as
"an accidentally mis-tagged instance of 5.65.7", published seven minutes before the real
5.65.7 on 2022-07-20, and its minified file is byte-identical to 5.65.7's apart from the
embedded version string. cdnjs surfaces it as the newest version only because 6.65.7 sorts
above 6.0.2. Do not re-investigate.

`app.js` now checks for the `CM` global up front and, if absent, renders a red banner
explaining that the editor failed to load instead of dying on the first call — the precise
failure mode this task existed to remove.

Verified end to end: every asset the served page references resolves locally (the icon font,
the bundle, app.js, patterns.js), with Tailwind the only external reference; and the binary
serves the vendored files from a different working directory, proving they are embedded
rather than read from disk.

---

### CAM-02 — Bind to localhost by default
`[x]` · P0 · Depends on: none · Files: `main.go`, `README.md`

**Problem.** Default `-addr` is `:8787` (`main.go:21`) — every interface — and there is no
authentication anywhere in the codebase (grep for `Authorization` returns nothing).
`POST /api/load` reconfigures a production web server, so on any shared network the
current default hands proxy control to whoever finds the port.

**Done when**
- Default is `127.0.0.1:8787`; `CAMER_ADDR` and `-addr` still override.
- Binding to a non-loopback address logs a clear warning at startup that Camer has no
  authentication and should sit behind an authenticating proxy.
- README documents the default and the warning.

**Result.** Default is now `127.0.0.1:8787`. `isLoopbackAddr` treats a missing host
(`:8787`), `0.0.0.0` and `::` as public; `warnIfPubliclyBound` prints a four-line warning
for those. Also fixed a latent bug the new default exposed: the startup log built its URL
as `"http://localhost" + addr`, which would have printed
`http://localhost127.0.0.1:8787` — replaced with `displayURL`. README gained a Security
section with the SSH-forwarding recipe. Covered by `TestIsLoopbackAddr` and
`TestDisplayURL`.

---

### CAM-03 — Reject cross-origin writes (CSRF)
`[x]` · P0 · Depends on: none · Files: `handlers.go`

**Problem.** `decodeBody` (`handlers.go:291`) never checks `Content-Type`. A cross-site
auto-submitting form with `enctype="text/plain"` can craft a body that `json.Decode`
accepts, reaching `POST /api/load` with the user's browser. No token, no origin check.

**Done when**
- All mutating handlers (POST/PUT/DELETE) reject requests whose `Sec-Fetch-Site` header is
  present and not `same-origin`.
- All JSON handlers require `Content-Type: application/json`, returning 415 otherwise.
- A test covers both rejections and confirms a normal same-origin request still succeeds.

**Result.** `Routes` now builds a separate `api` mux mounted as
`mux.Handle("/api/", guardAPI(api))`, so every current and future API route is guarded by
construction rather than by remembering to add a check. `guardAPI` rejects mutating
requests whose `Sec-Fetch-Site` is present and not `same-origin` (403), and POST/PUT/PATCH
without `application/json` (415). Absent `Sec-Fetch-Site` is allowed — that means a
non-browser client, which no third-party site can steer; the Content-Type check is what
actually closes the CSRF hole, since cross-origin forms cannot send `application/json`.
`isJSONContentType` uses `mime.ParseMediaType`, so `; charset=utf-8` is accepted.
Seven tests in `handlers_test.go`. Verified against a live Caddy: a `text/plain` body
aimed at `/api/load` is refused 415.

---

### CAM-04 — Confirmation step before applying to live
`[x]` · P0 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** The guard rails are inverted relative to the stakes. Deleting a saved draft
asks for confirmation (`app.js:220`); reconfiguring production does not — one click on
`btn-submit` and it's done. There is no moment anywhere in the flow that says "this is
about to change what's live."

**Done when**
- Submit opens a modal that must be explicitly confirmed before `POST /api/load` fires.
- The modal states the target endpoint (post-normalization, i.e. what the server will
  actually call), the config name, and whether the editor content is currently saved.
- Escape and a Cancel button both dismiss it without applying.
- The modal is keyboard-usable and focus lands on it when opened (see CAM-21 for the
  shared dialog helper — build one, reuse it there).

**Result.** `#confirm-modal` in `index.html`; `confirmApply()` in `app.js` returns a
Promise that resolves true only on explicit confirmation. Cancel, the backdrop and Escape
all resolve false. Focus starts on **Cancel**, so a stray Enter cannot apply.

Two things later tasks depend on:

- **`openDialog`/`closeDialog`/`topDialog` + `dialogStack`** is the shared helper CAM-21
  asked for — focus trap on Tab, focus restore on close, and Escape owned by the topmost
  dialog (so dismissing a confirmation no longer also closes the history modal behind it).
  CAM-21 should route `#history-modal` through it rather than writing its own.
- **`GET /api/endpoint?url=`** was added to satisfy "post-normalization endpoint". The
  alternative was porting `normalizeBase` to JS, which would have drifted from the Go
  version. CAM-13 should reuse this endpoint for its "effective base URL" display instead
  of adding another. The modal shows `base + "/load"` — the exact URL the server calls.

**Wording note for CAM-16.** The modal says "Apply", the footer button still says "Submit
to Admin API". That inconsistency is now *more* visible, not less; CAM-16 should settle on
"Apply" throughout. Toast copy in the apply path was already moved to "apply".

---

## P1 — Core correctness of the UX

### CAM-05 — Unified save/live state indicator
`[x]` · P1 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** Two independent facts exist — *is this persisted to SQLite* and *is this what
Caddy is running* — and the UI only ever expresses the first. Three indicators compete
without covering it:

- `UNSAVED` badge (`index.html:123`) — the SQLite axis only.
- A hardcoded `DRAFT` chip (`index.html:155`) — a static string that reads DRAFT when the
  file is saved, when it is byte-identical to what is live, and when a historical deploy is
  loaded. It carries no information.
- `Ready` + green dot (`index.html:200`) — reads as "connected and healthy" but is never
  validated against Caddy, and `submitToCaddy` resets it to green 4s after a *failure*
  (`app.js:354`) while the error toast stays up for 7s.

Net effect: a user saves a draft, watches `UNSAVED` vanish, and concludes the change is
live.

**Done when**
- One indicator replaces all three, showing exactly one of: `Unsaved changes`,
  `Saved · not applied`, `Live`, `Saved · differs from live`.
- Live comparison uses the content from `GET /api/deploys/latest`, held in `state` and
  refreshed after every successful apply.
- A failed apply leaves a failure state visible until the user's next action — it must not
  self-heal to a positive state on a timer.
- The static `DRAFT` chip is deleted.

**Result.** One `#state-badge` in the header. `DRAFT` chip deleted, `#dirty-badge` replaced,
and the footer's `Ready` dot plus `setStatus()` removed entirely. Six states in the `STATES`
table, resolved by `stateKey()` in priority order: `applying` → `failed` → `live` →
`unsaved` → `differs`/`notApplied`. The 4-second timer that reset a *failed* apply to green
is gone; `state.applyFailed` is sticky until the user edits or renames
(`clearApplyFailure`).

Two subtleties worth knowing before touching this:

- **`isSaved()` is deliberately stricter than `!isDirty()`.** A brand-new draft holding the
  starter template is not dirty, but it is not saved either. Without this the badge reported
  a never-persisted config as `Saved · not applied`.
- **`live` is checked before `unsaved`.** What Caddy is running is the more important truth,
  so content matching the live deploy reads `Live` even when it is not filed as a draft —
  which is the state the app boots into.

`state.live` comes from `GET /api/deploys/latest` via `refreshLive()`, re-read from the
server after each successful apply rather than assumed locally, so the badge cannot drift
from the audit record. CAM-09's `LIVE` badge should read `state.live.id` for its
single-source-of-truth requirement.

Verified by extracting `stateKey()` and driving it through nine cases (all six states plus
the two subtleties above and the rename-only edit); all pass.

---

### CAM-06 — Distinguish "Caddy unreachable" from "invalid Caddyfile"
`[x]` · P1 · Depends on: none · Files: `caddy.go`, `handlers.go`, `web/app.js`

**Problem.** `handleAdapt` returns 422 for both a connection failure and a Caddyfile syntax
error (`handlers.go:223`), and `runAdapt` renders both as red text with the status `invalid`
(`app.js:313`). Typo the endpoint and a perfectly valid Caddyfile is reported as invalid.

**Done when**
- `CaddyClient` distinguishes transport failures from Caddy-returned validation errors —
  a typed error, not string matching.
- Transport failures return 502 with a distinct payload; validation errors stay 422.
- The UI presents them differently: a validation error belongs in the preview pane; an
  unreachable endpoint belongs next to the endpoint field (see CAM-13), and must not make a
  valid Caddyfile look invalid.
- Applies to `/api/adapt`, `/api/load`, and `/api/current` alike.

**Result.** `TransportError` in `caddy.go` (with `Unwrap`, carrying the normalized `Base`)
is returned from all three `c.http.Do` failure paths. `writeCaddyError` in `handlers.go`
uses `errors.As` — no string matching — and emits `{error, kind, endpoint}`: `unreachable`
(502) for transport, `invalid` (422) for a Caddy rejection on adapt/load, `caddy_error`
(502) for a refused read on `/api/current`.

Client side: `api()` attaches `err.kind` and `err.endpoint`. `runAdapt` no longer labels an
unreachable endpoint `invalid` — it shows `cannot reach Caddy` in tertiary (not error red)
and states explicitly that the Caddyfile has *not* been checked. A new
`#endpoint-status` marker beside the Admin API Endpoint label is where connectivity is
reported, since that is where the problem actually is. Reaching Caddy and being rejected
clears that marker, since it proves the endpoint is fine.

Verified against a real Caddy on a non-default admin port: valid Caddyfile + dead endpoint
→ 502 `unreachable`; broken Caddyfile + live endpoint → 422 `invalid`; both correct →
200. `TestUnreachableEndpointIsNotAConfigError` asserts the 502 case and that the message
does not contain the word "invalid".

**For CAM-13.** The `#endpoint-status` element already exists — extend it with the active
reachability probe rather than adding another indicator. It currently only reflects the last
real call, so a wrong endpoint is silent until something is attempted.

---

### CAM-07 — Show the diff inside the pre-apply confirmation
`[x]` · P1 · Depends on: CAM-04 · Files: `handlers.go`, `web/app.js`

**Problem.** Nothing in the flow answers "what will actually change?" before the change
lands. The diff engine for this already exists and is tested (`diff.go`, `DiffText`).

**Done when**
- The CAM-04 modal shows a line diff of the editor content against the last successful
  deploy's content, rendered with the existing `.d-*` styles from `index.html:63-69`.
- Added/removed counts appear in the modal header.
- The no-previous-deploy case reads as a first-time apply, not an empty diff.
- An unchanged config says so plainly and still allows applying.
- Reuse `renderDiff` rather than writing a second diff renderer.

**Result.** New `POST /api/diff {content, base_deploy_id?}` reuses `DiffText`; with no
`base_deploy_id` it diffs against the last **successful** deploy, so the comparison is
always against what is actually live. Rendered into the confirmation by
`renderConfirmDiff`, with `+added / −removed` in the header.

`renderDiff` was parameterized to `renderDiff(diff, bodyEl, {identicalMessage})` rather than
duplicated — it had a hardcoded `#diff-body` target. Both callers (history, confirmation)
now pass their own element and their own no-change wording.

The diff is decision support, so `fetchDiff` returns null on failure and the confirmation
still opens — a broken diff must never block applying. First-apply reads as
"Camer has not applied anything yet", not as an empty diff.

Verified live: pending change against a running Caddy produced exactly `+2/-1` with the
right hunk. `TestDiffAgainstLiveDeploy` also asserts a **failed** deploy is never chosen as
the base.

---

### CAM-08 — Re-apply (rollback) from deploy history
`[x]` · P1 · Depends on: CAM-04 · Files: `web/app.js`

**Problem.** Full content is stored for every deploy, so one-click rollback is nearly free,
but the UI stops one step short: "Load into editor" (`app.js:464`) drops the content in the
editor and leaves the user to find Submit. Users bring a "revert" mental model to a deploy
history.

**Done when**
- Deploy detail gains a **Re-apply** action alongside "Load into editor".
- It routes through the CAM-04 confirmation, diffed against what is currently live.
- It is not offered for the deploy that is already live (see CAM-09).
- Success refreshes the history list and the CAM-05 state indicator.

**Result.** `reapplyDeploy` in the deploy detail, routed through the same CAM-04
confirmation, diffed against live. Hidden for the deploy that is already live.
`applyToCaddy` gained a `configId` parameter so a re-apply is recorded against the config it
originally came from rather than whatever the editor holds. On success it reloads the
history so the new deploy and the moved `LIVE` badge both appear.

Note re-applying creates a *new* deploy row rather than mutating history — the audit trail
stays append-only, and `LIVE` moves to the new row.

Verified live: rolled a real Caddy from config "C" back to "A" through this path; the
confirmation showed the single-line diff, and the served response changed accordingly.

---

### CAM-09 — Mark which deploy is currently live
`[x]` · P1 · Depends on: none · Files: `web/app.js`

**Problem.** The history list omits the single most important fact: which entry is running
right now. Someone reading a `FAILED` row has no way to tell what state the server is in.

**Done when**
- The latest successful deploy carries a `LIVE` badge in both the list and the detail pane.
- The badge is derived from the same source as CAM-05, so the two can never disagree.

**Result.** `LIVE_BADGE` plus `isLiveDeploy(id)`, reading `state.live.id` — the same source
as the CAM-05 header indicator, so the two cannot disagree. Shown in both the history list
and the detail header. Also removed the stacked `opacity-60`/`opacity-70` from list rows in
passing (they were the CAM-23 contrast problem) and added a `title` for truncated names.

Verified live: a failed apply left `LIVE` on the previous successful deploy, which is the
case where the badge matters most.

---

### CAM-10 — Fix trash button on an unsaved draft
`[x]` · P1 · Depends on: none · Files: `web/app.js`, `web/index.html`

**Problem.** With no config loaded, `deleteConfig` falls through to `newConfig()`
(`app.js:219`) — a button labelled "Delete this config" discards your work and inserts the
sample template. The confirm it shows ("Discard unsaved changes?") describes a different
action than the one clicked.

**Done when**
- The delete button is disabled, with an explanatory `title`, when `state.currentId == null`.
- The delete confirmation names the config being deleted.
- Deleting no longer silently repopulates the editor with the starter template — leave it
  empty, or state what happened.

**Result.** The button is now disabled (with an explanatory `title` and dimmed styling) when
`state.currentId == null`, so the fall-through to `newConfig()` is gone — a control labelled
Delete can no longer reset the editor to the sample template. Enablement is recomputed in
`refreshState`, which already runs on every relevant transition.

The confirmation names the config and adds a clarification worth having: deleting a draft
never changes what Caddy is running. After deleting, the editor is left genuinely empty
rather than repopulated with the starter template.

---

### CAM-11 — Warn when restoring over a newer draft
`[x]` · P1 · Depends on: none · Files: `web/app.js`

**Problem.** `restoreDeploy` (`app.js:501-511`) reattaches the loaded history entry to its
source config, so a subsequent Ctrl+S overwrites that draft's current content with the
historical version — with no indication that something newer is being replaced.

**Done when**
- When the source config's saved content differs from the restored deploy content, the UI
  says so at restore time and again in the CAM-05 indicator.
- Saving in that state requires explicit confirmation, or offers "save as a new config"
  as an alternative.

**Result.** `restoreDeploy` now records `state.restoredFrom = {deployId, configName,
wouldOverwrite}`, where `wouldOverwrite` means the source config's saved content differs from
the deploy being restored. That is surfaced three ways: a toast at restore time, the state
badge's tooltip, and a blocking choice at save time — Cancel / **Save as new config** /
Overwrite draft, via `askDialog`.

`askDialog` is a new shared dialog (built on the CAM-04 helper) for questions a native
`confirm()` cannot express. CAM-10's delete confirmation uses it too.

Also hardened `saveConfig`: it decides a local `targetId` and commits `state.currentId` only
after the request succeeds. Previously "save as new" mutated `currentId` before the POST, so
a failed save silently detached the editor from its config.

---

### CAM-12 — Correct the wording on failed-deploy diffs
`[x]` · P1 · Depends on: none · Files: `web/app.js`

**Problem.** For a failed submit the diff base is still the previous *successful* deploy,
but `renderDiff` unconditionally prints "No changes — this submit re-applied the same
Caddyfile" (`app.js:484`), which is false when nothing was applied. The surrounding copy
("Diff against deploy #N", "identical to the previous applied config", `app.js:449-455`)
has the same problem.

**Done when**
- Copy for a failed deploy uses conditional phrasing — what *would* have changed, and an
  explicit note that it was not applied.
- The identical case distinguishes "re-applied the same Caddyfile" from "would have made
  no changes".

**Result.** All four strings are now conditional on `d.ok`. A failed deploy reads
"Compared with deploy #N, which stayed live — this submit was rejected and changed nothing"
instead of "Diff against deploy #N"; the identical case reads "would have made no changes";
and `renderDiff` gets a matching `identicalMessage`. A failed deploy also gains an explicit
banner: "Not applied — Caddy rejected this and kept the configuration it was already
running."

Verified live: a rejected apply recorded deploy #7 with base #6, Caddy unchanged, and the
live pointer still on #6 — the exact state the old copy described incorrectly.

---

### CAM-13 — Clarify what the endpoint field controls
`[x]` · P1 · Depends on: CAM-06 · Files: `web/index.html`, `web/app.js`, `handlers.go`

**Problem.** The endpoint input sits in the footer beside Submit, implying it only affects
submission. In fact the live JSON preview depends on it too — every debounced keystroke
POSTs to that production admin API. Separately, `normalizeBase` (`caddy.go:43-60`) silently
accepts and rewrites a pasted `/load`, `/adapt` or `/config` URL, which is documented only
in the README.

**Done when**
- The field's helper text states that it drives both the live preview and apply.
- A reachability probe runs on load and on change, showing reachable / unreachable /
  checking beside the field. Add a lightweight endpoint for this or reuse `/api/current`.
- When the pasted value is normalized, the effective base URL is shown.
- Endpoint changes persist on `input` (debounced), not only on `change` (`app.js:133`).

**Result.** Helper text under the field states it drives the live preview *and* apply, and
the effective base URL is shown whenever `normalizeBase` rewrote the input (pasting a
`/load` URL now visibly resolves). Reachability runs through the extended
`GET /api/endpoint?url=...&probe=1`, reusing the CAM-04 endpoint as planned rather than
adding another, and shows reachable / unreachable / checking. Persistence and re-probing moved
to a 500ms-debounced `input` handler.

Also fixed a real gap: changing the endpoint now re-runs adapt. Previously `runAdapt` read
the field only when invoked, so correcting a typo'd endpoint left the preview showing a stale
error until the user typed in the editor.

**A wrong probe target caught by testing, worth not regressing.** The obvious cheap path,
`/config/admin/listen`, returns **400 "invalid traversal path"** on a Caddy whose config has
no explicit `admin` block — which would report a perfectly healthy server as unreachable,
the precise failure CAM-06 exists to prevent. `Probe` uses `/config/` (200 on any running
Caddy) and reads only the status line, closing the body unread so a large config is not
downloaded. Verified against both a Caddy with an explicit admin block and one without.

---

## P2 — Quality and accessibility

### CAM-14 — Give the JSON pane an explicit mode
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** The pane shows three different things — the adapted preview of the editor, an
error, or the running config from Pull Current — differentiated only by a 12px status word
(`valid` / `invalid` / `running config`). After Pull Current, the next keystroke silently
discards the pulled config, because `editor.on("change")` re-runs adapt over the same
element. Pull Current currently has no durable result.

Also: the `sync_alt` icon between the panes (`index.html:164`) is a two-way arrow for a
strictly one-way transform.

**Done when**
- The pane has a visible mode control — Adapted preview / Running config — and switching
  modes is a user action, never a side effect of typing.
- Pulled running config survives editing and can be returned to.
- The connector icon reflects one-way flow, or is removed.

**Result.** `preview` holds three independent slots — `adapted`, `running`, `compare` — each
with its own tab (`setPreviewMode`), and `renderPreview` paints whichever is selected. The
mode now changes only on a click; `runAdapt` refreshes the adapted slot on every keystroke
but repaints only when that tab is the one on screen, so a pulled running config survives
editing instead of being wiped by the next adapt. Slots load lazily: switching to a tab that
has no data fetches it once.

The connector icon changed from `sync_alt` (a two-way arrow for a one-way transform) to
`arrow_forward`, with a tooltip saying the transform only runs in that direction.

`state.lastJSON` is gone; Copy now copies whichever document is displayed, via
`currentJSON()`, and says something useful when Compare is active (a diff is not a document).

---

### CAM-15 — Compare adapted JSON against the live JSON
`[x]` · P2 · Depends on: CAM-14 · Files: `web/app.js`, `handlers.go`

**Problem.** The most valuable question this tool can answer — "how does what I'm about to
apply differ from what is actually running?" — is unanswerable today, even though both
sides of the comparison are already fetched.

**Done when**
- A compare mode diffs the adapted JSON against `/api/current` output.
- Both sides are canonicalized (stable key order) before diffing, so formatting noise
  doesn't swamp real changes.
- It degrades clearly when Caddy is unreachable.

**Result.** New `POST /api/compare {caddyfile, endpoint}` adapts and fetches the running
config server-side, canonicalises both, and returns a `DiffText`. One round trip, and no
duplicated adapt logic in the browser.

**Canonicalisation is the crux.** `canonicalJSON` round-trips through `any` and re-marshals,
which sorts object keys, because Caddy's `/adapt` output and its `/config/` output order keys
differently — without it every comparison would be buried in reordering noise. Display still
uses `prettyJSON`, which keeps Caddy's own more readable ordering.

Verified live against a running Caddy: comparing the applied config with itself reports
`identical` (proving the key-sort removes phantom differences), and changing one `respond`
value produced exactly `+1/-1` on the `"body"` line. An unreachable endpoint degrades to a
502 `unreachable` rendered in the Compare pane rather than a silent blank.

---

### CAM-16 — Unify the Submit/Apply/Deploy vocabulary
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`, `README.md`

**Problem.** Three vocabularies for one action: the button says *Submit to Admin API*
(`index.html:209`), the toast says *applied* (`app.js:348`), the sidebar says *Deploy
History*. Likewise *Save Draft* vs. sidebar *Saved Configs* vs. the permanent `DRAFT` chip —
is a saved config a draft or not?

**Done when**
- One verb throughout the UI, toasts, and README. "Apply" fits the existing
  "applied"/"Deploy History" copy best.
- The draft/config distinction is settled and used consistently.

**Result.** The verb is **apply**, everywhere. "Submit to Admin API" → "Apply to Caddy";
`submitToCaddy` → `applyConfig`; "Pull Current" → "Pull Running" (it names the tab it fills);
history subtitle "every submit to the admin API" → "every apply". Grep for user-visible
"submit" now returns nothing outside the `btn-submit` element id.

The draft/config split is settled: **draft** is the UI word for a saved Caddyfile — "Save
Draft", "Saved Drafts", "No saved drafts yet", "Delete this saved draft" — while `configs`
stays the API and table name. "Deploy" survives only as a noun: you *apply* a configuration,
which records a *deploy*. That keeps the audit vocabulary intact without a third verb.

---

### CAM-17 — Paginate deploy history
`[x]` · P2 · Depends on: none · Files: `web/app.js`, `handlers.go`, `store.go`

**Problem.** The UI requests `?limit=100` (`app.js:395`) and silently shows whatever comes
back. Older deploys are unreachable and the truncation is invisible.

**Done when**
- The list shows a total count, or an explicit "showing N of M".
- Older entries are reachable via a load-more control or an offset parameter.

**Result.** `ListDeploys` takes an offset and `CountDeploys` was added; `GET /api/deploys`
now returns `{deploys, total, offset}` instead of a bare array (README updated). The UI
requests 50 at a time, shows "showing 3 of 8" or "8 deploys" when complete, and reveals a
**Load older** button while more remain. Verified live across three pages of 8 records.

---

### CAM-18 — Make the sidebar config list identifiable
`[x]` · P2 · Depends on: CAM-09 · Files: `web/app.js`

**Problem.** Rows show only a name (`app.js:158`). Save two unnamed configs and you get two
identical "Untitled Caddyfile" entries — no timestamp, no live marker, no tooltip on
truncated names, no search.

**Done when**
- Each row shows its `updated_at` as relative time (`relTime` already exists).
- The config backing the live deploy is marked.
- Full names appear via `title` when truncated.
- A filter input appears once the list exceeds a threshold (~8 entries).

**Result.** Rows now carry the draft name, a relative `updated_at`, a `LIVE` badge when that
draft backs the running deploy, and a `title` with the full name plus absolute timestamp — so
two "Untitled Caddyfile" rows are finally distinguishable. A filter input appears once the
list reaches `FILTER_THRESHOLD` (8), with its own empty state.

`state.live` gained `configId` (from the deploy's `config_id`) to drive the badge from the
same source as CAM-05 and CAM-09.

---

### CAM-19 — Screen-reader labels for icon buttons
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** Material Symbols render via ligature, so the glyph's text content is read
aloud: the trash button announces as "delete delete". Grep confirms there is not one
`aria-` attribute in `web/`. Affects `btn-refresh-list`, `btn-copy`, `btn-delete`,
`btn-history-close`, `sync-icon`, and every icon inside a labelled button.

**Done when**
- Every `.material-symbols-outlined` span carries `aria-hidden="true"`.
- Every icon-only control carries a real `aria-label`.
- Icons injected from JS (`renderConfigList`, `renderHistoryList`, `renderDeployDetail`,
  `renderPatterns`, `toast`) get the same treatment.

**Result.** Every `.material-symbols-outlined` span in `index.html` and every one injected
from `app.js` now carries `aria-hidden="true"` — the ligature text was being read aloud, so
the trash button announced as "delete delete". Icon-only controls gained real `aria-label`s
(refresh, copy, delete, close history, drawer, toast dismiss). Also added: `aria-label` on the
draft-name and filter inputs, `aria-haspopup`/`aria-expanded`/`aria-controls` on the patterns
menu, `role="tablist"`/`role="tab"`/`aria-selected` on both tab groups, and a label on the
sidebar `nav`. Verified by grep: no icon span lacks `aria-hidden`.

---

### CAM-20 — Announce toasts to assistive tech
`[x]` · P2 · Depends on: none · Files: `web/index.html`

**Problem.** `#toasts` is a plain div, so every success, error and drift notice is silent to
screen readers — including apply failures.

**Done when**
- The container is a polite live region; errors are assertive.
- The 3.5s/7s auto-dismiss (`app.js:52`) doesn't cut off announcements — errors should be
  dismissible rather than only timed.

**Result.** `#toasts` is now `aria-live="polite"`, and error toasts additionally carry
`role="alert"` so failures interrupt. Every toast gained a labelled dismiss button, and
**errors no longer auto-dismiss** — the previous 7s timeout could retire an apply failure
before it was read, or before a screen reader reached it. Non-errors still clear after 3.5s.

---

### CAM-21 — Make the history modal a real dialog
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** `#history-modal` has no `role`, no focus trap, and doesn't restore focus on
close. Tab moves behind the overlay into the editor.

**Done when**
- Proper dialog semantics, labelled by its heading.
- Focus moves in on open, is trapped while open, and returns to the trigger on close.
- Implemented as a shared helper reused by the CAM-04 confirmation dialog.

**Result.** `#history-modal` gained `role="dialog"`, `aria-modal`, and `aria-labelledby`, and
`openHistory`/`closeHistory` now route through the `openDialog`/`closeDialog` helper built in
CAM-04 — so it inherits the focus trap, focus restore, and Escape handling rather than
reimplementing them. The Escape fallback that called `closeHistory()` directly was removed,
since the dialog stack owns Escape now; that fallback closes the mobile drawer instead.

---

### CAM-22 — Honour prefers-reduced-motion
`[x]` · P2 · Depends on: none · Files: `web/index.html`

**Problem.** `animate-spin` on the sync icon, `animate-pulse` on the status dot, the toast
keyframe (`index.html:60`) and the `active:scale-95` on nearly every button all run
unconditionally. No `prefers-reduced-motion` query exists in the codebase.

**Done when**
- A reduced-motion media query disables the spin, pulse, scale and slide animations while
  preserving the state changes they signal.

**Result.** A `prefers-reduced-motion: reduce` block disables the sync spinner, the status
dot pulse, the toast slide-in keyframe, the drawer slide, and `active:scale-95` on every
button. Colour transitions are deliberately left alone — the goal is to remove motion, not
the state changes the motion was signalling.

---

### CAM-23 — Fix sub-AA contrast
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** Diff line numbers sit at `#8c909f` with `opacity:.7` on `#060e20`
(`index.html:64`) — roughly 3.6:1, under the 4.5:1 AA threshold for text. The history list
stacks `opacity-60`/`opacity-70` on already-muted `on-surface-variant` (`app.js:421-423`),
compounding the same problem.

**Done when**
- All text meets 4.5:1 against its actual rendered background.
- Prefer choosing a lighter token over layering opacity, so contrast stays predictable.

**Result.** Two real failures fixed, both caused by layering opacity on already-muted text
rather than choosing a colour: `.d-num` diff line numbers (`opacity:.7` → **3.52:1**) and the
warning location text (`opacity-60` → **4.35:1**). Removing the opacity puts them at 6.05:1
and 9.64:1. The history-list `opacity-60/70` was already dropped in CAM-09.

Audited numerically rather than by eye: a WCAG relative-luminance script over 22 foreground
/background pairs — diff rows, badges, gutters, muted labels, and the active sidebar row
against its saturated `secondary-container` — reports **0 failures**, with the two
counterfactuals confirming the exact ratios the old opacity produced. Lowest passing value is
the active-row timestamp at 4.57:1.

---

### CAM-24 — Responsive layout per DESIGN.md
`[x]` · P2 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** `DESIGN.md:129` specifies a tablet drawer and a full mobile stack. Neither
exists — grep finds no media queries. The layout hard-codes `ml-[260px]` (`index.html:111`)
and `left-sidebar-width` on the fixed header and footer, with two `flex-1` panes side by
side. On a 375px viewport the sidebar alone eats 260px.

**Done when**
- Below the tablet breakpoint the sidebar becomes a toggleable drawer and the main area
  reclaims the full width.
- Below the mobile breakpoint editor and preview stack, switchable by tabs.
- The fixed footer reflows without overlapping content; code drops to 13px per DESIGN.md.
- Verified at 375px, 768px and 1280px.

**Result.** Below 1024px the app stops being a fixed app-shell and becomes an ordinary
scrolling document: the sidebar is a drawer with a backdrop and a hamburger, the header goes
`sticky`, the workspace stacks, the footer becomes static and wraps, and the panes take turns
via a Caddyfile/JSON tab bar. Code drops to 13px per `DESIGN.md:129`. A second query at 640px
gives the endpoint field full width.

**All of it lives in one `@media (max-width:1023px)` block**, so the desktop layout is
unchanged by construction — a deliberate choice given no browser was available to verify
rendering. JS contributes only two state bits, `body[data-drawer]` and `body[data-pane]`.

`setPane` calls `editor.refresh()`: CodeMirror measures nothing while `display:none` and comes
back blank without it.

**Verification gap.** Rendering at 375/768/1280px was NOT visually confirmed — no browser
tooling in this session. What was checked mechanically: CSS braces balance, every `#id` the
media queries target exists in the markup, and the `data-drawer`/`data-pane` values the CSS
selects on are exactly the values JS assigns. Someone should still eyeball the three widths.

---

## P3 — Polish

### CAM-25 — Drop the welcome comment from new configs
`[x]` · P3 · Depends on: none · Files: `web/app.js`

**Problem.** `STARTER` (`app.js:112`) opens with `# Welcome to Camer. Edit this Caddyfile
and watch the JSON preview update.` — onboarding copy that gets saved and applied to
production configs.

**Done when** the onboarding hint lives in the UI (empty state or placeholder), and the
starter content is a plain minimal Caddyfile.

**Result.** `STARTER` is now a plain three-line Caddyfile. The onboarding moved into the JSON
pane's empty state, which explains the flow *and* the safety property that matters most —
nothing reaches the server until Apply — where a comment inside the user's config could only
ever be noise that got deployed.

---

### CAM-26 — Select the placeholder after inserting a pattern
`[x]` · P3 · Depends on: none · Files: `web/app.js`, `web/patterns.js`

**Problem.** Every snippet inserts `example.com`, and some carry `<provider_name>`
(`patterns.js:50`). `insertPattern` leaves the cursor past the end of the snippet
(`app.js:265`), so the user hunts for the tokens to replace.

**Done when** insertion selects the first placeholder, with a way to cycle to the next.

**Result.** Placeholders are found with a deliberately narrow `PLACEHOLDER_RE` (angle-bracket
tokens, `example.com` variants, document roots, `host:port` upstreams) and wrapped in
CodeMirror `markText` marks, so replacing one does not invalidate the positions of the
others — plain offsets would break after the first edit. Insertion selects the first
placeholder; `Tab` cycles, falling through to normal indentation once none are pending.
Pending placeholders are visibly dashed (`.cm-hole`), and a toast names the count so the Tab
affordance is discoverable.


**Revisited after the move to CodeMirror 6.** The regex + `markText` approach is replaced by
CodeMirror's snippet support, which is what this feature wanted all along. `patterns.js` now
marks placeholders explicitly as `#{example.com}` instead of relying on a heuristic that
guessed which text looked like a stand-in — no more false positives or misses. Tab/Escape
come from the library's own snippet keymap.

The upgrade this buys: **fields sharing a name are linked**. The www-redirect pattern repeats
the domain three times; typing it once now fills all three.

That linking exposed a real bug in the integration. Linked fields are represented as one
selection with several ranges, and CodeMirror collapses multi-range selections unless
`EditorState.allowMultipleSelections.of(true)` is enabled — so only the first occurrence was
filling in. Caught by the headless test, which asserts 3 ranges and that typing once yields 3
replacements.

---

### CAM-27 — Resizable editor/preview split
`[x]` · P3 · Depends on: none · Files: `web/index.html`, `web/app.js`

**Problem.** The panes are locked at 50/50. Real work needs more editor or more JSON at
different moments.

**Done when** the divider drags, respects a minimum width, and the ratio persists in
`localStorage` alongside `camer.endpoint`.

**Result.** The connector is now a `role="separator"` drag handle: drag to resize, double-click
to reset, arrow keys when focused (Shift for coarse steps), clamped to 20–80%, persisted as
`camer.split`.

**A bug worth recording.** The first version set `flex-basis` on the editor pane
unconditionally. On the stacked layout `#workspace` is `flex-direction: column`, where
flex-basis sizes *height* — so a leftover width fraction would have squashed the panes
vertically on mobile. `applySplit` now clears the inline style outside the wide layout, and a
`matchMedia` change listener re-evaluates in both directions when the breakpoint is crossed.

---

### CAM-28 — Search, fold and wrap in the JSON preview
`[x]` · P3 · Depends on: none · Files: `web/app.js`, `web/index.html`

**Problem.** Real Caddy JSON runs to thousands of lines. There is no search, no folding, no
wrap toggle, and `highlightJSON` (`app.js:78`) rebuilds the whole highlighted string into
`innerHTML` on every adapt.

**Done when** the pane supports find and collapsible objects, and large configs are
rendered without a visible stall on each keystroke-debounced adapt.

**Result.** The pane renders one row per line (`renderJSONDoc`) instead of a single
`innerHTML` blob, which is what makes find and folding possible.

- **Folding** pairs each block opener with its closer by brace depth (`computeFolds`, with
  strings stripped first so `"body": "}"` cannot create a phantom block). Fold state is a Set
  of opener line numbers and `applyFolds` recomputes visibility in one pass, so nested folds
  compose with no bookkeeping. Collapse-all / expand-all included.
- **Find** marks matches by walking text nodes rather than editing HTML strings — string
  surgery would corrupt the token markup. Crucially, hits are computed from the *source
  lines*, so **text inside collapsed blocks is still searchable**, and `gotoHit` unfolds
  exactly the ancestors hiding the match while leaving unrelated blocks closed. Enter /
  Shift+Enter cycle, with a `n/total` counter.
- **Wrap** toggle, persisted as `camer.wrap`.
- **No stall:** `renderJSONDoc` returns immediately when the text is unchanged, which is the
  common case while typing — most keystrokes do not alter the adapted output. Rows are built
  into a `DocumentFragment` and fold clicks use one delegated listener rather than one per
  line.

Verified against real 125-line Caddy adapted JSON with 50 foldable blocks: 11 fold assertions
(opener/closer indentation agreement, proper nesting, collapse-all, string braces) and 9 find
assertions (including retrieving a match buried under 17 collapsed ancestors, and wrap-around
cycling) all pass.

---

### CAM-29 — Discoverable keyboard shortcuts
`[x]` · P3 · Depends on: CAM-16 · Files: `web/index.html`, `web/app.js`

**Problem.** Ctrl/Cmd+S is wired (`app.js:568`) but documented only in the README, and the
primary action has no shortcut.

**Done when** shortcut hints appear in the relevant button `title`s, Cmd/Ctrl+Enter opens
the apply confirmation, and `?` shows a shortcut list.

**Result.** A `#shortcuts-modal` listing eight bindings, opened with `?` or from a new sidebar
entry — a shortcut list reachable only by shortcut would help nobody. `typingInto()` guards the
bare `?` so it never swallows a character meant for an input or the editor. Button tooltips
carry their bindings (`Save draft (Ctrl/Cmd+S)`, `Apply to Caddy (Ctrl/Cmd+Enter)`).

---

### CAM-30 — Don't let a slow apply drop its audit record
`[x]` · P3 · Depends on: none · Files: `handlers.go`

**Problem.** `handleLoad` writes the audit row with the request's 25s context
(`handlers.go:252`) and discards the error. A Caddy call that consumes the budget, or a
client that disconnects, silently loses the record — in the feature whose whole purpose is
being an audit trail.

**Done when** the write uses `context.WithoutCancel` with its own timeout, and a failure is
logged rather than discarded.

**Result.** The audit write now uses `context.WithoutCancel(r.Context())` with its own 5s
timeout, and a failure is logged instead of discarded.

**This was a real data-loss bug, not a theoretical one.**
`TestAuditRecordSurvivesCancelledRequest` serves a request whose context is already cancelled;
run against a faithful copy of the old code it fails with **"got 0 rows"** — the record was
genuinely dropped — and passes against the fix.

---

### CAM-31 — Bracket matching and auto-close in the editor
`[x]` · P3 · Depends on: ~~CAM-01~~ (removed — see Result) · Files: `web/index.html`, `web/app.js`

**Problem.** Caddyfiles are brace-structured, but no CodeMirror bracket addons are loaded.

**Done when** matching braces highlight, typing `{` auto-closes, and Enter inside a block
indents — with the addons vendored per CAM-01, not fetched from a CDN.

**Result — dependency removed.** This was listed as depending on CAM-01 only because I assumed
it would need CodeMirror's `matchbrackets` and `closebrackets` addons vendored. Implementing
against the core API instead removes the coupling entirely, adds no files for CAM-01 to vendor,
and honours the constraint's actual intent (no CDN fetch) rather than its letter. CAM-01 is
still open; this no longer waits on it.

Delivered: brace matching (`scanBraces` + `.cm-matchbrace` on the pair around the caret),
auto-closing `{` that declines when it would orphan following text, type-over and paired
Backspace for `}`, Enter that opens a block across three lines at the right indent, and a
lone `}` that snaps to its opener's indentation. Tabs throughout, matching the Caddy docs and
every bundled snippet.

`scanBraces` ignores braces inside comments and quoted strings — `respond "}"` would otherwise
throw the matching off. Backward scanning deliberately re-scans from the start of the document,
because whether a brace sits inside a string is only knowable from the left. Nine unit
assertions cover nesting, strings, comments, both directions, and unmatched openers.


**Revisited after the move to CodeMirror 6.** The hand-rolled implementation is gone —
`scanBraces`, `highlightMatchingBraces`, `indentOfEnclosingOpener`, the `extraKeys` block and
the `cursorActivity` listener, about 130 lines, deleted. CodeMirror 6 provides all of it:

- `bracketMatching()` replaces the scanner. It skips braces of a different token type, so
  `respond "}"` is still handled correctly — but now that falls out of the language definition
  rather than a bespoke string/comment scanner.
- `closeBrackets()` replaces auto-close, type-over and paired backspace.
- Indentation comes from the language's `indent()` (brace depth × `cx.unit`) plus
  `indentOnInput`, replacing the hand-written Enter and `}` handlers.

The earlier note that this no longer depends on CAM-01 is now moot in the other direction:
CAM-01 is done, and the extensions ship in the vendored bundle.

Verified headlessly in jsdom against the real bundle: bracket matching finds the correct
partner and demonstrably skips the brace inside a string (asserting the two have different
token types); indentation is one unit inside a block, two when nested, and dedents on a
closing brace.

---

### CAM-32 — Track the test files in git
`[ ]` · P3 · Depends on: none · Files: `diff_test.go`, `handlers_test.go`

**Problem.** `diff_test.go` is untracked at `2ef93fa` — the only test file in the repo was
absent from the history. `handlers_test.go` (added by CAM-03) is untracked for the same
reason: nothing has been committed since.

**Done when** both are committed.

---

### CAM-33 — Vendor or replace the Tailwind CDN build
`[ ]` · P2 · Depends on: none · Files: `web/index.html`, `tools/*`

**Problem.** Split out of CAM-01, which the requester scoped to exclude Tailwind. The page
still loads `cdn.tailwindcss.com?plugins=forms` — a build explicitly documented as
development-only, which compiles classes in the browser at runtime and flashes unstyled
content on load. It is now the only external reference left in the page.

This is a much softer failure than the one CAM-01 fixed: with Tailwind unreachable the page
renders unstyled but every control still works, because the editor and fonts are local. It is
a polish and correctness issue rather than an availability one, hence P2 not P0.

**Done when**
- No `https://` asset references remain in `web/index.html`.
- Tailwind is a build-time-generated stylesheet under `web/vendor/`, produced by a script in
  `tools/` alongside the CodeMirror bundle, and committed so `go build` still needs no Node.
- If a Node build step for CSS is unwanted, hand-write the (fairly small) set of utilities the
  markup actually uses instead — record the choice under `Result:`.
- The dark theme tokens in the inline `tailwind.config` move into the generated stylesheet or
  a CSS custom-property block.

---

## Verified non-issues

Checked during review; do not re-investigate without new evidence.

- **Deploy timestamps are correct.** SQLite `CURRENT_TIMESTAMP` is stored UTC, the modernc
  driver returns it as UTC, and it marshals as RFC3339 `Z`. The browser converts to local
  time correctly. Verified with a scratch round-trip test at 2026-08-16.
- **`http.MaxBytesReader(nil, ...)` in `decodeBody` is safe.** The nil `ResponseWriter` fails
  the internal `requestTooLarger` type assertion rather than being dereferenced.
- **Out-of-order adapt responses are already handled** by the `adaptSeq` guard
  (`app.js:300`, `311`, `317`).
- **XSS through rendered content is handled** — every `innerHTML` path escapes via
  `escapeHTML`.
- **Active sidebar row contrast is fine** — `#b0b2ff` on `#3131c0` is ~5.1:1, passing AA.

---

## Unsorted

New findings that don't yet have a home. Promote them into a numbered task before starting
work on one.

- **Applying a Caddyfile with no `admin` block silently cuts Camer off from the server.**
  Found while testing CAM-08 against a real Caddy: applying a config that omits a global
  `admin` directive makes Caddy drop its current admin listener and revert to the default
  `localhost:2019`. The apply succeeds, then every subsequent Camer call to the old endpoint
  fails as `unreachable`, and the user has no idea why. CAM-06 reports this correctly, but
  the UI could detect it — the adapted JSON shows `admin.listen`, so the pre-apply
  confirmation could warn "this changes the admin API address to X" before it happens. This
  is arguably the sharpest remaining footgun in the app.

- **Native `confirm()` is still used for the three discard-unsaved prompts**
  (`selectConfig`, `newConfig`, `restoreDeploy`), which now looks out of place beside the
  `askDialog`-based confirmations. Cosmetic, but it means those prompts are not
  focus-trapped or themed like the rest.
