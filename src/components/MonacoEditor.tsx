import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { monacoLanguage } from "../lib/ide";
import type { EditorSettings } from "../lib/types";

/**
 * Monaco is VS Code's editor, so the IDE gets real syntax highlighting, real
 * bracket matching and real TypeScript services rather than a styled <pre>.
 * Workers are bundled by Vite; nothing is fetched at runtime.
 */
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

monaco.editor.defineTheme("lantas-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7f8f7a", fontStyle: "italic" },
    { token: "keyword", foreground: "c6a2b6" },
    { token: "string", foreground: "c99a72" },
    { token: "number", foreground: "cbb27a" },
    { token: "type", foreground: "89bdb8" },
    { token: "function", foreground: "e4e1d6" },
    { token: "variable", foreground: "b3b1a9" },
    { token: "tag", foreground: "c6a2b6" },
    { token: "attribute.name", foreground: "cbb27a" },
    { token: "delimiter", foreground: "83817a" },
  ],
  colors: {
    "editor.background": "#0b0b0a",
    "editor.foreground": "#d8d5cb",
    "editorLineNumber.foreground": "#5b5953",
    "editorLineNumber.activeForeground": "#b3b1a9",
    "editorCursor.foreground": "#e4e1d6",
    "editor.selectionBackground": "#2a2a26",
    "editor.inactiveSelectionBackground": "#1f1f1c",
    "editor.lineHighlightBackground": "#131312",
    "editorLineNumber.background": "#0b0b0a",
    "editorGutter.background": "#0b0b0a",
    "editorIndentGuide.background1": "#242420",
    "editorIndentGuide.activeBackground1": "#3b3a34",
    "editorWidget.background": "#161615",
    "editorWidget.border": "#2a2a26",
    "input.background": "#1c1c1a",
    "input.border": "#2a2a26",
    "list.hoverBackground": "#1c1c1a",
    "list.activeSelectionBackground": "#242420",
    "scrollbarSlider.background": "#79797944",
    "scrollbarSlider.hoverBackground": "#79797977",
    "minimap.background": "#0b0b0a",
    "editorBracketMatch.background": "#89bdb81a",
    "editorBracketMatch.border": "#83817a",
  },
});

monaco.editor.defineTheme("lantas-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7c66", fontStyle: "italic" },
    { token: "keyword", foreground: "8a5470" },
    { token: "string", foreground: "915a35" },
    { token: "number", foreground: "8a6a33" },
    { token: "type", foreground: "2f6b66" },
    { token: "function", foreground: "2b2924" },
    { token: "variable", foreground: "35332b" },
    { token: "tag", foreground: "8a5470" },
    { token: "attribute.name", foreground: "8a6a33" },
  ],
  colors: {
    "editor.background": "#fbfaf6",
    "editor.foreground": "#2b2924",
    "editorLineNumber.foreground": "#a19e94",
    "editorLineNumber.activeForeground": "#55534b",
    "editorCursor.foreground": "#22211c",
    "editor.selectionBackground": "#dcd8cb",
    "editor.inactiveSelectionBackground": "#eeece4",
    "editor.lineHighlightBackground": "#f1efe8",
    "editorGutter.background": "#fbfaf6",
    "editorWidget.background": "#ffffff",
    "editorWidget.border": "#cfccc1",
    "input.background": "#ffffff",
    "input.border": "#cfccc1",
    "list.hoverBackground": "#f1efe8",
    "list.activeSelectionBackground": "#e2ded2",
    "minimap.background": "#fbfaf6",
  },
});

// Files are opened as individual models, not as a TypeScript project, so the
// worker cannot resolve cross-file imports or React's ambient JSX types. Keep
// syntax and local type checking, but do not paint every import red.
const compilerOptions = {
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  skipLibCheck: true,
};
const diagnosticsOptions = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: [
    2307, // Cannot find module
    2792, // Cannot find module (node resolution)
    7016, // Could not find a declaration file
    2688, // Cannot find type definition file
    7026, // JSX element implicitly has type any
    17004, // Cannot use JSX unless the --jsx flag is provided
  ],
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);

/**
 * Models outlive the editor instance. Disposing them on unmount, which is what
 * this file used to do, threw away undo history and every unsaved buffer as
 * soon as the user left Code for chat and came back.
 */
const modelCache = new Map<string, monaco.editor.ITextModel>();

function ensureModel(path: string, value: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(`/${path}`);
  const cached = modelCache.get(path);
  if (cached && !cached.isDisposed()) return cached;
  const model =
    monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, monacoLanguage(path), uri);
  modelCache.set(path, model);
  return model;
}

interface MonacoEditorProps {
  path: string;
  value: string;
  theme: "dark" | "light";
  editor: EditorSettings;
  initialLine?: number;
  onChange: (value: string) => void;
  onSave: () => void;
  onCursor: (line: number, column: number) => void;
}

export function MonacoEditor({
  path,
  value,
  theme,
  editor: prefs,
  initialLine,
  onChange,
  onSave,
  onCursor,
}: MonacoEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lastValue = useRef(value);
  const handlers = useRef({ onChange, onSave, onCursor });
  handlers.current = { onChange, onSave, onCursor };

  useEffect(() => {
    if (!host.current) return undefined;
    // Give the model a real file URI so the TypeScript worker sees a `.tsx` or
    // `.jsx` extension and parses JSX and generic type arguments correctly.
    const model = ensureModel(path, value);
    const editor = monaco.editor.create(host.current, {
      model,
      theme: theme === "dark" ? "lantas-dark" : "lantas-light",
      automaticLayout: true,
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
      lineHeight: prefs.lineHeight,
      fontLigatures: false,
      minimap: { enabled: prefs.minimap, renderCharacters: false, maxColumn: 90 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "all",
      padding: { top: 12, bottom: 24 },
      tabSize: prefs.tabSize,
      wordWrap: prefs.wordWrap,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: false },
      renderWhitespace: "selection",
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;

    const change = editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      const next = model.getValue();
      lastValue.current = next;
      handlers.current.onChange(next);
    });
    const cursor = editor.onDidChangeCursorPosition((event) => {
      handlers.current.onCursor(event.position.lineNumber, event.position.column);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      handlers.current.onSave(),
    );

    return () => {
      change.dispose();
      cursor.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap models per file so undo history per tab survives a tab switch.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = ensureModel(path, value);
    if (editor.getModel() !== model) {
      editor.setModel(model);
      lastValue.current = model.getValue();
    }
    if (model.getValue() !== value && value !== lastValue.current) {
      model.setValue(value);
      lastValue.current = value;
    }
    if (model.getLanguageId() !== monacoLanguage(path)) {
      monaco.editor.setModelLanguage(model, monacoLanguage(path));
    }
    if (typeof initialLine === "number") {
      editor.revealLineInCenter(initialLine);
      editor.setPosition({ lineNumber: initialLine, column: 1 });
      editor.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, initialLine]);

  // Keep the model in sync when a save, discard or reload changes the text.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (model.getValue() !== value) {
      model.setValue(value);
      lastValue.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "lantas-dark" : "lantas-light");
  }, [theme]);

  // VS Code settings imported in the Extensions panel land here immediately.
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
      lineHeight: prefs.lineHeight,
      tabSize: prefs.tabSize,
      wordWrap: prefs.wordWrap,
      minimap: { enabled: prefs.minimap, renderCharacters: false, maxColumn: 90 },
    });
  }, [prefs]);

  return <div className="ide-monaco" ref={host} />;
}
