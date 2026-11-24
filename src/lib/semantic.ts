import type { WorkspaceFile } from "./types";

/**
 * Lightweight local code search for when the user knows what a thing does but
 * not what it is called. It is deliberately dependency-free: identifiers are
 * split into words, scored with TF-IDF, and the best line is returned as a
 * snippet. Everything happens in memory on the already-open workspace.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
  "this", "that", "it", "is", "are", "be", "as", "at", "by", "from", "how",
  "what", "where", "which", "when", "i", "we", "you", "my", "our", "me",
  "function", "code", "file", "please", "find", "show", "thing", "handles",
  "handle", "handle", "does", "do",
]);

export interface SemanticHit {
  path: string;
  score: number;
  line: number;
  snippet: string;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\:]+/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

function termCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words(value)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

export function semanticSearch(
  files: WorkspaceFile[],
  query: string,
  limit = 8,
): SemanticHit[] {
  const queryTerms = Array.from(new Set(words(query)));
  if (queryTerms.length === 0) return [];

  const docs = files
    .filter((file) => !file.dir && !file.binary && file.text)
    .slice(0, 1200)
    .map((file) => {
      const counts = termCounts(`${file.path}\n${file.text.slice(0, 120_000)}`);
      const length = Math.max(1, Array.from(counts.values()).reduce((sum, n) => sum + n, 0));
      return { file, counts, length };
    });

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of queryTerms) if (doc.counts.has(term)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = Math.max(1, docs.length);
  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of queryTerms) {
      const count = doc.counts.get(term) ?? 0;
      const related = count
        ? 1
        : Array.from(doc.counts.keys()).some(
            (candidate) =>
              candidate.startsWith(term) ||
              term.startsWith(candidate) ||
              (term.length > 4 && candidate.includes(term.slice(0, 4))),
          )
          ? 0.35
          : 0;
      if (!related) continue;
      const idf = Math.log(1 + total / (1 + (documentFrequency.get(term) ?? 0)));
      score += related * (1 + count) * idf;
    }
    return { doc, score: score / Math.sqrt(doc.length) };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(30, limit)))
    .map(({ doc, score }) => {
      const lines = doc.file.text.split("\n");
      let bestLine = 0;
      let bestHits = -1;
      for (let index = 0; index < lines.length; index += 1) {
        if (index > 4000) break;
        const lower = lines[index].toLowerCase();
        const hits = queryTerms.reduce(
          (sum, term) => sum + (lower.includes(term) ? 1 : 0),
          0,
        );
        if (hits > bestHits) {
          bestHits = hits;
          bestLine = index;
        }
        if (bestHits === queryTerms.length) break;
      }
      const from = Math.max(0, bestLine - 2);
      const to = Math.min(lines.length, bestLine + 3);
      const snippet = lines
        .slice(from, to)
        .map((line, index) => `${from + index + 1}: ${line.trim().slice(0, 180)}`)
        .join("\n");
      return { path: doc.file.path, score, line: bestLine + 1, snippet };
    });
}
