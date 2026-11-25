def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        if new and new in s:
            continue
        if old not in s:
            raise SystemExit(f"MISS in {path}: {old[:80]!r}")
        s = s.replace(old, new, 1)
    open(path, "w").write(s)
    print("edited", path)


# ---------------- types ----------------
edit("src/lib/types.ts", [
    (
        'export type ToolKind = "read" | "grep" | "edit" | "terminal" | "plan" | "web";',
        'export type ToolKind = "read" | "grep" | "edit" | "terminal" | "plan" | "web" | "deliver";',
    ),
    (
        '  | { id: string; kind: "note"; text: string };',
        '''  | { id: string; kind: "note"; text: string }
  | {
      id: string;
      kind: "artifact";
      /** Key in the in-memory artifact registry, used by the Download button. */
      artifactId: string;
      name: string;
      format: string;
      bytes: number;
    };''',
    ),
])

# ---------------- icons ----------------
edit("src/components/Icons.tsx", [
    (
        '  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5H5v10" /></>,',
        '''  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5H5v10" /></>,
  download: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></>,
  doc: <><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /><path d="M8.5 13h7" /><path d="M8.5 16.5h5" /></>,''',
    ),
])

# ---------------- tools ----------------
edit("src/lib/tools.ts", [
    (
        'import type {',
        'import { buildArtifact, stashArtifact } from "./artifacts";\nimport type {',
    ),
    (
        '  /** Resource the permission engine should check. */\n  resource: string;\n}',
        '''  /** A finished file the transcript offers as a download. */
  artifact?: { id: string; name: string; format: string; bytes: number };
  /** Resource the permission engine should check. */
  resource: string;
}''',
    ),
    (
        '  "integrations",\n] as const;',
        '  "integrations",\n  "deliver",\n] as const;',
    ),
    (
        '  integrations: "Connected apps",\n};',
        '  integrations: "Connected apps",\n  deliver: "Deliver file",\n};',
    ),
    (
        '      case "read": {',
        '''      case "deliver": {
        const files = Array.isArray(call.args.files)
          ? (call.args.files as Array<{ name?: unknown; content?: unknown }>)
              .filter((file) => file && typeof file.name === "string")
              .map((file) => ({ name: String(file.name), content: String(file.content ?? "") }))
          : undefined;
        const built = buildArtifact({
          name: typeof call.args.name === "string" ? call.args.name : "",
          format: typeof call.args.format === "string" ? call.args.format : undefined,
          content: typeof call.args.content === "string" ? call.args.content : undefined,
          files,
        });
        const id = stashArtifact(built);
        return {
          ok: true,
          summary: `Delivered ${built.filename}`,
          content: [
            `Built ${built.filename} — ${built.format}, ${built.bytes.length} bytes.`,
            "It is attached to the conversation as a download card, so the user can save it with one click.",
            "Do not paste the file contents into your answer and do not ask for a path.",
            "Say what the file contains in one or two sentences, then stop.",
          ].join("\\n"),
          resource: built.filename,
          artifact: {
            id,
            name: built.filename,
            format: built.format,
            bytes: built.bytes.length,
          },
        };
      }

      case "read": {''',
    ),
])

# ---------------- prompt manual ----------------
edit("src/lib/chat.ts", [
    (
        '''  '- integrations {"action",...} — apps, tools {"toolkit"}, inbox {"limit","query"}, search_email {"query","limit"}, run {"slug","arguments"}.',''',
        '''  '- integrations {"action",...} — apps, tools {"toolkit"}, inbox {"limit","query"}, search_email {"query","limit"}, run {"slug","arguments"}.',
  '- deliver {"name","format?","content?","files?"} — build a file the user can download: txt, md, csv, json, html, svg, pdf, or zip (pass files: [{"name","content"}] for a zip). The format is inferred from the name when omitted. Use it for any "make me a …", "export", "write a report" or "bundle these files" request instead of pasting the whole thing into chat.',''',
    ),
    (
        '''  "- Finish with a short answer that states what you changed and what you verified. If you could not verify something, say so.",''',
        '''  "- You can create files: when the user asks for a document, spreadsheet, export or bundle, call deliver. Never reply that you cannot make files or downloads.",
  "- Finish with a short answer that states what you changed and what you verified. If you could not verify something, say so.",''',
    ),
])
