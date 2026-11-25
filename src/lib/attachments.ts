import type { Attachment } from "./types";
import { uid } from "./util";
import { fileKind } from "./workspace";

const IMAGE_LIMIT = 4_000_000;
const TEXT_LIMIT = 400_000;

export interface ReadAttachments {
  files: Attachment[];
  rejected: string[];
}

/**
 * One reader for every composer: the main one, the Code assistant and the
 * browser assistant. Images become data URLs the model can see, text files
 * become their contents, anything else is named so the reply can say what it
 * could not read.
 */
export async function readAttachments(
  list: FileList | File[] | null,
): Promise<ReadAttachments> {
  const files: Attachment[] = [];
  const rejected: string[] = [];
  if (!list) return { files, rejected };

  for (const file of Array.from(list)) {
    const kind = fileKind(file.name);
    if (kind === "image") {
      if (file.size > IMAGE_LIMIT) {
        rejected.push(`${file.name} is larger than 4 MB`);
        continue;
      }
      const body = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(file);
      });
      files.push({ id: uid("att"), name: file.name, size: file.size, kind: "image", body });
    } else if (kind === "text") {
      files.push({
        id: uid("att"),
        name: file.name,
        size: file.size,
        kind: "text",
        body: (await file.text()).slice(0, TEXT_LIMIT),
      });
    } else {
      files.push({ id: uid("att"), name: file.name, size: file.size, kind: "other", body: "" });
    }
  }

  return { files, rejected };
}
