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
  lastJSON: "",        // last successful adapt output, for copy
  configs: [],
};

const editor = createEditor($("editor-host"));

const STARTER = `# Welcome to Camer. Edit this Caddyfile and watch the JSON preview update.
example.com {
\treverse_proxy localhost:8080

\tencode gzip zstd
}
`;

// ---- dirty tracking ----
function isDirty() {
  return editor.getValue() !== state.savedContent || $("config-name").value !== state.savedName;
}
function refreshDirty() {
  $("dirty-badge").classList.toggle("hidden", !isDirty());
}

// ---- endpoint persistence ----
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
  $("config-name").value = name;
  editor.setValue(content);
  editor.clearHistory();
  refreshDirty();
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
  const name = $("config-name").value.trim() || "Untitled Caddyfile";
  const content = editor.getValue();
  try {
    let c;
    if (state.currentId == null) {
      c = await api("POST", "/api/configs", { name, content });
      state.currentId = c.id;
    } else {
      c = await api("PUT", `/api/configs/${state.currentId}`, { name, content });
    }
    state.savedContent = c.content;
    state.savedName = c.name;
    $("config-name").value = c.name;
    refreshDirty();
    await loadConfigList();
    toast("Saved draft “" + c.name + "”", "success");
  } catch (e) {
    toast("Save failed: " + e.message, "error");
  }
}

async function deleteConfig() {
  if (state.currentId == null) { newConfig(); return; }
  if (!confirm("Delete this Caddyfile permanently?")) return;
  try {
    await api("DELETE", `/api/configs/${state.currentId}`);
    toast("Deleted", "success");
    state.currentId = null;
    await loadConfigList();
    newConfig();
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

async function runAdapt() {
  const caddyfile = editor.getValue();
  const endpoint = $("endpoint").value.trim();
  if (!caddyfile.trim()) {
    $("json-preview").innerHTML = "";
    $("warnings").classList.add("hidden");
    setPreviewStatus("empty", "text-on-surface-variant");
    state.lastJSON = "";
    return;
  }
  const seq = ++adaptSeq;
  setPreviewStatus("adapting…", "text-primary");
  $("sync-icon").classList.add("animate-spin");
  try {
    const res = await api("POST", "/api/adapt", { caddyfile, endpoint });
    if (seq !== adaptSeq) return; // a newer request superseded this one
    state.lastJSON = res.json;
    $("json-preview").innerHTML = highlightJSON(res.json);
    renderWarnings(res.warnings);
    setPreviewStatus("valid", "text-success");
  } catch (e) {
    if (seq !== adaptSeq) return;
    state.lastJSON = "";
    $("json-preview").innerHTML = `<span class="text-error">${escapeHTML(e.message)}</span>`;
    $("warnings").classList.add("hidden");
    setPreviewStatus("invalid", "text-error");
  } finally {
    if (seq === adaptSeq) $("sync-icon").classList.remove("animate-spin");
  }
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

async function pullCurrent() {
  const endpoint = $("endpoint").value.trim();
  setStatus("Fetching…", "bg-tertiary animate-pulse");
  try {
    const res = await api("POST", "/api/current", { endpoint });
    state.lastJSON = res.json;
    $("json-preview").innerHTML = highlightJSON(res.json);
    $("warnings").classList.add("hidden");
    setPreviewStatus("running config", "text-primary");
    setStatus("Ready", "bg-primary");
    toast("Loaded the running config from Caddy into the preview.", "success");
  } catch (e) {
    setStatus("Ready", "bg-primary");
    toast("Could not fetch current config: " + e.message, "error");
  }
}

async function copyJSON() {
  if (!state.lastJSON) { toast("No valid JSON to copy.", "error"); return; }
  try { await navigator.clipboard.writeText(state.lastJSON); toast("JSON copied to clipboard.", "success"); }
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
  refreshDirty();
  closeHistory();
  scheduleAdapt(true);
  toast(`Loaded deploy #${d.id} into the editor.`, "success");
}

// ---- boot: start from what is actually running ----
async function openLastApplied() {
  let res;
  try {
    res = await api("GET", "/api/deploys/latest");
  } catch (e) {
    if (e.status !== 404) toast("Could not load the last applied config: " + e.message, "error");
    loadIntoEditor(null, "", STARTER);
    return;
  }
  const d = res.deploy;
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
  scheduleAdapt(true);
})();
