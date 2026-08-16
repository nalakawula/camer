"use strict";

// The editor is vendored, but a stale cache or a bad deploy can still leave it
// missing. Fail visibly rather than dying on the first call and leaving a page
// that looks fine and does nothing — which is exactly how the CDN build failed.
if (typeof CM === "undefined" || !CM.EditorView) {
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText = "position:fixed;inset:0 0 auto 0;z-index:999;padding:14px 20px;" +
      "background:#93000a;color:#ffdad6;font:14px system-ui,sans-serif";
    bar.textContent = "Camer could not load its editor (web/vendor/codemirror.js). " +
      "The page will not work. Check that the vendored assets are being served.";
    document.body.prepend(bar);
  });
  throw new Error("CodeMirror bundle missing: web/vendor/codemirror.js did not load");
}

// ---- Caddyfile language (CodeMirror 6 stream parser) ----
// The parser tracks brace depth, which buys three things at once: token
// classification (the first word of a line is a site address at depth 0, a
// directive inside a block), indentation, and — via the language — the
// bracket-matching and auto-closing behaviour that used to be hand-rolled.
const caddyfileLanguage = CM.StreamLanguage.define({
  name: "caddyfile",

  startState: () => ({ depth: 0, indented: false, first: true }),

  token(stream, state) {
    if (stream.sol()) {
      // Leading whitespace is what separates a directive from a site address.
      state.indented = stream.eatSpace();
      state.first = true;
    } else if (stream.eatSpace()) {
      return null;
    }
    if (stream.eol()) return null;

    const done = (tok) => { state.first = false; return tok; };

    if (stream.peek() === "#") { stream.skipToEnd(); return done("comment"); }
    if (stream.match(/"(?:[^\\"]|\\.)*"?/)) return done("string");
    // {placeholders} like {uri}; a bare brace is a block delimiter, below.
    if (stream.match(/\{[^{}\s]+\}/)) return done("variable-2");
    if (stream.match(/@[\w.*-]+/)) return done("variable-2"); // named matcher
    if (stream.eat("{")) { state.depth++; return done("bracket"); }
    if (stream.eat("}")) { state.depth = Math.max(0, state.depth - 1); return done("bracket"); }
    if (stream.match(/\d+\b/)) return done("number");

    if (stream.match(/[^\s{}"#]+/)) {
      const wasFirst = state.first;
      state.first = false;
      if (!wasFirst) return "variable";
      return state.depth > 0 || state.indented ? "keyword" : "def";
    }

    stream.next();
    return done(null);
  },

  // cx.unit is the configured indent width in columns; indentString turns the
  // result back into tabs because indentUnit is a tab.
  indent(state, textAfter, cx) {
    const closing = /^\}/.test(textAfter) ? 1 : 0;
    return Math.max(0, state.depth - closing) * cx.unit;
  },

  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["{", '"'] },
    indentOnInput: /^\s*\}$/,
  },
});

// Same palette as before; the v5 rules were global CSS, this is scoped to the
// editor and keyed on syntax tags.
const editorHighlight = CM.syntaxHighlighting(CM.HighlightStyle.define([
  { tag: CM.tags.comment, color: "#8c909f", fontStyle: "italic" },
  { tag: CM.tags.keyword, color: "#ffb786" },                            // directives
  { tag: CM.tags.definition(CM.tags.variableName), color: "#adc6ff" },   // site addresses
  { tag: CM.tags.special(CM.tags.variableName), color: "#c0c1ff" },      // {placeholders}, @matchers
  { tag: CM.tags.variableName, color: "#dae2fd" },
  { tag: CM.tags.string, color: "#dae2fd" },
  { tag: CM.tags.number, color: "#ffb4ab" },
  { tag: CM.tags.bracket, color: "#8c909f" },
]));

const editorTheme = CM.EditorView.theme({
  "&": { height: "100%", backgroundColor: "#060e20", color: "#dae2fd", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  // Same stack as the `font-code` utility in index.html: the user's own
  // monospace face, with JetBrains Mono preferred if they happen to have it.
  ".cm-scroller": {
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: "1.7",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "#adc6ff", padding: "4px 0" },
  ".cm-gutters": { backgroundColor: "#060e20", color: "#8c909f", borderRight: "1px solid #424754" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 8px" },
  ".cm-activeLine": { backgroundColor: "rgba(173,198,255,0.05)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(173,198,255,0.05)", color: "#c2c6d6" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#adc6ff" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(173,198,255,0.20)",
  },
  // Bracket matching, now from the library rather than hand-rolled.
  ".cm-matchingBracket": { backgroundColor: "rgba(173,198,255,0.22)", color: "#adc6ff", fontWeight: "600" },
  ".cm-nonmatchingBracket": { color: "#ffb4ab", backgroundColor: "rgba(255,180,171,0.15)" },
  // Snippet placeholders awaiting Tab.
  ".cm-snippetField": { backgroundColor: "rgba(255,183,134,0.16)", outline: "1px dashed #ffb786" },
}, { dark: true });

// createEditor exposes only the handful of operations the rest of the app uses.
// Keeping that surface small is what made moving from CodeMirror 5 to 6 a local
// change instead of a rewrite.
function createEditor(parent) {
  let notify = () => {};

  const extensions = [
    CM.lineNumbers(),
    CM.highlightActiveLine(),
    CM.highlightActiveLineGutter(),
    CM.drawSelection(),
    CM.history(),
    CM.EditorState.tabSize.of(2),
    CM.indentUnit.of("\t"),   // Caddy's docs and every bundled snippet use tabs
    // Required for linked snippet fields: a placeholder repeated in a pattern
    // becomes several selection ranges edited together, and without this the
    // state collapses them to one, so only the first occurrence would fill in.
    CM.EditorState.allowMultipleSelections.of(true),
    CM.bracketMatching(),
    CM.closeBrackets(),
    CM.indentOnInput(),
    caddyfileLanguage,
    editorHighlight,
    editorTheme,
    CM.keymap.of([
      ...CM.closeBracketsKeymap,
      ...CM.defaultKeymap,
      ...CM.historyKeymap,
      CM.indentWithTab,
    ]),
    CM.EditorView.updateListener.of((u) => { if (u.docChanged) notify(); }),
  ];

  const view = new CM.EditorView({ doc: "", parent, extensions });

  return {
    view,
    getValue: () => view.state.doc.toString(),

    // Replacing the document is always a "load", so it also resets undo history
    // and reports the change — the same contract the old editor had.
    setValue(text) {
      view.setState(CM.EditorState.create({ doc: text, extensions }));
      notify();
    },

    focus: () => view.focus(),
    refresh: () => view.requestMeasure(),
    onChange(cb) { notify = cb; },

    // insertSnippet places a pattern at the cursor and selects its first
    // placeholder; CodeMirror binds Tab to the remaining fields while one is
    // active, and Escape to giving up on them.
    insertSnippet(template) {
      let pos = view.state.selection.main.head;
      const before = view.state.doc.sliceString(0, pos);
      // Keep a blank line between the snippet and whatever precedes it.
      const prefix = !before.length || before.endsWith("\n\n") ? ""
        : before.endsWith("\n") ? "\n" : "\n\n";
      if (prefix) {
        view.dispatch({
          changes: { from: pos, insert: prefix },
          selection: { anchor: pos + prefix.length },
        });
        pos += prefix.length;
      }
      // Insert on the fresh line, so the snippet's own indentation is not
      // shifted by whatever the cursor line happened to be indented to.
      CM.snippet(template)({ state: view.state, dispatch: (tr) => view.dispatch(tr) }, null, pos, pos);
      view.focus();
    },
  };
}

// ---- tiny DOM helpers ----
const $ = (id) => document.getElementById(id);
const api = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    // kind lets callers tell "Caddy is unreachable" apart from "the config is
    // wrong" — see writeCaddyError in handlers.go.
    err.kind = data && data.kind;
    err.endpoint = data && data.endpoint;
    throw err;
  }
  return data;
};

function toast(message, kind = "info") {
  const colors = {
    info: "border-outline-variant text-on-surface",
    success: "border-success/50 text-success",
    error: "border-error/50 text-error",
  };
  const el = document.createElement("div");
  el.className = `toast bg-surface-container-highest border ${colors[kind]} rounded-lg px-4 py-3 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] max-w-md text-[13px] flex items-start gap-2`;
  // role=alert interrupts; the container's polite region handles the rest.
  if (kind === "error") el.setAttribute("role", "alert");

  const icon = kind === "success" ? "check_circle" : kind === "error" ? "error" : "info";
  el.innerHTML =
    `<span class="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">${icon}</span>` +
    `<span class="whitespace-pre-wrap break-words flex-1">${escapeHTML(message)}</span>`;

  const dismiss = () => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  };
  const close = document.createElement("button");
  close.className = "shrink-0 text-on-surface-variant hover:text-on-surface transition-colors";
  close.setAttribute("aria-label", "Dismiss notification");
  close.innerHTML = `<span class="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>`;
  close.addEventListener("click", dismiss);
  el.appendChild(close);

  $("toasts").appendChild(el);
  // Errors persist until dismissed. An apply failure timing out of view — and
  // out of a screen reader's buffer — is exactly the message you cannot afford
  // to miss.
  if (kind !== "error") setTimeout(dismiss, 3500);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- time formatting ----
function absTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function relTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  let s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  for (const [unit, secs] of [["minute", 60], ["hour", 3600], ["day", 86400], ["month", 2592000]]) {
    const next = secs * (unit === "minute" ? 60 : unit === "hour" ? 24 : unit === "day" ? 30 : 12);
    if (s < next) { const n = Math.floor(s / secs); return `${n} ${unit}${n === 1 ? "" : "s"} ago`; }
  }
  return absTime(iso);
}

// ---- JSON document viewer ----
// Real Caddy configs run to thousands of lines, so the pane needs find and
// folding, and must not rebuild everything on every debounced adapt. Rows are
// one-per-line: folding hides ranges, which keeps every line in the DOM so find
// can still reach text inside collapsed blocks and open it.
const jsonView = {
  text: null,       // last text rendered, so an unchanged adapt costs nothing
  lines: [],
  rows: [],
  closeOf: [],      // for a line that opens a block, the line that closes it
  folded: new Set(),
  hits: [],         // line indices matching the current query
  hitIndex: -1,
  query: "",
};

// computeFolds pairs each block-opening line with the line that closes it, by
// brace depth. Only lines whose block spans more than one line are foldable.
function computeFolds(lines) {
  const closeOf = new Array(lines.length).fill(-1);
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    // Pretty-printed JSON never puts a brace inside a string on its own line
    // boundary, but strings can contain them, so strip strings first.
    const bare = lines[i].replace(/"(?:\\.|[^"\\])*"/g, '""');
    for (const ch of bare) {
      if (ch === "{" || ch === "[") stack.push(i);
      else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (open !== undefined && open !== i) closeOf[open] = i;
      }
    }
  }
  return closeOf;
}

function jsonRow(i, line, foldable) {
  const row = document.createElement("div");
  row.className = "jl";
  row.dataset.i = String(i);

  const gutter = document.createElement(foldable ? "button" : "span");
  gutter.className = "jl-fold";
  if (foldable) {
    gutter.textContent = "▾";
    gutter.setAttribute("aria-label", `Collapse block starting at line ${i + 1}`);
    gutter.setAttribute("aria-expanded", "true");
  } else {
    gutter.textContent = " ";
    gutter.setAttribute("aria-hidden", "true");
  }

  const text = document.createElement("span");
  text.className = "jl-text";
  text.innerHTML = highlightJSON(line);

  row.appendChild(gutter);
  row.appendChild(text);
  return row;
}

// applyFolds recomputes visibility in one pass. Folding is stored as a set of
// opener line numbers, so nested folds compose without bookkeeping.
function applyFolds() {
  const { rows, closeOf, folded } = jsonView;
  let i = 0;
  while (i < rows.length) {
    rows[i].hidden = false;
    const gutter = rows[i].firstChild;
    if (closeOf[i] > i) {
      const isFolded = folded.has(i);
      gutter.textContent = isFolded ? "▸" : "▾";
      gutter.setAttribute("aria-expanded", isFolded ? "false" : "true");
    }
    if (folded.has(i) && closeOf[i] > i) {
      for (let j = i + 1; j <= closeOf[i]; j++) rows[j].hidden = true;
      i = closeOf[i] + 1;
    } else {
      i++;
    }
  }
}

function toggleFold(i) {
  if (jsonView.folded.has(i)) jsonView.folded.delete(i);
  else jsonView.folded.add(i);
  applyFolds();
}

// renderJSONDoc paints text into the pane. Unchanged text is a no-op, which is
// what keeps typing cheap: most keystrokes do not change the adapted output.
function renderJSONDoc(text, { force } = {}) {
  const host = $("json-preview");
  if (!force && jsonView.text === text) return;

  jsonView.text = text;
  jsonView.lines = text ? text.split("\n") : [];
  jsonView.closeOf = computeFolds(jsonView.lines);
  jsonView.folded = new Set();
  jsonView.rows = [];
  jsonView.hits = [];
  jsonView.hitIndex = -1;
  host.innerHTML = "";

  const frag = document.createDocumentFragment();
  for (let i = 0; i < jsonView.lines.length; i++) {
    const row = jsonRow(i, jsonView.lines[i], jsonView.closeOf[i] > i);
    jsonView.rows.push(row);
    frag.appendChild(row);
  }
  host.appendChild(frag);
  if (jsonView.query) runJSONFind(jsonView.query);
}

// renderJSONMessage shows prose (an error, an empty state) instead of a document.
function renderJSONMessage(html) {
  jsonView.text = null;
  jsonView.rows = [];
  jsonView.hits = [];
  jsonView.hitIndex = -1;
  $("json-preview").innerHTML = `<div class="px-4 whitespace-pre-wrap">${html}</div>`;
}

// markMatches wraps query hits inside a row by walking text nodes, which keeps
// the JSON token markup intact — string surgery on the HTML would not.
function markMatches(row, query) {
  const text = row.lastChild;
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.toLowerCase().includes(needle)) targets.push(n);
  }
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    const value = node.nodeValue;
    let at = 0;
    for (;;) {
      const hit = value.toLowerCase().indexOf(needle, at);
      if (hit === -1) break;
      if (hit > at) frag.appendChild(document.createTextNode(value.slice(at, hit)));
      const mark = document.createElement("mark");
      mark.textContent = value.slice(hit, hit + query.length);
      frag.appendChild(mark);
      at = hit + query.length;
    }
    if (at < value.length) frag.appendChild(document.createTextNode(value.slice(at)));
    node.parentNode.replaceChild(frag, node);
  }
}

function runJSONFind(query) {
  jsonView.query = query;
  const { rows, lines } = jsonView;

  // Repaint every previously marked row from its source line.
  for (const row of rows) row.lastChild.innerHTML = highlightJSON(lines[Number(row.dataset.i)]);
  jsonView.hits = [];
  jsonView.hitIndex = -1;

  if (!query) {
    $("json-find-count").textContent = "";
    updateFindHighlight();
    return;
  }
  const needle = query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      jsonView.hits.push(i);
      markMatches(rows[i], query);
    }
  }
  $("json-find-count").textContent = jsonView.hits.length ? `1/${jsonView.hits.length}` : "no matches";
  if (jsonView.hits.length) gotoHit(0);
  else updateFindHighlight();
}

// gotoHit reveals a match, opening any folded blocks that contain it — a search
// that silently skipped collapsed content would be worse than no search.
function gotoHit(n) {
  const { hits, rows, closeOf, folded } = jsonView;
  if (!hits.length) return;
  jsonView.hitIndex = (n + hits.length) % hits.length;
  const line = hits[jsonView.hitIndex];

  for (const opener of [...folded]) {
    if (opener < line && line <= closeOf[opener]) folded.delete(opener);
  }
  applyFolds();
  updateFindHighlight();
  $("json-find-count").textContent = `${jsonView.hitIndex + 1}/${hits.length}`;
  rows[line].scrollIntoView({ block: "center" });
}

function updateFindHighlight() {
  for (const row of jsonView.rows) {
    row.classList.remove("hit-current");
    for (const m of row.getElementsByTagName("mark")) m.classList.remove("on");
  }
  if (jsonView.hitIndex < 0) return;
  const row = jsonView.rows[jsonView.hits[jsonView.hitIndex]];
  row.classList.add("hit-current");
  for (const m of row.getElementsByTagName("mark")) m.classList.add("on");
}

// ---- JSON syntax highlighting for the preview pane ----
function highlightJSON(json) {
  const esc = escapeHTML(json);
  return esc.replace(
    /("(?:\\.|[^"\\])*"(\s*:)?)|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, bool, num) => {
      if (str) return `<span class="${colon ? "j-key" : "j-str"}">${m}</span>`;
      if (bool) return `<span class="j-bool">${m}</span>`;
      if (m === "null") return `<span class="j-null">${m}</span>`;
      if (num) return `<span class="j-num">${m}</span>`;
      return m;
    }
  ).replace(/([{}\[\],])/g, '<span class="j-punc">$1</span>');
}

// ---- application state ----
const state = {
  currentId: null,     // id of the loaded saved config, or null for a new unsaved draft
  savedContent: "",    // last-persisted content, to compute the dirty flag
  savedName: "",
  configs: [],
  live: null,          // {id, configId, content, created_at} of the last successful deploy
  applying: false,     // an apply is in flight
  applyFailed: false,  // the last apply failed; sticky until the user acts again
  restoredFrom: null,  // {deployId, configName, wouldOverwrite} when loaded from history
};

const editor = createEditor($("editor-host"));

// A plain Caddyfile. Onboarding copy used to live here as a comment, which meant
// every new draft carried "# Welcome to Camer" into production; the hint belongs
// in the UI instead — see the empty state in renderPreview and firstRunHint.
const STARTER = `example.com {
\treverse_proxy localhost:8080
}
`;

// ---- state indicator ----
// The UI has to answer two independent questions at once — is this persisted to
// SQLite, and is it what Caddy is actually running — so one badge reports both.
// Reporting only the first is how a user comes to believe a saved draft is live.
const STATES = {
  applying:   { text: "Applying…",                  cls: "text-tertiary",           dot: "bg-tertiary animate-pulse", hint: "Sending the configuration to Caddy." },
  failed:     { text: "Apply failed",               cls: "text-error",              dot: "bg-error",                  hint: "The last apply did not succeed — Caddy is still running the previous configuration." },
  live:       { text: "Live",                       cls: "text-success",            dot: "bg-success",                hint: "This is the configuration Caddy is running." },
  unsaved:    { text: "Unsaved changes",            cls: "text-tertiary",           dot: "bg-tertiary",               hint: "The editor differs from the saved draft." },
  differs:    { text: "Saved · differs from live",  cls: "text-primary",            dot: "bg-primary",                hint: "The draft is saved, but Caddy is running something else. Apply to make it live." },
  notApplied: { text: "Saved · not applied",        cls: "text-on-surface-variant", dot: "bg-on-surface-variant",     hint: "The draft is saved. Nothing has been applied to Caddy yet." },
};

function isDirty() {
  return editor.getValue() !== state.savedContent || $("config-name").value !== state.savedName;
}

// isSaved is stricter than !isDirty(): content loaded into a brand new, never
// persisted draft is not dirty, but it is certainly not saved either.
function isSaved() {
  return state.currentId != null && !isDirty();
}

function matchesLive() {
  return state.live != null && editor.getValue() === state.live.content;
}

function stateKey() {
  if (state.applying) return "applying";
  if (state.applyFailed) return "failed";
  // What is running matters more than what is filed, so check it first.
  if (matchesLive() && !isDirty()) return "live";
  if (!isSaved()) return "unsaved";
  return state.live != null ? "differs" : "notApplied";
}

function refreshState() {
  const key = stateKey();
  const s = STATES[key];
  $("state-text").textContent = s.text;
  $("state-text").className = s.cls;
  $("state-dot").className = "w-1.5 h-1.5 rounded-full block shrink-0 " + s.dot;

  // Restoring from history is the one case where "unsaved" understates the risk:
  // saving would replace a draft that is newer than what the editor holds.
  const over = state.restoredFrom;
  $("state-badge").title = (key === "unsaved" && over && over.wouldOverwrite)
    ? `Loaded from deploy #${over.deployId}. Saving will ask before overwriting the newer draft “${over.configName}”.`
    : s.hint;

  // Delete only means something when there is a saved config to delete.
  const btn = $("btn-delete");
  const deletable = state.currentId != null;
  btn.disabled = !deletable;
  btn.title = deletable
    ? "Delete this saved Caddyfile"
    : "Nothing to delete — this draft has never been saved";
  btn.classList.toggle("opacity-40", !deletable);
  btn.classList.toggle("cursor-not-allowed", !deletable);
}

// clearApplyFailure drops the sticky failure state once the user does something
// else; it must never clear itself on a timer, or a failed apply ends up looking
// like a healthy one.
function clearApplyFailure() {
  if (state.applyFailed) state.applyFailed = false;
}

// ---- endpoint field ----
// This field drives the live JSON preview as well as apply, which is not obvious
// from its position next to the Apply button — hence the helper text, and hence
// re-adapting when it changes.
function loadEndpoint() {
  const saved = localStorage.getItem("camer.endpoint");
  if (saved) $("endpoint").value = saved;
}

let endpointTimer = null;
let probeSeq = 0;

// setEndpointStatus renders one of: reachable, unreachable, checking.
function setEndpointStatus(kind, message) {
  const box = $("endpoint-status");
  const icon = $("endpoint-status-icon");
  const text = $("endpoint-status-text");
  const cls = { ok: "text-success", checking: "text-on-surface-variant", bad: "text-tertiary" }[kind];

  box.classList.remove("hidden");
  box.className = `font-label text-[11px] flex items-center gap-1 ${cls}`;
  if (kind === "checking") {
    icon.textContent = "sync";
    text.textContent = "checking…";
    box.title = "Checking whether a Caddy admin API answers at this address.";
  } else if (kind === "ok") {
    icon.textContent = "cloud_done";
    text.textContent = "reachable";
    box.title = "A Caddy admin API answered at this address.";
  } else {
    icon.textContent = "cloud_off";
    text.textContent = "unreachable";
    box.title = message || "Camer could not reach a Caddy admin API at this address.";
  }
}

// Kept as the name the adapt/apply paths already call: they only ever know
// whether the last real request got through.
function setEndpointReachable(ok, message) {
  setEndpointStatus(ok ? "ok" : "bad", message);
}

// showEffectiveBase surfaces normalizeBase's rewriting — pasting a /load or
// /config URL silently changes the target, which was documented only in the
// README.
function showEffectiveBase(raw, base) {
  const help = $("endpoint-help");
  const rewritten = base && base !== raw.replace(/\/+$/, "");
  help.innerHTML = rewritten
    ? `Drives the live preview <em>and</em> apply · calls <span class="font-code text-on-surface">${escapeHTML(base)}</span>`
    : `Drives the live preview <em>and</em> apply.`;
  help.title = base ? `Camer will call ${base}/adapt and ${base}/load.` : "";
}

// probeEndpoint checks reachability up front, so a wrong address is visible
// before the user has tried to apply anything.
async function probeEndpoint() {
  const raw = $("endpoint").value.trim();
  const seq = ++probeSeq;
  setEndpointStatus("checking");
  try {
    const res = await api("GET", `/api/endpoint?url=${encodeURIComponent(raw)}&probe=1`);
    if (seq !== probeSeq) return; // superseded by a newer edit
    showEffectiveBase(raw, res.base);
    setEndpointStatus(res.reachable ? "ok" : "bad", res.error);
  } catch (e) {
    if (seq !== probeSeq) return;
    setEndpointStatus("bad", e.message);
  }
}

$("endpoint").addEventListener("input", () => {
  clearTimeout(endpointTimer);
  endpointTimer = setTimeout(() => {
    localStorage.setItem("camer.endpoint", $("endpoint").value.trim());
    probeEndpoint();
    scheduleAdapt(true); // the preview is computed through this endpoint
  }, 500);
});

// ---- config list (sidebar) ----
async function loadConfigList() {
  try {
    state.configs = await api("GET", "/api/configs");
    renderConfigList();
  } catch (e) {
    toast("Could not load drafts: " + e.message, "error");
  }
}

// FILTER_THRESHOLD is where scanning a list by eye stops working.
const FILTER_THRESHOLD = 8;

function renderConfigList() {
  const box = $("config-list");
  const filter = $("config-filter");
  box.innerHTML = "";

  filter.classList.toggle("hidden", state.configs.length < FILTER_THRESHOLD);
  const q = filter.classList.contains("hidden") ? "" : filter.value.trim().toLowerCase();
  const items = q
    ? state.configs.filter((c) => c.name.toLowerCase().includes(q))
    : state.configs;

  if (state.configs.length === 0) {
    box.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">No saved drafts yet.<br>Create one to get started.</div>`;
    return;
  }
  if (items.length === 0) {
    box.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">No draft matches “${escapeHTML(q)}”.</div>`;
    return;
  }

  for (const c of items) {
    const active = c.id === state.currentId;
    // Which draft is live matters as much here as it does in the history.
    const live = state.live != null && state.live.configId === c.id;
    const a = document.createElement("button");
    a.setAttribute("role", "listitem");
    a.className = `w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-95 duration-150 ${
      active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
    }`;
    // Names truncate, and two "Untitled Caddyfile" rows are indistinguishable
    // without a timestamp — so carry both, plus the full name in the tooltip.
    a.title = `${c.name} — updated ${absTime(c.updated_at)}`;
    a.innerHTML =
      `<span class="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">description</span>
       <span class="flex flex-col min-w-0 flex-1">
         <span class="font-display flex items-center gap-1.5 min-w-0">
           <span class="truncate">${escapeHTML(c.name)}</span>
           ${live ? LIVE_BADGE : ""}
         </span>
         <span class="text-[11px] ${active ? "" : "text-on-surface-variant"}">updated ${escapeHTML(relTime(c.updated_at))}</span>
       </span>`;
    a.addEventListener("click", () => selectConfig(c.id));
    box.appendChild(a);
  }
}

// loadIntoEditor replaces the editor contents and resets the dirty baseline.
// Pass id = null for content that is not (yet) backed by a saved config.
function loadIntoEditor(id, name, content) {
  state.currentId = id;
  state.savedContent = content;
  state.savedName = name;
  state.restoredFrom = null; // restoreDeploy re-sets this after calling us
  $("config-name").value = name;
  editor.setValue(content);
  refreshState();
  renderConfigList();
}

async function selectConfig(id) {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  try {
    const c = await api("GET", `/api/configs/${id}`);
    loadIntoEditor(c.id, c.name, c.content);
    setDrawer(false);
    scheduleAdapt(true);
  } catch (e) {
    toast("Failed to open draft: " + e.message, "error");
  }
}

function newConfig() {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  loadIntoEditor(null, "", STARTER);
  scheduleAdapt(true);
  editor.focus();
}

async function saveConfig() {
  let name = $("config-name").value.trim() || "Untitled Caddyfile";
  const content = editor.getValue();
  // Decided below, then committed to state only once the request succeeds, so a
  // failed save cannot detach the editor from its config.
  let targetId = state.currentId;

  // A Caddyfile restored from history is attached to its source config, so a
  // plain save would silently replace that draft's current content — which may
  // be newer than the deploy. Make the overwrite a decision, not an accident.
  if (state.restoredFrom && state.restoredFrom.wouldOverwrite && state.currentId != null) {
    const current = state.configs.find((c) => c.id === state.currentId);
    if (current && current.content !== content) {
      const choice = await askDialog({
        title: "Overwrite the newer saved draft?",
        icon: "warning",
        body: [
          `The editor holds deploy #${state.restoredFrom.deployId}, but the saved draft “${current.name}” has different content.`,
          "Overwriting replaces that draft. Saving as a new config keeps both.",
        ],
        actions: [
          { key: "cancel", label: "Cancel" },
          { key: "new", label: "Save as new config" },
          { key: "overwrite", label: "Overwrite draft", danger: true },
        ],
      });
      if (choice !== "new" && choice !== "overwrite") return;
      if (choice === "new") {
        // No id takes the create path below, leaving the original draft intact.
        targetId = null;
        name = `${name} (deploy #${state.restoredFrom.deployId})`;
      }
    }
  }

  try {
    let c;
    if (targetId == null) {
      c = await api("POST", "/api/configs", { name, content });
    } else {
      c = await api("PUT", `/api/configs/${targetId}`, { name, content });
    }
    state.currentId = c.id;
    state.savedContent = c.content;
    state.savedName = c.name;
    state.restoredFrom = null;
    $("config-name").value = c.name;
    refreshState();
    await loadConfigList();
    toast("Saved draft “" + c.name + "”", "success");
  } catch (e) {
    toast("Save failed: " + e.message, "error");
  }
}

// deleteConfig deletes the saved config. It is unreachable when nothing is
// saved — the button is disabled in that state, rather than quietly falling
// through to "reset the editor to the sample", which is what it used to do
// behind a label that said Delete.
async function deleteConfig() {
  if (state.currentId == null) return;
  const name = state.savedName || $("config-name").value.trim() || "Untitled Caddyfile";

  const choice = await askDialog({
    title: "Delete this saved draft?",
    icon: "delete",
    iconCls: "text-error",
    body: [
      `“${name}” will be removed from Camer permanently.`,
      "Caddy keeps serving whatever is live — deleting a draft never changes the running configuration.",
    ],
    actions: [
      { key: "cancel", label: "Cancel" },
      { key: "delete", label: "Delete permanently", danger: true },
    ],
  });
  if (choice !== "delete") return;

  try {
    await api("DELETE", `/api/configs/${state.currentId}`);
    loadIntoEditor(null, "", "");
    await loadConfigList();
    toast(`Deleted “${name}”. The editor is now empty.`, "success");
  } catch (e) {
    toast("Delete failed: " + e.message, "error");
  }
}

// ---- snippet template helpers ----
// Mirrors CodeMirror's own template grammar so the UI can describe a snippet
// without instantiating it.
const SNIPPET_FIELD = "[#$]\\{(?:(\\d+)(?::([^{}]*))?|((?:\\\\[{}]|[^{}])*))\\}";

// snippetText renders a template as the literal text it will insert, for tooltips.
function snippetText(template) {
  return template.replace(new RegExp(SNIPPET_FIELD, "g"), (m, seq, label, name) => label || name || "");
}

// countSnippetFields counts distinct placeholders. Fields sharing a name are
// edited together, so they count once — the same linking CodeMirror applies.
function countSnippetFields(template) {
  const seen = new Set();
  for (const m of template.matchAll(new RegExp(SNIPPET_FIELD, "g"))) {
    if (m[1] === "0") continue; // ${0} is the final cursor, not a field
    seen.add(m[1] ? "#" + m[1] : (m[2] || m[3] || ""));
  }
  return seen.size;
}

// ---- common patterns menu ----
function renderPatterns() {
  const list = $("patterns-list");
  const patterns = window.CADDY_PATTERNS || [];
  list.innerHTML = "";
  for (const p of patterns) {
    const btn = document.createElement("button");
    btn.className = "w-full text-left px-3 py-2 rounded-lg hover:bg-surface-container-high transition-colors group";
    btn.title = snippetText(p.code);
    btn.innerHTML = `<div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-primary shrink-0" aria-hidden="true">bolt</span>
        <span class="font-display text-on-surface truncate">${escapeHTML(p.name)}</span>
      </div>
      <div class="text-on-surface-variant text-[12px] font-body pl-6 truncate">${escapeHTML(p.desc || "")}</div>`;
    btn.addEventListener("click", () => { insertPattern(p.code); closePatterns(); });
    list.appendChild(btn);
  }
}

// insertPattern hands the template to CodeMirror's snippet support, which
// selects the first placeholder and binds Tab to the rest.
function insertPattern(template) {
  editor.insertSnippet(template);
  const fields = countSnippetFields(template);
  if (fields > 1) {
    toast(`Inserted. Tab moves through the ${fields} highlighted placeholders.`, "info");
  }
  refreshState();
  scheduleAdapt(false);
}

function togglePatterns() { $("patterns-menu").classList.toggle("hidden"); }
function closePatterns() { $("patterns-menu").classList.add("hidden"); }

// ---- JSON pane ----
// The pane used to show three different documents behind one label, and the
// running config silently vanished on the next keystroke. Each view now has its
// own slot and its own tab, and the mode only changes when the user asks.
const preview = {
  mode: "adapted",
  adapted: { json: "", warnings: [], error: null },
  running: { json: "", error: null, fetchedAt: null, loaded: false },
  compare: { diff: null, error: null, loaded: false },
};

const PREVIEW_MODES = ["adapted", "running", "compare"];

function setPreviewMode(mode) {
  preview.mode = mode;
  for (const m of PREVIEW_MODES) {
    const btn = $("mode-" + m);
    const on = m === mode;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.className = "text-[13px] font-medium px-2.5 py-1 rounded-lg border transition-colors " +
      (on ? "border-primary text-primary bg-primary/10"
          : "border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline");
  }
  // Fetch only when the view is actually asked for.
  if (mode === "running" && !preview.running.loaded) { pullCurrent(); return; }
  if (mode === "compare" && !preview.compare.loaded) { runCompare(); return; }
  renderPreview();
}

function renderPreview() {
  const note = $("mode-note");
  $("json-tools").classList.toggle("hidden", preview.mode === "compare");
  $("json-scroll").classList.toggle("hidden", preview.mode === "compare");
  $("compare-body").classList.toggle("hidden", preview.mode !== "compare");
  $("warnings").classList.add("hidden");
  note.classList.add("hidden");

  if (preview.mode === "adapted") {
    const a = preview.adapted;
    if (a.error) {
      const unreachable = a.error.kind === "unreachable";
      setPreviewStatus(unreachable ? "cannot reach Caddy" : "invalid", unreachable ? "text-tertiary" : "text-error");
      renderJSONMessage(unreachable
        ? `<span class="text-tertiary">${escapeHTML(a.error.message)}</span>` +
          `<span class="text-on-surface-variant">\n\nThe Caddyfile has not been checked — adapting needs a reachable ` +
          `admin API. Fix the endpoint below and this will retry.</span>`
        : `<span class="text-error">${escapeHTML(a.error.message)}</span>`);
    } else if (!a.json) {
      // The empty state carries the onboarding that used to be a comment inside
      // every new Caddyfile.
      setPreviewStatus("empty");
      renderJSONMessage(
        `<span class="text-on-surface-variant">Write a Caddyfile on the left and its adapted JSON appears here, ` +
        `checked by Caddy as you type.\n\nNothing reaches the server until you press “Apply to Caddy”. ` +
        `Use “Patterns” for a starting point, or “Compare” to see how your draft differs from what is running.</span>`);
    } else {
      setPreviewStatus("valid", "text-success");
      renderJSONDoc(a.json);
      renderWarnings(a.warnings);
    }
    return;
  }

  if (preview.mode === "running") {
    const r = preview.running;
    note.classList.remove("hidden");
    note.textContent = "What Caddy is serving right now. Editing the Caddyfile does not change this view — use Pull Running to refresh it.";
    if (r.error) {
      setPreviewStatus("unavailable", "text-error");
      renderJSONMessage(`<span class="text-error">${escapeHTML(r.error)}</span>`);
      return;
    }
    setPreviewStatus(r.fetchedAt ? `fetched ${relTime(r.fetchedAt)}` : "", "text-primary");
    renderJSONDoc(r.json);
    return;
  }

  const c = preview.compare;
  note.classList.remove("hidden");
  note.textContent = "Your adapted JSON compared with the running config. Both sides are key-sorted, so only real differences show.";
  if (c.error) {
    setPreviewStatus("unavailable", "text-error");
    $("compare-body").innerHTML = `<div class="p-8 text-center text-[13px] font-body text-error whitespace-pre-wrap">${escapeHTML(c.error)}</div>`;
    return;
  }
  if (!c.diff) {
    setPreviewStatus("comparing…", "text-primary");
    $("compare-body").innerHTML = `<div class="p-8 text-center text-[13px] font-body text-on-surface-variant">Comparing…</div>`;
    return;
  }
  setPreviewStatus(c.diff.identical ? "no differences" : `+${c.diff.added} −${c.diff.removed}`,
                   c.diff.identical ? "text-success" : "text-primary");
  renderDiff(c.diff, $("compare-body"), {
    identicalMessage: "No differences — applying this would leave Caddy's configuration exactly as it is.",
  });
}

// currentJSON is whatever document the pane is showing, which is what Copy
// should copy.
function currentJSON() {
  if (preview.mode === "running") return preview.running.json;
  if (preview.mode === "adapted") return preview.adapted.json;
  return "";
}

let compareSeq = 0;

async function runCompare() {
  const caddyfile = editor.getValue();
  const endpoint = $("endpoint").value.trim();
  const seq = ++compareSeq;

  preview.compare = { diff: null, error: null, loaded: true };
  if (!caddyfile.trim()) {
    preview.compare.error = "The editor is empty — there is nothing to compare.";
    renderPreview();
    return;
  }
  renderPreview();

  try {
    const res = await api("POST", "/api/compare", { caddyfile, endpoint });
    if (seq !== compareSeq) return;
    preview.compare = { diff: res.diff, error: null, loaded: true };
    setEndpointReachable(true);
  } catch (e) {
    if (seq !== compareSeq) return;
    preview.compare = {
      diff: null,
      loaded: true,
      error: e.kind === "unreachable"
        ? `Cannot compare — ${e.message}`
        : e.kind === "invalid"
        ? `The Caddyfile does not adapt, so there is nothing to compare with:\n\n${e.message}`
        : e.message,
    };
    setEndpointReachable(e.kind !== "unreachable", e.message);
  }
  renderPreview();
}

// ---- adapt (JSON preview), debounced ----
let adaptTimer = null;
let adaptSeq = 0;

function setPreviewStatus(text, cls) {
  const el = $("preview-status");
  el.textContent = text;
  el.className = "font-label text-[12px] " + (cls || "text-on-surface-variant");
}


function scheduleAdapt(immediate) {
  clearTimeout(adaptTimer);
  adaptTimer = setTimeout(runAdapt, immediate ? 0 : 500);
}

// runAdapt refreshes the adapted slot. It always runs — validity and warnings
// are wanted whichever tab is showing — but it only repaints when the adapted
// tab is the one on screen.
async function runAdapt() {
  const caddyfile = editor.getValue();
  const endpoint = $("endpoint").value.trim();

  if (!caddyfile.trim()) {
    preview.adapted = { json: "", warnings: [], error: null };
    if (preview.mode === "adapted") renderPreview();
    return;
  }

  const seq = ++adaptSeq;
  if (preview.mode === "adapted") setPreviewStatus("adapting…", "text-primary");
  $("sync-icon").classList.add("animate-spin");
  try {
    const res = await api("POST", "/api/adapt", { caddyfile, endpoint });
    if (seq !== adaptSeq) return; // a newer request superseded this one
    preview.adapted = { json: res.json, warnings: res.warnings || [], error: null };
    setEndpointReachable(true);
  } catch (e) {
    if (seq !== adaptSeq) return;
    // An unreachable endpoint says nothing about the Caddyfile; renderPreview
    // keeps the two apart.
    preview.adapted = { json: "", warnings: [], error: { kind: e.kind, message: e.message } };
    setEndpointReachable(e.kind !== "unreachable", e.message);
  } finally {
    if (seq === adaptSeq) $("sync-icon").classList.remove("animate-spin");
  }

  if (preview.mode === "adapted") renderPreview();
  // Compare is derived from the editor, so keep it live while it is on screen.
  else if (preview.mode === "compare") runCompare();
}

function renderWarnings(warnings) {
  const box = $("warnings");
  if (!warnings || warnings.length === 0) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = warnings.map((w) => {
    const loc = w.line ? `line ${w.line}` : "";
    const dir = w.directive ? `<b>${escapeHTML(w.directive)}</b> ` : "";
    return `<div class="flex items-start gap-2 py-0.5"><span class="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">warning</span><span>${dir}${escapeHTML(w.message)} ${loc ? `<span class="text-on-surface-variant">(${loc})</span>` : ""}</span></div>`;
  }).join("");
}

// ---- dialogs (focus trap + focus restore) ----
// A small shared helper rather than one-off wiring per modal: CAM-21 routes the
// deploy-history modal through this too.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const dialogStack = [];

function openDialog(el, { initialFocus, onCancel } = {}) {
  dialogStack.push({ el, onCancel, restore: document.activeElement });
  el.classList.remove("hidden");
  const target = initialFocus || el.querySelector(FOCUSABLE);
  if (target) target.focus();
}

function closeDialog(el) {
  const i = dialogStack.findIndex((d) => d.el === el);
  if (i === -1) return;
  const [entry] = dialogStack.splice(i, 1);
  el.classList.add("hidden");
  if (entry.restore && typeof entry.restore.focus === "function") entry.restore.focus();
}

function topDialog() {
  return dialogStack.length ? dialogStack[dialogStack.length - 1] : null;
}

// askDialog poses a question with an arbitrary set of answers and resolves the
// chosen action's key, or null when dismissed. Exists because the choices that
// matter here — overwrite versus save-as-new — cannot be expressed by a native
// confirm(), and because a destructive action should name what it destroys.
function askDialog({ title, body, icon = "help", iconCls = "text-tertiary", actions }) {
  const modal = $("ask-modal");
  const box = $("ask-actions");
  $("ask-title").textContent = title;
  $("ask-icon").textContent = icon;
  $("ask-icon").className = "material-symbols-outlined text-[18px] " + iconCls;
  $("ask-body").innerHTML = body.map((p) => `<p>${escapeHTML(p)}</p>`).join("");
  box.innerHTML = "";

  return new Promise((resolve) => {
    const done = (key) => {
      modal.removeEventListener("click", onBackdrop);
      closeDialog(modal);
      resolve(key);
    };
    const onBackdrop = (e) => { if (e.target === modal) done(null); };

    let firstSafe = null;
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "font-medium py-2 px-4 rounded-lg transition-colors active:scale-95 duration-150 " + (
        a.danger ? "border border-error/60 text-error hover:bg-error/10"
        : a.primary ? "bg-primary hover:bg-primary-fixed-dim text-on-primary"
        : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
      );
      b.textContent = a.label;
      b.addEventListener("click", () => done(a.key));
      box.appendChild(b);
      if (!firstSafe && !a.danger && !a.primary) firstSafe = b;
    }
    modal.addEventListener("click", onBackdrop);
    // Focus the least destructive answer, so a stray Enter cannot do damage.
    openDialog(modal, { initialFocus: firstSafe || box.firstChild, onCancel: () => done(null) });
  });
}

// Keep Tab inside the topmost dialog so the overlay is not just a visual barrier.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const top = topDialog();
  if (!top) return;
  const items = [...top.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---- apply to Caddy ----

// resolveEndpoint asks the server which base URL it will actually call, so the
// confirmation shows the real target rather than the raw string. Falls back to
// the raw value if the lookup fails — never block applying on a cosmetic call.
async function resolveEndpoint(endpoint) {
  try {
    const res = await api("GET", `/api/endpoint?url=${encodeURIComponent(endpoint)}`);
    return res.base;
  } catch {
    return endpoint || "http://localhost:2019";
  }
}

// fetchDiff compares content against a recorded deploy — by default whatever is
// live. Returns null on failure: the diff is decision support, so a broken diff
// must not block applying.
async function fetchDiff(content, baseDeployID = null) {
  try {
    return await api("POST", "/api/diff", { content, base_deploy_id: baseDeployID });
  } catch {
    return null;
  }
}

// renderConfirmDiff answers "what will this change?" before the change lands,
// rather than only afterwards in the audit log.
function renderConfirmDiff(res) {
  const summary = $("confirm-diff-summary");
  const stats = $("confirm-diff-stats");
  const body = $("confirm-diff");

  if (!res) {
    summary.textContent = "Could not compare against the running configuration.";
    stats.textContent = "";
    body.innerHTML = "";
    return;
  }
  const { diff, base } = res;

  if (base) {
    summary.innerHTML = `against the live configuration — deploy <b>#${base.id}</b>, ` +
      `applied ${escapeHTML(relTime(base.created_at))}`;
  } else {
    summary.textContent = "Camer has not applied anything yet — this is the first configuration it will apply.";
  }

  stats.innerHTML = diff.identical
    ? `<span class="text-on-surface-variant">no changes</span>`
    : `<span class="text-success">+${diff.added}</span> <span class="text-error">−${diff.removed}</span>` +
      (diff.truncated ? ` <span class="text-on-surface-variant">(too large to diff precisely — shown as a full replacement)</span>` : "");

  renderDiff(diff, body, {
    identicalMessage: "Identical to the configuration Caddy is already running — applying this changes nothing.",
  });
}

// confirmApply resolves true only when the user explicitly confirms.
function confirmApply({ endpointBase, name, source, diffRes, title }) {
  const modal = $("confirm-modal");
  $("confirm-title").textContent = title || "Apply this configuration to Caddy?";
  $("confirm-endpoint").textContent = endpointBase + "/load";
  $("confirm-name").textContent = name;
  $("confirm-source").textContent = source;
  renderConfirmDiff(diffRes);

  return new Promise((resolve) => {
    const done = (ok) => {
      $("confirm-ok").removeEventListener("click", onOK);
      $("confirm-cancel").removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      closeDialog(modal);
      resolve(ok);
    };
    const onOK = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === modal) done(false); };

    $("confirm-ok").addEventListener("click", onOK);
    $("confirm-cancel").addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    // Cancel takes focus: the safe choice should be the one a stray Enter hits.
    openDialog(modal, { initialFocus: $("confirm-cancel"), onCancel });
  });
}

async function applyConfig() {
  const caddyfile = editor.getValue();
  if (!caddyfile.trim()) { toast("Nothing to apply — the editor is empty.", "error"); return; }
  const endpoint = $("endpoint").value.trim();

  const [endpointBase, diffRes] = await Promise.all([
    resolveEndpoint(endpoint),
    fetchDiff(caddyfile),
  ]);

  const confirmed = await confirmApply({
    endpointBase,
    diffRes,
    name: $("config-name").value.trim() || "Untitled Caddyfile",
    source: isSaved()
      ? "the saved draft"
      : "the editor contents, which are not saved as a draft",
  });
  if (!confirmed) return;

  await applyToCaddy(caddyfile, endpoint, state.currentId);
}

// reapplyDeploy puts a historical configuration back on the server. The audit
// trail already stores full content, so rollback costs one confirmation — and
// users arrive at a deploy history expecting exactly that.
async function reapplyDeploy(d) {
  const endpoint = $("endpoint").value.trim();
  const [endpointBase, diffRes] = await Promise.all([
    resolveEndpoint(endpoint),
    fetchDiff(d.content),
  ]);

  const confirmed = await confirmApply({
    title: `Re-apply deploy #${d.id} to Caddy?`,
    endpointBase,
    diffRes,
    name: d.config_name || "Unsaved draft",
    source: `deploy #${d.id}, applied ${relTime(d.created_at)}`,
  });
  if (!confirmed) return;

  // Record it against the config it originally came from, not whatever the
  // editor happens to hold.
  await applyToCaddy(d.content, endpoint, d.config_id ?? null);
  await loadHistory();
}

async function applyToCaddy(caddyfile, endpoint, configId) {
  const btn = $("btn-submit");
  btn.disabled = true;
  state.applying = true;
  state.applyFailed = false;
  refreshState();
  try {
    await api("POST", "/api/load", { caddyfile, endpoint, config_id: configId ?? null });
    state.applying = false;
    // Trust the server's record of what is live rather than assuming.
    await refreshLive();
    setEndpointReachable(true);
    refreshState();
    toast("Configuration applied to Caddy.", "success");
  } catch (e) {
    state.applying = false;
    state.applyFailed = true;
    // A rejected config still proves Caddy was reached.
    setEndpointReachable(e.kind !== "unreachable", e.message);
    refreshState();
    toast("Apply failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// pullCurrent fills the Running slot. The result now persists across editing
// instead of being wiped by the next adapt.
async function pullCurrent() {
  const endpoint = $("endpoint").value.trim();
  setPreviewStatus("fetching…", "text-primary");
  try {
    const res = await api("POST", "/api/current", { endpoint });
    preview.running = { json: res.json, error: null, fetchedAt: new Date().toISOString(), loaded: true };
    setEndpointReachable(true);
  } catch (e) {
    preview.running = { json: "", error: e.message, fetchedAt: null, loaded: true };
    setEndpointReachable(e.kind !== "unreachable", e.message);
    toast("Could not fetch the running config: " + e.message, "error");
  }
  setPreviewMode("running");
}

async function copyJSON() {
  const json = currentJSON();
  if (!json) {
    toast(preview.mode === "compare"
      ? "Compare shows a diff, not a document — switch to Adapted or Running to copy JSON."
      : "No JSON to copy.", "error");
    return;
  }
  try { await navigator.clipboard.writeText(json); toast("JSON copied to clipboard.", "success"); }
  catch { toast("Clipboard blocked by browser.", "error"); }
}

// ---- deploy history (audit) ----
const hist = { deploys: [], selected: null, total: 0 };
const HISTORY_PAGE = 50;

// The single most important fact in a deploy list is which entry is running
// right now; without it a FAILED row gives no clue what state the server is in.
// Derived from state.live so the badge and the header indicator cannot disagree.
const LIVE_BADGE = `<span class="font-label text-[10px] text-success border border-success/50 rounded px-1.5 py-0.5 shrink-0">LIVE</span>`;

function isLiveDeploy(id) {
  return state.live != null && state.live.id === id;
}

function openHistory() {
  openDialog($("history-modal"), { onCancel: closeHistory, initialFocus: $("btn-history-close") });
  loadHistory();
}

function closeHistory() { closeDialog($("history-modal")); }

// loadHistory fetches a page. append=true adds the next page instead of
// replacing, so older entries are reachable rather than silently cut off.
async function loadHistory(append = false) {
  const list = $("history-list");
  if (!append) {
    list.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">Loading…</div>`;
  }
  try {
    const offset = append ? hist.deploys.length : 0;
    const res = await api("GET", `/api/deploys?limit=${HISTORY_PAGE}&offset=${offset}`);
    hist.total = res.total;
    hist.deploys = append ? hist.deploys.concat(res.deploys) : res.deploys;
  } catch (e) {
    list.innerHTML = `<div class="text-error text-[13px] px-3 py-4 text-center">${escapeHTML(e.message)}</div>`;
    return;
  }
  renderHistoryList();
  if (append) return;
  if (hist.deploys.length) selectDeploy(hist.deploys[0].id);
  else $("history-detail").innerHTML = `<div class="text-on-surface-variant text-[13px] p-8 text-center">Nothing has been applied yet.</div>`;
}

function renderHistoryList() {
  const list = $("history-list");
  list.innerHTML = "";

  // Say how much of the history is on screen rather than truncating in silence.
  const shown = hist.deploys.length;
  $("history-count").textContent = hist.total === 0
    ? "No deploys recorded"
    : shown >= hist.total
    ? `${hist.total} ${hist.total === 1 ? "deploy" : "deploys"}`
    : `showing ${shown} of ${hist.total}`;
  $("btn-history-more").classList.toggle("hidden", shown >= hist.total);

  if (hist.deploys.length === 0) {
    list.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">No deploys recorded.</div>`;
    return;
  }
  for (const d of hist.deploys) {
    const active = d.id === hist.selected;
    const btn = document.createElement("button");
    btn.className = `w-full text-left px-3 py-2 rounded-lg transition-colors ${
      active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
    }`;
    btn.title = d.config_name || "Unsaved draft";
    btn.innerHTML = `<div class="flex items-center gap-2">
        <span aria-hidden="true" class="material-symbols-outlined text-[16px] shrink-0 ${d.ok ? "text-success" : "text-error"}">${d.ok ? "check_circle" : "error"}</span>
        <span class="font-display truncate flex-1">${escapeHTML(d.config_name || "Unsaved draft")}</span>
        ${isLiveDeploy(d.id) ? LIVE_BADGE : ""}
        <span class="font-label text-[11px] text-on-surface-variant shrink-0">#${d.id}</span>
      </div>
      <div class="text-[12px] pl-6 text-on-surface-variant truncate">${escapeHTML(absTime(d.created_at))}</div>`;
    btn.addEventListener("click", () => selectDeploy(d.id));
    list.appendChild(btn);
  }
}

async function selectDeploy(id) {
  hist.selected = id;
  renderHistoryList();
  $("history-detail").innerHTML = `<div class="text-on-surface-variant text-[13px] p-8 text-center">Loading diff…</div>`;
  try {
    renderDeployDetail(await api("GET", `/api/deploys/${id}`));
  } catch (e) {
    $("history-detail").innerHTML = `<div class="text-error text-[13px] p-8 text-center">${escapeHTML(e.message)}</div>`;
  }
}

function renderDeployDetail(res) {
  const { deploy: d, base, diff } = res;
  const box = $("history-detail");

  const live = isLiveDeploy(d.id);

  const chip = d.ok
    ? `<span class="font-label text-[11px] text-success border border-success/50 rounded px-2 py-0.5">APPLIED</span>`
    : `<span class="font-label text-[11px] text-error border border-error/50 rounded px-2 py-0.5">FAILED</span>`;

  // A failed deploy is still diffed against the last *successful* one, so the
  // copy has to be conditional: nothing here was ever applied.
  const against = base
    ? (d.ok
        ? `Diff against deploy <b>#${base.id}</b> — the configuration it replaced (${escapeHTML(relTime(base.created_at))})`
        : `Compared with deploy <b>#${base.id}</b>, which stayed live — this apply was rejected and changed nothing`)
    : (d.ok
        ? `No earlier applied config — this is the first configuration Camer applied.`
        : `No earlier applied config, and this apply failed, so Camer had applied nothing at this point.`);

  const stats = diff.identical
    ? `<span class="text-on-surface-variant">${d.ok ? "identical to the previous applied config" : "would have made no changes"}</span>`
    : `<span class="text-success">+${diff.added}</span> <span class="text-error">−${diff.removed}</span>` +
      (diff.truncated ? ` <span class="text-on-surface-variant">(too large to diff precisely — shown as a full replacement)</span>` : "");

  const notApplied = d.ok ? "" :
    `<div class="text-[13px] mt-2 text-tertiary flex items-start gap-2">
       <span class="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">block</span>
       <span>Not applied — Caddy rejected this and kept the configuration it was already running.</span>
     </div>`;

  box.innerHTML = `
    <div class="p-4 border-b border-outline-variant bg-surface-container sticky top-0 z-10">
      <div class="flex items-center gap-3 flex-wrap">
        ${chip}
        ${live ? LIVE_BADGE : ""}
        <span class="font-display text-[16px] text-on-surface">${escapeHTML(d.config_name || "Unsaved draft")}</span>
        <span class="font-label text-[12px] text-on-surface-variant">#${d.id}</span>
        <span class="text-[13px] text-on-surface-variant">${escapeHTML(absTime(d.created_at))} · ${escapeHTML(relTime(d.created_at))}</span>
        <span class="ml-auto flex items-center gap-2">
          ${live ? "" : `<button id="btn-reapply" class="border border-outline-variant hover:border-primary text-on-surface-variant hover:text-primary font-medium py-1.5 px-3 rounded-lg transition-colors active:scale-95 duration-150 flex items-center gap-2 text-[13px]">
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">history_toggle_off</span> Re-apply
          </button>`}
          <button id="btn-restore" class="border border-outline-variant hover:border-primary text-on-surface-variant hover:text-primary font-medium py-1.5 px-3 rounded-lg transition-colors active:scale-95 duration-150 flex items-center gap-2 text-[13px]">
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">restore</span> Load into editor
          </button>
        </span>
      </div>
      <div class="text-[12px] text-on-surface-variant font-code mt-2 break-all">${escapeHTML(d.endpoint || "http://localhost:2019")}</div>
      <div class="text-[13px] mt-1 ${d.ok ? "text-on-surface-variant" : "text-error"} whitespace-pre-wrap break-words">${escapeHTML(d.message)}</div>
      ${notApplied}
      <div class="text-[13px] mt-3 pt-3 border-t border-outline-variant flex items-center gap-3 flex-wrap">
        <span class="text-on-surface-variant">${against}</span>
        <span class="font-code">${stats}</span>
      </div>
    </div>
    <div id="diff-body" class="font-code text-[13px] leading-[1.6] py-2"></div>`;

  $("btn-restore").addEventListener("click", () => restoreDeploy(d));
  if (!live) $("btn-reapply").addEventListener("click", () => reapplyDeploy(d));

  renderDiff(diff, $("diff-body"), {
    identicalMessage: d.ok
      ? "No changes — this apply re-sent the same Caddyfile."
      : "No changes — this would not have altered the running configuration, and it was never applied.",
  });
}

// renderDiff draws a diff into body. Shared by the deploy history and the
// pre-apply confirmation, which need different copy for the no-change case.
function renderDiff(diff, body, { identicalMessage } = {}) {
  if (diff.identical) {
    body.innerHTML = `<div class="text-on-surface-variant text-[13px] font-body p-8 text-center">${escapeHTML(identicalMessage || "No changes.")}</div>`;
    return;
  }
  const rows = [];
  for (const h of diff.hunks) {
    rows.push(`<div class="d-hunk">@@ -${h.old_start || 0},${h.old_lines} +${h.new_start || 0},${h.new_lines} @@</div>`);
    for (const l of h.lines) {
      const cls = l.op === "+" ? "d-add" : l.op === "-" ? "d-del" : "d-ctx";
      rows.push(`<div class="d-row ${cls}"><span class="d-num">${l.old || ""}</span><span class="d-num">${l.new || ""}</span><span class="d-text">${escapeHTML(l.op + l.text)}</span></div>`);
    }
  }
  body.innerHTML = rows.join("");
}

// restoreDeploy puts a historical Caddyfile back in the editor. It stays
// attached to its source config when that config still exists, so saving
// updates the same draft rather than creating a stray copy.
function restoreDeploy(d) {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  const cfg = d.config_id ? state.configs.find((c) => c.id === d.config_id) : null;
  loadIntoEditor(cfg ? cfg.id : null, cfg ? cfg.name : "", cfg ? cfg.content : "");
  if (!cfg) $("config-name").value = d.config_name || "";
  editor.setValue(d.content);

  // Remember the provenance: saving from here would overwrite the draft's own
  // content, and the user deserves to know that before pressing Ctrl+S.
  const wouldOverwrite = !!cfg && cfg.content !== d.content;
  state.restoredFrom = { deployId: d.id, configName: cfg ? cfg.name : null, wouldOverwrite };

  refreshState();
  closeHistory();
  scheduleAdapt(true);
  if (wouldOverwrite) {
    toast(`Loaded deploy #${d.id}. The saved draft “${cfg.name}” holds different content — saving will ask before overwriting it.`, "info");
  } else {
    toast(`Loaded deploy #${d.id} into the editor.`, "success");
  }
}

// ---- what is live ----
// fetchLatest returns the last successful deploy (with its source config when it
// still exists), or null when nothing has ever been applied.
async function fetchLatest() {
  try {
    return await api("GET", "/api/deploys/latest");
  } catch (e) {
    if (e.status !== 404) throw e;
    return null;
  }
}

// refreshLive re-reads what Caddy is running so the state badge cannot drift from
// the server's own record of it.
async function refreshLive() {
  try {
    const res = await fetchLatest();
    state.live = res
      ? { id: res.deploy.id, configId: res.deploy.config_id ?? null,
          content: res.deploy.content, created_at: res.deploy.created_at }
      : null;
  } catch {
    // Leave the previous value; a failed refresh is not evidence of a change.
  }
}

// ---- boot: start from what is actually running ----
async function openLastApplied() {
  let res;
  try {
    res = await fetchLatest();
  } catch (e) {
    toast("Could not load the last applied config: " + e.message, "error");
    loadIntoEditor(null, "", STARTER);
    return;
  }
  if (!res) {
    loadIntoEditor(null, "", STARTER);
    return;
  }
  const d = res.deploy;
  state.live = { id: d.id, configId: d.config_id ?? null, content: d.content, created_at: d.created_at };
  // Only adopt the recorded endpoint when the browser has no preference.
  if (!localStorage.getItem("camer.endpoint") && d.endpoint) $("endpoint").value = d.endpoint;

  if (res.config) {
    loadIntoEditor(res.config.id, res.config.name, res.config.content);
    if (res.drifted) {
      toast(`Opened “${res.config.name}”. Its saved draft differs from what was applied ${relTime(d.created_at)} — see Deploy History.`, "info");
    } else {
      toast(`Opened “${res.config.name}” — applied ${relTime(d.created_at)}.`, "info");
    }
  } else {
    // The deploy came from an unsaved draft, or its config was since deleted.
    loadIntoEditor(null, "", d.content);
    toast(`Loaded the Caddyfile applied ${relTime(d.created_at)} (no saved draft).`, "info");
  }
}

// ---- keyboard shortcuts ----
// Ctrl+S was previously documented only in the README, and the primary action
// had no shortcut at all.
const SHORTCUTS = [
  ["Ctrl / ⌘ + S", "Save the current draft"],
  ["Ctrl / ⌘ + Enter", "Open the apply confirmation"],
  ["Tab", "Jump to the next placeholder in an inserted pattern"],
  ["Enter  ·  {", "Auto-indent a new block · auto-close the brace"],
  ["Enter / Shift + Enter", "Next / previous match, while the JSON find box has focus"],
  ["← →", "Resize the split, when the divider has focus"],
  ["Esc", "Close a dialog, the pattern menu, or the drawer"],
  ["?", "Show this list"],
];

function renderShortcuts() {
  $("shortcuts-list").innerHTML = SHORTCUTS.map(([keys, what]) =>
    `<dt class="font-label text-[11px] text-primary whitespace-nowrap">${escapeHTML(keys)}</dt>` +
    `<dd class="text-on-surface-variant">${escapeHTML(what)}</dd>`
  ).join("");
}

function openShortcuts() {
  openDialog($("shortcuts-modal"), { onCancel: closeShortcuts, initialFocus: $("shortcuts-close") });
}
function closeShortcuts() { closeDialog($("shortcuts-modal")); }

// typingInto reports whether keystrokes belong to a field rather than the app, so
// bare-key shortcuts like "?" never eat a character the user meant to type.
function typingInto(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return !!target.closest(".cm-editor");
}

// ---- resizable split ----
// Only meaningful on the wide layout; below the breakpoint the panes stack and
// take turns, so the handle is hidden and this does nothing.
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

function wideLayout() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function applySplit(pct) {
  const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct));
  // The inline basis must be cleared on the stacked layout: #workspace becomes
  // flex-direction:column there, where flex-basis sizes HEIGHT — so leaving a
  // width fraction behind would squash the panes vertically.
  $("pane-editor").style.flex = wideLayout() ? `0 0 calc(${clamped}% - 1.5rem)` : "";
  $("connector").setAttribute("aria-valuenow", String(Math.round(clamped)));
  localStorage.setItem("camer.split", String(clamped));
  editor.refresh();
  return clamped;
}

function loadSplit() {
  applySplit(currentSplit());
}

function currentSplit() {
  const saved = parseFloat(localStorage.getItem("camer.split"));
  return isNaN(saved) ? 50 : saved;
}

function initSplitter() {
  const handle = $("connector");
  handle.setAttribute("aria-valuemin", String(SPLIT_MIN));
  handle.setAttribute("aria-valuemax", String(SPLIT_MAX));

  let dragging = false;
  const move = (e) => {
    if (!dragging) return;
    const box = $("workspace").getBoundingClientRect();
    applySplit(((e.clientX - box.left) / box.width) * 100);
    e.preventDefault();
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  handle.addEventListener("mousedown", (e) => {
    if (!wideLayout()) return;
    dragging = true;
    // Without this, dragging selects text across both panes.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);

  // Crossing the breakpoint has to re-evaluate the inline basis in both
  // directions: restore it on the way to wide, clear it on the way to stacked.
  window.matchMedia("(min-width: 1024px)").addEventListener("change", () => {
    applySplit(currentSplit());
    setPane(document.body.dataset.pane || "editor");
  });

  handle.addEventListener("dblclick", () => { if (wideLayout()) applySplit(50); });
  handle.addEventListener("keydown", (e) => {
    if (!wideLayout()) return;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") { applySplit(currentSplit() - step); e.preventDefault(); }
    else if (e.key === "ArrowRight") { applySplit(currentSplit() + step); e.preventDefault(); }
    else if (e.key === "Home") { applySplit(50); e.preventDefault(); }
  });
}

// ---- JSON tools wiring ----
function initJSONTools() {
  const find = $("json-find");
  let findTimer = null;
  find.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runJSONFind(find.value.trim()), 150);
  });
  find.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (jsonView.hits.length) gotoHit(jsonView.hitIndex + (e.shiftKey ? -1 : 1));
  });
  $("json-find-next").addEventListener("click", () => gotoHit(jsonView.hitIndex + 1));
  $("json-find-prev").addEventListener("click", () => gotoHit(jsonView.hitIndex - 1));

  $("json-collapse").addEventListener("click", () => {
    jsonView.folded = new Set(jsonView.closeOf.flatMap((c, i) => (c > i ? [i] : [])));
    applyFolds();
  });
  $("json-expand").addEventListener("click", () => { jsonView.folded.clear(); applyFolds(); });

  $("json-wrap").addEventListener("click", () => {
    const on = $("json-preview").classList.toggle("wrap");
    $("json-wrap").setAttribute("aria-pressed", on ? "true" : "false");
    $("json-wrap").classList.toggle("text-primary", on);
    localStorage.setItem("camer.wrap", on ? "1" : "0");
  });
  if (localStorage.getItem("camer.wrap") === "1") $("json-wrap").click();

  // One delegated listener rather than one per line.
  $("json-preview").addEventListener("click", (e) => {
    const fold = e.target.closest(".jl-fold, .jl-ellipsis");
    if (!fold) return;
    const row = fold.closest(".jl");
    if (row) toggleFold(Number(row.dataset.i));
  });
}

// ---- responsive shell (drawer + pane tabs) ----
// Below the lg breakpoint the sidebar is a drawer and the two panes take turns;
// all of the styling for that lives in one media query in index.html, so this is
// only the state it needs.
function setDrawer(open) {
  document.body.dataset.drawer = open ? "open" : "closed";
  $("btn-drawer").setAttribute("aria-expanded", open ? "true" : "false");
}

function setPane(which) {
  document.body.dataset.pane = which;
  for (const [id, name] of [["tab-editor", "editor"], ["tab-json", "json"]]) {
    const on = name === which;
    $(id).setAttribute("aria-selected", on ? "true" : "false");
    $(id).className = "flex-1 border rounded-lg py-2 text-[13px] font-medium transition-colors " +
      (on ? "border-primary text-primary bg-primary/10"
          : "border-outline-variant text-on-surface-variant hover:text-on-surface");
  }
  // CodeMirror measures nothing while display:none, so it comes back blank
  // without this.
  if (which === "editor") editor.refresh();
}

// ---- wiring ----
editor.onChange(() => { clearApplyFailure(); refreshState(); scheduleAdapt(false); });
$("config-name").addEventListener("input", () => { clearApplyFailure(); refreshState(); });
$("btn-drawer").addEventListener("click", () => setDrawer(document.body.dataset.drawer !== "open"));
$("drawer-backdrop").addEventListener("click", () => setDrawer(false));
$("tab-editor").addEventListener("click", () => setPane("editor"));
$("tab-json").addEventListener("click", () => setPane("json"));
$("config-filter").addEventListener("input", renderConfigList);
$("btn-history-more").addEventListener("click", () => loadHistory(true));
for (const m of PREVIEW_MODES) $("mode-" + m).addEventListener("click", () => setPreviewMode(m));
$("btn-new").addEventListener("click", newConfig);
$("btn-save").addEventListener("click", saveConfig);
$("btn-delete").addEventListener("click", deleteConfig);
$("btn-submit").addEventListener("click", applyConfig);
$("btn-fetch").addEventListener("click", pullCurrent);
$("btn-copy").addEventListener("click", copyJSON);
$("btn-refresh-list").addEventListener("click", loadConfigList);
$("btn-history").addEventListener("click", openHistory);
$("btn-history-close").addEventListener("click", closeHistory);
$("btn-shortcuts").addEventListener("click", openShortcuts);
$("shortcuts-close").addEventListener("click", closeShortcuts);
$("shortcuts-modal").addEventListener("click", (e) => { if (e.target === $("shortcuts-modal")) closeShortcuts(); });
$("history-modal").addEventListener("click", (e) => { if (e.target === $("history-modal")) closeHistory(); });
$("btn-patterns").addEventListener("click", (e) => { e.stopPropagation(); togglePatterns(); });
// Close the patterns menu on outside click or Escape.
document.addEventListener("click", (e) => {
  if (!$("patterns-menu").classList.contains("hidden") &&
      !$("patterns-menu").contains(e.target) && e.target !== $("btn-patterns")) {
    closePatterns();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // A dialog on the stack owns Escape, so dismissing the apply confirmation does
  // not also close whatever is behind it.
  const top = topDialog();
  if (top) {
    e.stopPropagation();
    if (top.onCancel) top.onCancel();
    else closeDialog(top.el);
    return;
  }
  // The history modal is a stacked dialog now, so it was handled above.
  closePatterns();
  setDrawer(false);
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === "s") { e.preventDefault(); saveConfig(); }
    // Enter reaches the confirmation, never the server directly.
    else if (e.key === "Enter" && !topDialog()) { e.preventDefault(); applyConfig(); }
    return;
  }
  // Bare "?" only when it is not part of something being typed.
  if (e.key === "?" && !typingInto(e.target) && !topDialog()) {
    e.preventDefault();
    openShortcuts();
  }
});
window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---- boot ----
(async function boot() {
  loadEndpoint();
  renderPatterns();
  renderShortcuts();
  initSplitter();
  initJSONTools();
  loadSplit();
  setDrawer(false);
  setPane("editor");
  setPreviewMode("adapted");
  probeEndpoint(); // not awaited: reachability must not delay first paint
  await loadConfigList();
  // Start from the configuration that is live, not from a sample.
  await openLastApplied();
  refreshState();
  scheduleAdapt(true);
})();
