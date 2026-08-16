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
  ".cm-scroller": { fontFamily: '"JetBrains Mono", monospace', lineHeight: "1.7", overflow: "auto" },
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
  const icon = kind === "success" ? "check_circle" : kind === "error" ? "error" : "info";
  el.innerHTML = `<span class="material-symbols-outlined text-[18px] shrink-0">${icon}</span><span class="whitespace-pre-wrap break-words">${escapeHTML(message)}</span>`;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, kind === "error" ? 7000 : 3500);
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
$("endpoint").addEventListener("change", () => localStorage.setItem("camer.endpoint", $("endpoint").value.trim()));

// ---- config list (sidebar) ----
async function loadConfigList() {
  try {
    state.configs = await api("GET", "/api/configs");
    renderConfigList();
  } catch (e) {
    toast("Could not load configs: " + e.message, "error");
  }
}

function renderConfigList() {
  const box = $("config-list");
  box.innerHTML = "";
  if (state.configs.length === 0) {
    box.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">No saved configs yet.<br>Create one to get started.</div>`;
    return;
  }
  for (const c of state.configs) {
    const active = c.id === state.currentId;
    const a = document.createElement("button");
    a.className = `w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-95 duration-150 ${
      active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
    }`;
    a.innerHTML = `<span class="material-symbols-outlined text-[18px] shrink-0">description</span>
      <span class="font-display truncate flex-1">${escapeHTML(c.name)}</span>`;
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
    scheduleAdapt(true);
  } catch (e) {
    toast("Failed to open config: " + e.message, "error");
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
        <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-primary shrink-0">bolt</span>
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
    return `<div class="flex items-start gap-2 py-0.5"><span class="material-symbols-outlined text-[16px] shrink-0">warning</span><span>${dir}${escapeHTML(w.message)} ${loc ? `<span class="opacity-60">(${loc})</span>` : ""}</span></div>`;
  }).join("");
}

// ---- submit / load into Caddy ----
function setStatus(text, dotClass) {
  $("status-text").textContent = text;
  $("status-dot").className = "w-2 h-2 rounded-full block " + dotClass;
}

async function submitToCaddy() {
  const caddyfile = editor.getValue();
  const endpoint = $("endpoint").value.trim();
  if (!caddyfile.trim()) { toast("Nothing to submit — the editor is empty.", "error"); return; }
  const btn = $("btn-submit");
  btn.disabled = true;
  setStatus("Applying…", "bg-tertiary animate-pulse");
  try {
    await api("POST", "/api/load", { caddyfile, endpoint, config_id: state.currentId });
    setStatus("Applied", "bg-success");
    toast("Configuration applied to Caddy.", "success");
  } catch (e) {
    setStatus("Failed", "bg-error");
    toast("Apply failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
    setTimeout(() => setStatus("Ready", "bg-primary"), 4000);
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
const hist = { deploys: [], selected: null };

function openHistory() {
  $("history-modal").classList.remove("hidden");
  loadHistory();
}

function closeHistory() { $("history-modal").classList.add("hidden"); }

async function loadHistory() {
  const list = $("history-list");
  list.innerHTML = `<div class="text-on-surface-variant text-[13px] px-3 py-4 text-center">Loading…</div>`;
  try {
    hist.deploys = await api("GET", "/api/deploys?limit=100");
  } catch (e) {
    list.innerHTML = `<div class="text-error text-[13px] px-3 py-4 text-center">${escapeHTML(e.message)}</div>`;
    return;
  }
  renderHistoryList();
  if (hist.deploys.length) selectDeploy(hist.deploys[0].id);
  else $("history-detail").innerHTML = `<div class="text-on-surface-variant text-[13px] p-8 text-center">Nothing has been submitted to the admin API yet.</div>`;
}

function renderHistoryList() {
  const list = $("history-list");
  list.innerHTML = "";
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
    btn.innerHTML = `<div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[16px] shrink-0 ${d.ok ? "text-success" : "text-error"}">${d.ok ? "check_circle" : "error"}</span>
        <span class="font-display truncate flex-1">${escapeHTML(d.config_name || "Unsaved draft")}</span>
        <span class="font-label text-[11px] opacity-60 shrink-0">#${d.id}</span>
      </div>
      <div class="text-[12px] pl-6 opacity-70 truncate">${escapeHTML(absTime(d.created_at))}</div>`;
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

  const chip = d.ok
    ? `<span class="font-label text-[11px] text-success border border-success/50 rounded px-2 py-0.5">APPLIED</span>`
    : `<span class="font-label text-[11px] text-error border border-error/50 rounded px-2 py-0.5">FAILED</span>`;

  const against = base
    ? `Diff against deploy <b>#${base.id}</b> — ${escapeHTML(absTime(base.created_at))} (${escapeHTML(relTime(base.created_at))})`
    : `No earlier applied config — this is the first configuration Camer applied.`;

  const stats = diff.identical
    ? `<span class="text-on-surface-variant">identical to the previous applied config</span>`
    : `<span class="text-success">+${diff.added}</span> <span class="text-error">−${diff.removed}</span>` +
      (diff.truncated ? ` <span class="text-on-surface-variant">(too large to diff precisely — shown as a full replacement)</span>` : "");

  box.innerHTML = `
    <div class="p-4 border-b border-outline-variant bg-surface-container sticky top-0 z-10">
      <div class="flex items-center gap-3 flex-wrap">
        ${chip}
        <span class="font-display text-[16px] text-on-surface">${escapeHTML(d.config_name || "Unsaved draft")}</span>
        <span class="font-label text-[12px] text-on-surface-variant">#${d.id}</span>
        <span class="text-[13px] text-on-surface-variant">${escapeHTML(absTime(d.created_at))} · ${escapeHTML(relTime(d.created_at))}</span>
        <button id="btn-restore" class="ml-auto border border-outline-variant hover:border-primary text-on-surface-variant hover:text-primary font-medium py-1.5 px-3 rounded-lg transition-colors active:scale-95 duration-150 flex items-center gap-2 text-[13px]">
          <span class="material-symbols-outlined text-[16px]">restore</span> Load into editor
        </button>
      </div>
      <div class="text-[12px] text-on-surface-variant font-code mt-2 break-all">${escapeHTML(d.endpoint || "http://localhost:2019")}</div>
      <div class="text-[13px] mt-1 ${d.ok ? "text-on-surface-variant" : "text-error"} whitespace-pre-wrap break-words">${escapeHTML(d.message)}</div>
      <div class="text-[13px] mt-3 pt-3 border-t border-outline-variant flex items-center gap-3 flex-wrap">
        <span class="text-on-surface-variant">${against}</span>
        <span class="font-code">${stats}</span>
      </div>
    </div>
    <div id="diff-body" class="font-code text-[13px] leading-[1.6] py-2"></div>`;

  $("btn-restore").addEventListener("click", () => restoreDeploy(d));
  renderDiff(diff);
}

function renderDiff(diff) {
  const body = $("diff-body");
  if (diff.identical) {
    body.innerHTML = `<div class="text-on-surface-variant text-[13px] font-body p-8 text-center">No changes — this submit re-applied the same Caddyfile.</div>`;
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

// ---- wiring ----
editor.on("change", () => { refreshDirty(); scheduleAdapt(false); });
$("config-name").addEventListener("input", refreshDirty);
$("btn-new").addEventListener("click", newConfig);
$("btn-save").addEventListener("click", saveConfig);
$("btn-delete").addEventListener("click", deleteConfig);
$("btn-submit").addEventListener("click", submitToCaddy);
$("btn-fetch").addEventListener("click", pullCurrent);
$("btn-copy").addEventListener("click", copyJSON);
$("btn-refresh-list").addEventListener("click", loadConfigList);
$("btn-history").addEventListener("click", openHistory);
$("btn-history-close").addEventListener("click", closeHistory);
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
  closePatterns();
  closeHistory();
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveConfig(); }
});
window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---- boot ----
(async function boot() {
  loadEndpoint();
  renderPatterns();
  await loadConfigList();
  // Start from the configuration that is live, not from a sample.
  await openLastApplied();
  refreshState();
  scheduleAdapt(true);
})();
