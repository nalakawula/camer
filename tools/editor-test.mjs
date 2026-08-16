// Headless check of the CodeMirror 6 integration: builds a real EditorView in
// jsdom from the vendored bundle plus the language/theme/adapter out of app.js,
// then exercises the behaviour CAM-31 and CAM-26 promise.
import {readFileSync} from "fs";
import {JSDOM} from "jsdom";
import {fileURLToPath} from "url";
import {dirname, join} from "path";

// Run from anywhere: resolve repo files relative to this script.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const dom = new JSDOM(`<!doctype html><body><div id="editor-host"></div></body>`,
  {pretendToBeVisual: true, runScripts: "outside-only"});
const {window} = dom;
for (const k of ["window","document","HTMLElement","Element","Node",
                 "Range","DOMParser","MutationObserver","getComputedStyle",
                 "requestAnimationFrame","cancelAnimationFrame","CSS"]) {
  // navigator is a getter-only global in Node, so skip it; CodeMirror only
  // consults it for platform quirks and tolerates the Node one.
  if (k in window) {
    try { globalThis[k] = window[k]; } catch { /* read-only global */ }
  }
}

// Load the vendored bundle the way a <script> tag would: window.eval puts the
// bundle's top-level `var CM` on the window, which a Function wrapper would not.
window.eval(read("web/vendor/codemirror.js"));
globalThis.CM = window.CM;
if (!CM) throw new Error("bundle did not define the CM global");

// Pull the language + theme + adapter straight out of app.js — no duplication,
// so this tests the shipped code.
const src = read("web/app.js");
const slice = src.slice(src.indexOf("// ---- Caddyfile language"), src.indexOf("// ---- tiny DOM helpers"));
const {caddyfileLanguage, createEditor} =
  new window.Function("CM", slice + "; return {caddyfileLanguage, createEditor};")(CM);

let bad = 0;
const check = (name, cond, extra="") => {
  if (!cond) { bad++; console.log("FAIL  " + name + (extra ? "  " + extra : "")); }
  else console.log("  ok  " + name);
};

const ed = createEditor(window.document.getElementById("editor-host"));
check("editor constructs against the vendored bundle", !!ed.view);

// ---- document round trip -------------------------------------------------
ed.setValue("example.com {\n\treverse_proxy localhost:8080\n}\n");
check("setValue / getValue round trip",
  ed.getValue() === "example.com {\n\treverse_proxy localhost:8080\n}\n");

let changes = 0;
ed.onChange(() => changes++);
ed.setValue("a.com {\n}\n");
check("replacing the document notifies (the v5 contract)", changes === 1, `changes=${changes}`);

// ---- syntax: the parser must actually classify tokens --------------------
ed.setValue('example.com {\n\troot * /var/www\n\t# note\n\trespond "hi {uri}"\n}\n');
const tree = CM.syntaxTree(ed.view.state);
const kinds = new Set();
tree.iterate({enter: n => { if (n.name && n.name !== "Document") kinds.add(n.name); }});
check("parser emits distinct token types", kinds.size >= 4, [...kinds].join(","));
check("site address is a definition, directives are keywords",
  [...kinds].some(k=>/definition/.test(k)) && kinds.has("keyword"), [...kinds].join(","));
check("comments and strings are recognised", kinds.has("comment") && kinds.has("string"));

// ---- CAM-31: indentation from the language ------------------------------
ed.setValue("example.com {\n\n}\n");
const insideBlock = CM.getIndentation(ed.view.state, ed.view.state.doc.line(2).from);
check("a line inside a block indents one unit", insideBlock === 2, `got ${insideBlock}`);
ed.setValue("example.com {\n\thandle {\n\n\t}\n}\n");
const nested = CM.getIndentation(ed.view.state, ed.view.state.doc.line(3).from);
check("a nested block indents two units", nested === 4, `got ${nested}`);
ed.setValue("example.com {\n\thandle {\n\t\tx\n}\n");
const closer = CM.getIndentation(ed.view.state, ed.view.state.doc.line(4).from);
check("a closing brace dedents", closer === 2, `got ${closer}`);

// ---- CAM-31: bracket matching -------------------------------------------
ed.setValue('example.com {\n\trespond "}"\n}\n');
// matchBrackets wants dir > 0 when pos sits on an opening bracket.
const openAt = ed.getValue().indexOf("{");
const m = CM.matchBrackets(ed.view.state, openAt, 1);
check("bracket matching finds the partner", m && m.matched, JSON.stringify(m));
const closeAt = ed.getValue().lastIndexOf("}");
const stringBraceAt = ed.getValue().indexOf('"}"') + 1;
check("the partner is the real closer, not the brace inside the string",
  m && m.end && m.end.from === closeAt,
  `partner at ${m && m.end && m.end.from}, real closer ${closeAt}, string brace ${stringBraceAt}`);
// This only works because the parser tags braces as brackets and string bodies
// as strings: matchPlainBrackets skips candidates of a different token type.
check("the string brace really is a different token type",
  CM.syntaxTree(ed.view.state).resolveInner(stringBraceAt, 1).type !==
  CM.syntaxTree(ed.view.state).resolveInner(openAt, 1).type);

// ---- CAM-26: snippet placeholders ---------------------------------------
ed.setValue("");
ed.insertSnippet("#{example.com} {\n\troot * #{/var/www}\n\tfile_server\n}\n");
const out = ed.getValue();
check("snippet inserts literal text, markers stripped",
  out.includes("example.com {") && out.includes("root * /var/www") && !out.includes("#{"),
  JSON.stringify(out));
check("snippet keeps tab indentation", out.includes("\troot * /var/www"), JSON.stringify(out));
const sel = ed.view.state.selection.main;
check("first placeholder is selected",
  ed.view.state.sliceDoc(sel.from, sel.to) === "example.com",
  JSON.stringify(ed.view.state.sliceDoc(sel.from, sel.to)));

// Tab must advance to the next field while a snippet is active.
CM.nextSnippetField({state: ed.view.state, dispatch: tr => ed.view.dispatch(tr)});
const sel2 = ed.view.state.selection.main;
check("Tab advances to the second placeholder",
  ed.view.state.sliceDoc(sel2.from, sel2.to) === "/var/www",
  JSON.stringify(ed.view.state.sliceDoc(sel2.from, sel2.to)));

// Linked fields: editing one occurrence should update all three.
ed.setValue("");
ed.insertSnippet("www.#{example.com} {\n\tredir https://#{example.com}{uri}\n}\n\n#{example.com} {\n}\n");
// Linked fields are one selection with several ranges, so typing edits them all.
check("a field repeated 3 times selects as 3 ranges",
  ed.view.state.selection.ranges.length === 3, `got ${ed.view.state.selection.ranges.length}`);
ed.view.dispatch(ed.view.state.replaceSelection("site.test"));
const linked = (ed.getValue().match(/site\.test/g) || []).length;
check("typing once fills every occurrence of the linked field", linked === 3, `got ${linked}`);
check("no placeholder markers remain", !ed.getValue().includes("#{"));

// ---- blank-line separation still holds ----------------------------------
ed.setValue("a.com {\n}\n");
ed.view.dispatch({selection: {anchor: ed.view.state.doc.length}});
ed.insertSnippet("#{b.com} {\n}\n");
check("a snippet is separated from earlier content by a blank line",
  /\}\n\nb\.com \{/.test(ed.getValue()), JSON.stringify(ed.getValue()));

console.log(bad ? `\n${bad} FAILED` : "\nCodeMirror 6 integration verified headlessly");
process.exit(bad ? 1 : 0);
