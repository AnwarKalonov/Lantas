import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { monacoLanguage } from "../lib/ide";

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
    { token: "comment", foreground: "6f6d66", fontStyle: "italic" },
    { token: "keyword", foreground: "c9b48f" },
    { token: "string", foreground: "a8c39a" },
    { token: "number", foreground: "d2a98a" },
    { token: "type", foreground: "9dbbc9" },
    { token: "function", foreground: "d8d5cb" },
    { token: "variable", foreground: "d6d3c9" },
    { token: "tag", foreground: "c9b48f" },
    { token: "attribute.name", foreground: "9dbbc9" },
  ],
  colors: {
    "editor.background": "#0e0e0d",
    "editor.foreground": "#d8d5cb",
    "editorLineNumber.foreground": "#4a4842",
    "editorLineNumber.activeForeground": "#b3b1a9",
    "editorCursor.foreground": "#e4e1d6",
    "editor.selectionBackground": "#2c2b27",
    "editor.inactiveSelectionBackground": "#232320",
    "editor.lineHighlightBackground": "#151513",
    "editorLineNumber.background": "#0e0e0d",
    "editorGutter.background": "#0e0e0d",
    "editorIndentGuide.background1": "#1d1d1a",
    "editorIndentGuide.activeBackground1": "#2f2f2a",
    "editorWidget.background": "#171716",
    "editorWidget.border": "#2a2a26",
    "input.background": "#111110",
    "input.border": "#2a2a26",
    "list.hoverBackground": "#1b1b18",
    "list.activeSelectionBackground": "#242420",
    "scrollbarSlider.background": "#2a2a2666",
    "scrollbarSlider.hoverBackground": "#3a3a3566",
    "minimap.background": "#0e0e0d",
  },
});

monaco.editor.defineTheme("lantas-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8a877c", fontStyle: "italic" },
    { token: "keyword", foreground: "8a6a33" },
    { token: "string", foreground: "3f6b45" },
    { token: "number", foreground: "915a35" },
    { token: "type", foreground: "356173" },
  ],
  colors: {
    "editor.background": "#fbfaf6",
    "editor.foreground": "#2b2924",
    "editorLineNumber.foreground": "#b3b0a5",
    "editorLineNumber.activeForeground": "#55534b",
    "editor.lineHighlightBackground": "#f4f2ea",
    "editorGutter.background": "#fbfaf6",
  },
});

interface MonacoEditorProps {
  path: string;
  value: string;
  theme: "dark" | "light";
  initialLine?: number;
  onChange: (value: string) => void;
  onSave: () => void;
  onCursor: (line: number, column: number) => void;
}

export function MonacoEditor({
  path,
  value,
  theme,
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
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 21,
      fontLigatures: false,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 90 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "all",
      padding: { top: 12, bottom: 24 },
      tabSize: 2,
      wordWrap: "off",
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

  return <div className="ide-monaco" ref={host} />;
}
