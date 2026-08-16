"use strict";

// ---- Caddyfile syntax mode for CodeMirror (simple-mode addon) ----
CodeMirror.defineSimpleMode("caddyfile", {
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /"(?:[^\\"]|\\.)*"?/, token: "string" },
    // {block placeholders} and named matchers @name
    { regex: /\{[^}\s]*\}/, token: "variable-2" },
    { regex: /@[\w.-]+/, token: "variable-2" },
    // site address at the start of a line (before an opening brace)
    { regex: /^[^\s#{}][^\s{}]*(?=\s|\{|$)/, token: "def", sol: true },
    { regex: /\b\d+\b/, token: "number" },
    { regex: /[{}]/, token: "bracket" },
    // first word on an indented line is a directive
    { regex: /^\s+[a-zA-Z_][\w.]*/, token: "keyword", sol: true },
    { regex: /[a-zA-Z_][\w.]*/, token: "variable" },
  ],
  meta: { lineComment: "#" },
});

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
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
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

const editor = CodeMirror.fromTextArea($("editor"), {
  mode: "caddyfile",
  lineNumbers: true,
  theme: "default",
  styleActiveLine: true,
  lineWrapping: false,
  autofocus: true,
  indentUnit: 2,
  tabSize: 2,
});

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

async function selectConfig(id) {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  try {
    const c = await api("GET", `/api/configs/${id}`);
    state.currentId = c.id;
    state.savedContent = c.content;
    state.savedName = c.name;
    $("config-name").value = c.name;
    editor.setValue(c.content);
    editor.clearHistory();
    refreshDirty();
    renderConfigList();
    scheduleAdapt(true);
  } catch (e) {
    toast("Failed to open config: " + e.message, "error");
  }
}

function newConfig() {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  state.currentId = null;
  state.savedContent = "";
  state.savedName = "";
  $("config-name").value = "";
  editor.setValue(STARTER);
  editor.clearHistory();
  refreshDirty();
  renderConfigList();
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

// ---- common patterns menu ----
function renderPatterns() {
  const list = $("patterns-list");
  const patterns = window.CADDY_PATTERNS || [];
  list.innerHTML = "";
  for (const p of patterns) {
    const btn = document.createElement("button");
    btn.className = "w-full text-left px-3 py-2 rounded-lg hover:bg-surface-container-high transition-colors group";
    btn.title = p.code;
    btn.innerHTML = `<div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-primary shrink-0">bolt</span>
        <span class="font-display text-on-surface truncate">${escapeHTML(p.name)}</span>
      </div>
      <div class="text-on-surface-variant text-[12px] font-body pl-6 truncate">${escapeHTML(p.desc || "")}</div>`;
    btn.addEventListener("click", () => { insertPattern(p.code); closePatterns(); });
    list.appendChild(btn);
  }
}

function insertPattern(code) {
  const doc = editor.getDoc();
  const cur = doc.getCursor();
  // Separate the snippet from any preceding, non-blank content with a blank line.
  let prefix = "";
  if (cur.line > 0 || cur.ch > 0) {
    const before = doc.getRange({ line: 0, ch: 0 }, cur);
    if (before.length && !before.endsWith("\n\n")) {
      prefix = before.endsWith("\n") ? "\n" : "\n\n";
    }
  }
  const snippet = prefix + code;
  doc.replaceRange(snippet, cur);
  // Move the cursor to just past the inserted text and focus the editor.
  const end = doc.posFromIndex(doc.indexFromPos(cur) + snippet.length);
  doc.setCursor(end);
  editor.focus();
  refreshDirty();
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
$("btn-patterns").addEventListener("click", (e) => { e.stopPropagation(); togglePatterns(); });
// Close the patterns menu on outside click or Escape.
document.addEventListener("click", (e) => {
  if (!$("patterns-menu").classList.contains("hidden") &&
      !$("patterns-menu").contains(e.target) && e.target !== $("btn-patterns")) {
    closePatterns();
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePatterns(); });

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveConfig(); }
});
window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---- boot ----
loadEndpoint();
renderPatterns();
editor.setValue(STARTER);
editor.clearHistory();
loadConfigList();
scheduleAdapt(true);
