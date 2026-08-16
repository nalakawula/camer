# Build-time tooling

Nothing here is needed to build or run Camer. The generated artifacts under
`web/vendor/` are committed, so `go build` alone produces a working binary with
no Node, no npm and no network.

These scripts only need re-running when a vendored dependency changes.

## Regenerating the vendored assets

```sh
cd tools
npm install
npm run build          # -> web/vendor/codemirror.js  (CodeMirror 6)
python3 ../tools/vendor-fonts.py   # run from the repo root; -> web/vendor/fonts/
npm test               # headless check of the editor integration
```

## Why vendor at all

Camer exists to repair a reverse proxy. It gets opened on hosts with no egress,
and while the proxy under repair is down. Anything fetched at runtime is a
dependency that fails exactly when the tool is needed most — and a missing
editor script used to leave a page that rendered fine and did nothing.

## What is *not* vendored

Tailwind still loads from `cdn.tailwindcss.com`. Without it the page renders
unstyled but remains fully functional, which is a far softer failure than a dead
editor. See CAM-33 in `PLAN.md`.
