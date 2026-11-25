import { strToU8, zipSync } from "fflate";

/**
 * Files the assistant can hand back to the user.
 *
 * The model has no filesystem of its own, so "make me a zip / a pdf / a csv"
 * used to end as a code block. Here the bytes are built in the renderer, kept
 * in memory for the session and saved the moment the user presses Download:
 * the desktop build opens the native save dialog, the browser build uses a
 * blob download. Nothing is written to the workspace unless the user saves it.
 */

export type ArtifactFormat =
  | "txt"
  | "md"
  | "csv"
  | "json"
  | "html"
  | "svg"
  | "pdf"
  | "zip";

export const ARTIFACT_FORMATS: ArtifactFormat[] = [
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "svg",
  "pdf",
  "zip",
];

const MIME: Record<ArtifactFormat, string> = {
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
  html: "text/html;charset=utf-8",
  svg: "image/svg+xml;charset=utf-8",
  pdf: "application/pdf",
  zip: "application/zip",
};

const EXTENSION: Record<string, ArtifactFormat> = {
  txt: "txt",
  text: "txt",
  log: "txt",
  md: "md",
  markdown: "md",
  csv: "csv",
  tsv: "csv",
  json: "json",
  html: "html",
  htm: "html",
  svg: "svg",
  pdf: "pdf",
  zip: "zip",
};

export interface ArtifactEntry {
  name: string;
  content: string;
}

export interface BuiltArtifact {
  filename: string;
  format: ArtifactFormat;
  mime: string;
  bytes: Uint8Array;
}

/** `report.PDF` -> `pdf`; unknown extensions fall back to text. */
export function detectFormat(filename: string): ArtifactFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1]?.toLowerCase() ?? "";
  return EXTENSION[ext] ?? "txt";
}

function sanitizeName(name: string, fallback: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 96);
  return clean || fallback;
}

/* ------------------------------------------------------------------ PDF --- */

/** Helvetica only covers WinAnsi; common typography is folded, the rest is '?'. */
function asciiText(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "  ")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, maxChars: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      out.push(line);
      line = word;
    }
    while (line.length > maxChars) {
      out.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
  }
  out.push(line);
  return out;
}

interface PdfLine {
  text: string;
  size: number;
  font: "F1" | "F2";
  leading: number;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 62;

/**
 * A small, valid PDF 1.4 with Helvetica text and real page breaks. Enough for
 * reports, letters and exports; deliberately not a layout engine.
 */
export function pdfFromText(title: string, body: string): Uint8Array {
  const lines: PdfLine[] = [];
  const heading = asciiText(title.trim()).slice(0, 120) || "Document";
  for (const part of wrapLine(heading, 46)) {
    lines.push({ text: part, size: 19, font: "F2", leading: 26 });
  }
  lines.push({ text: "", size: 11, font: "F1", leading: 16 });

  for (const paragraph of asciiText(body).replace(/\r\n?/g, "\n").split("\n")) {
    for (const part of wrapLine(paragraph, 92)) {
      lines.push({ text: part, size: 11, font: "F1", leading: 15.5 });
    }
  }

  const pages: string[] = [];
  const usable = PAGE_H - MARGIN * 2;
  let cursor = 0;
  while (cursor < lines.length || pages.length === 0) {
    let used = 0;
    const page: string[] = [];
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (used + line.leading > usable && page.length > 0) break;
      used += line.leading;
      page.push(
        `BT /${line.font} ${line.size} Tf ${MARGIN} ${PAGE_H - MARGIN - used + line.size * 0.35} Td (${escapePdf(
          line.text,
        )}) Tj ET`,
      );
      cursor += 1;
    }
    pages.push(page.join("\n"));
  }

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  pages.forEach((stream, index) => {
    const contentId = 6 + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${strToU8(stream).length} >>\nstream\n${stream}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(strToU8(out).length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = strToU8(out).length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return strToU8(out);
}

/* ------------------------------------------------------------- Building --- */

export function buildArtifact(input: {
  name: string;
  format?: string;
  content?: string;
  files?: ArtifactEntry[];
}): BuiltArtifact {
  const rawName = sanitizeName(input.name || "", "download");
  const requested = input.format?.trim().toLowerCase();
  const format: ArtifactFormat =
    requested && (ARTIFACT_FORMATS as string[]).includes(requested)
      ? (requested as ArtifactFormat)
      : detectFormat(rawName);

  const hasExt = /\.[a-z0-9]+$/i.test(rawName);
  const filename = hasExt ? rawName : `${rawName}.${format}`;
  const content = input.content ?? "";
  const entries = (input.files ?? []).filter((file) => file && file.name);
  const stem = filename.replace(/\.[a-z0-9]+$/i, "");

  if (format === "zip") {
    const used = new Set<string>();
    const archive: Record<string, Uint8Array> = {};
    const list = entries.length > 0 ? entries : [{ name: `${stem}.txt`, content }];
    list.forEach((file, index) => {
      let name = sanitizeName(file.name, `file-${index + 1}.txt`);
      if (!/\.[a-z0-9]+$/i.test(name)) name += ".txt";
      let unique = name;
      let n = 2;
      while (used.has(unique)) {
        unique = name.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
        n += 1;
      }
      used.add(unique);
      archive[unique] = strToU8(file.content ?? "");
    });
    return { filename, format, mime: MIME.zip, bytes: zipSync(archive, { level: 6 }) };
  }

  if (format === "pdf") {
    return { filename, format, mime: MIME.pdf, bytes: pdfFromText(stem, content) };
  }

  return { filename, format, mime: MIME[format], bytes: strToU8(content) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------- Registry --- */

interface Held {
  blob: Blob;
  filename: string;
  format: ArtifactFormat;
  bytes: number;
}

const held = new Map<string, Held>();

/** Keep the bytes for this session and return the id the transcript renders. */
export function stashArtifact(built: BuiltArtifact, existingId?: string): string {
  const id = existingId ?? `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  held.set(id, {
    // The Uint8Array is an ArrayBufferView, which Blob accepts directly.
    blob: new Blob([built.bytes as unknown as BlobPart], { type: built.mime }),
    filename: built.filename,
    format: built.format,
    bytes: built.bytes.length,
  });
  return id;
}

export function hasArtifact(id: string): boolean {
  return held.has(id);
}

export function artifactMeta(id: string): { filename: string; format: ArtifactFormat; bytes: number } | null {
  const item = held.get(id);
  return item ? { filename: item.filename, format: item.format, bytes: item.bytes } : null;
}

let cachedTauri: boolean | null = null;
async function isTauri(): Promise<boolean> {
  if (cachedTauri !== null) return cachedTauri;
  cachedTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  return cachedTauri;
}

/**
 * Save where the platform prefers: a native save dialog on desktop, the
 * browser's downloads folder otherwise. Returns "cancelled" when the user
 * closes the dialog, and "missing" when the session no longer holds the bytes.
 */
export async function saveArtifact(id: string): Promise<"saved" | "cancelled" | "missing"> {
  const item = held.get(id);
  if (!item) return "missing";

  if (await isTauri()) {
    try {
      const [{ save }, { writeFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const target = await save({ defaultPath: item.filename });
      if (!target) return "cancelled";
      await writeFile(target, new Uint8Array(await item.blob.arrayBuffer()));
      return "saved";
    } catch {
      // Fall through to the browser path so a missing dialog plugin still saves.
    }
  }

  const url = URL.createObjectURL(item.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = item.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
