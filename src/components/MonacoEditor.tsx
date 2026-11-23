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
    { token: "comment", foreground: "6a9955", fontStyle: "italic" },
    { token: "keyword", foreground: "569cd6" },
    { token: "string", foreground: "ce9178" },
    { token: "number", foreground: "b5cea8" },
    { token: "type", foreground: "4ec9b0" },
    { token: "function", foreground: "dcdcaa" },
    { token: "variable", foreground: "9cdcfe" },
    { token: "tag", foreground: "569cd6" },
    { token: "attribute.name", foreground: "9cdcfe" },
    { token: "delimiter", foreground: "d4d4d4" },
  ],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editorCursor.foreground": "#aeafad",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#3a3d41",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editorLineNumber.background": "#1e1e1e",
    "editorGutter.background": "#1e1e1e",
    "editorIndentGuide.background1": "#404040",
    "editorIndentGuide.activeBackground1": "#707070",
    "editorWidget.background": "#252526",
    "editorWidget.border": "#454545",
    "input.background": "#3c3c3c",
    "input.border": "#3c3c3c",
    "list.hoverBackground": "#2a2d2e",
    "list.activeSelectionBackground": "#094771",
    "scrollbarSlider.background": "#79797966",
    "scrollbarSlider.hoverBackground": "#646464b3",
    "minimap.background": "#1e1e1e",
    "editorBracketMatch.background": "#0064001a",
    "editorBracketMatch.border": "#888888",
  },
});

monaco.editor.defineTheme("lantas-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "008000", fontStyle: "italic" },
    { token: "keyword", foreground: "0000ff" },
    { token: "string", foreground: "a31515" },
    { token: "number", foreground: "098658" },
    { token: "type", foreground: "267f99" },
    { token: "function", foreground: "795e26" },
    { token: "variable", foreground: "001080" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#333333",
    "editorLineNumber.foreground": "#237893",
    "editorLineNumber.activeForeground": "#0b216f",
    "editorCursor.foreground": "#333333",
    "editor.selectionBackground": "#add6ff",
    "editor.inactiveSelectionBackground": "#e5ebf1",
    "editor.lineHighlightBackground": "#f3f3f3",
    "editorGutter.background": "#ffffff",
    "editorWidget.background": "#f3f3f3",
    "editorWidget.border": "#c8c8c8",
    "input.background": "#ffffff",
    "input.border": "#cecece",
    "list.hoverBackground": "#e8e8e8",
    "list.activeSelectionBackground": "#0060c0",
    "minimap.background": "#ffffff",
  },
});

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
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const lastValue = useRef(value);
  const handlers = useRef({ onChange, onSave, onCursor });
  handlers.current = { onChange, onSave, onCursor };

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = monaco.editor.create(host.current, {
      value,
      language: monacoLanguage(path),
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
    const first = editor.getModel();
    if (first) models.current.set(path, first);

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
      models.current.forEach((model) => model.dispose());
      models.current.clear();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap models per file so undo history per tab survives a tab switch.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let model = models.current.get(path);
    if (!model) {
      model = monaco.editor.createModel(value, monacoLanguage(path));
      models.current.set(path, model);
    }
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
