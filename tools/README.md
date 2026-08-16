# Build-time tooling

Nothing here is needed to build or run Camer. The generated artifacts under
`web/vendor/` are committed, so `go build` alone produces a working binary with
no Node, no npm and no network.

These scripts only need re-running when a vendored dependency changes.

## Regenerating the vendored assets

```sh
cd tools
npm install
npm run build          # rollup -c -> web/vendor/codemirror.js + web/vendor/tailwind.css
npm run fonts          # -> web/vendor/fonts/ (icons only; needs network)
npm test               # headless check of the editor integration
```

Node is the only toolchain here — there is no Python step.

## How the CodeMirror bundle is built

`rollup.config.mjs` follows CodeMirror's own [Bundling with
Rollup](https://codemirror.net/examples/bundle/) guide: `cm6-entry.js` imports
the pieces Camer uses, `@rollup/plugin-node-resolve` resolves the bare
`@codemirror/*` specifiers into `node_modules`, and the output is an IIFE
exposing one `CM` global — so `index.html` loads it with a plain `<script>` tag
and needs no module plumbing or import map.

`@rollup/plugin-terser` is the size step the same guide recommends: CodeMirror
ships with its full source, comments and whitespace, so stripping those takes
the bundle from roughly 1 MB to ~310 KB.

Adding a CodeMirror feature means adding its export to `cm6-entry.js` — the
language, theme and editor wiring stay in `web/app.js`, so `web/vendor/` remains
a pure dependency drop.

## How the stylesheet is built

Rollup bundles JavaScript, so Tailwind cannot be an input to it the way the
CodeMirror modules are — CSS never enters the module graph. Instead a small
plugin in `rollup.config.mjs` runs Tailwind through PostCSS during the same
build and writes `web/vendor/tailwind.css`, so one `rollup -c` still produces
every vendored artifact.

`tailwind.config.js` holds the Material dark tokens that used to sit inline in
`index.html`; `content` there lists the files scanned for class names, and
`app.js` counts because it builds markup in template strings.

Tailwind is pinned to **3.4.17**, the exact version the Play CDN served, so the
generated stylesheet reproduces the previous rendering rather than migrating it.
Upgrading to v4 is a separate job: the config becomes CSS-first `@theme`, and a
handful of utility names changed.

## Fonts

Only the Material Symbols icon subset is vendored, because icons are ligatures
in an icon font and no operating system has one — without it every button would
render as the literal word `delete` or `close`. Body text comes from the user's
own system faces, so there is nothing to download and nothing to ship.

## Why vendor at all

Camer exists to repair a reverse proxy. It gets opened on hosts with no egress,
and while the proxy under repair is down. Anything fetched at runtime is a
dependency that fails exactly when the tool is needed most — and a missing
editor script used to leave a page that rendered fine and did nothing.

## What is *not* vendored

Nothing. The served page makes no external request — verified by enumerating
every `src`/`href` it asks for.
