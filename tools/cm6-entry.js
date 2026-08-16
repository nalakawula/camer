// Bundle entry for the vendored CodeMirror 6.
//
// This re-exports only the pieces Camer uses, as a global `CM`. It is
// third-party code only — the Caddyfile language, theme and editor wiring live
// in web/app.js, so web/vendor/ stays a pure dependency drop.
//
// Build with `npm run build` in this directory; the output is committed, so
// neither Node nor npm is needed to build or run Camer.

export { EditorState, EditorSelection, Compartment, Prec } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, placeholder,
} from "@codemirror/view";
export {
  defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent,
} from "@codemirror/commands";
export {
  StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching,
  indentUnit, indentOnInput, foldGutter, foldKeymap, codeFolding,
  // Already inside the bundle (StreamLanguage, indentOnInput and
  // bracketMatching all depend on them); named here so the integration can be
  // exercised against this same module instance. A second copy imported from
  // node_modules would have different facet identities and silently misbehave.
  StringStream, syntaxTree, getIndentation, matchBrackets,
} from "@codemirror/language";
export {
  closeBrackets, closeBracketsKeymap, snippet, nextSnippetField,
  prevSnippetField, hasNextSnippetField, clearSnippet,
} from "@codemirror/autocomplete";
export { tags } from "@lezer/highlight";
