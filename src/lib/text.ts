/**
 * Text that arrives from a model is not always plain prose.
 *
 * Some providers wrap reasoning in their own control markers. MiniMax, through
 * NVIDIA's endpoint, streams `<]minimax[>` around its thinking, and a chat
 * template can also leak `<|im_start|>`-style tokens. Those are invisible to the
 * API but not to a person reading the transcript, so they are removed before
 * any text reaches the screen. The raw stream is still parsed unchanged, since
 * tool calls live in it.
 */

/** `<]minimax[>`, with the wrapping brackets some models add: `]<]minimax[>[`. */
const PROVIDER_MARKER = /\s*\]?\s*<\]\s*[a-z0-9_.:-]{1,40}\s*\[>\s*\[?/gi;
/** Chat-template control tokens: `<|im_start|>`, `<|endoftext|>`, `<|eot_id|>`. */
const CHAT_TOKEN = /<\|[\w|.:-]{1,40}\|>/g;
/** What is left of a marker whose two halves arrived in different chunks. */
const ORPHAN_BRACKETS = /\]\s*\[/g;

export function stripModelMarkers(text: string): string {
  if (!text) return "";
  return text.replace(PROVIDER_MARKER, "").replace(CHAT_TOKEN, "").replace(ORPHAN_BRACKETS, "");
}

/**
 * Streaming-safe version of `stripModelMarkers`.
 *
 * A marker can be split across deltas (`<]mini` … `max[>`), so a chunk is not
 * printed until it cannot be the beginning of one. At most a few dozen
 * characters wait, which is below the visible latency of a token stream.
 */
export class MarkerFilter {
  private tail = "";
  /** A `[` that followed a marker and arrived in the next chunk. */
  private swallowBracket = false;

  push(chunk: string): string {
    const buffer = this.tail + chunk;
    this.tail = "";
    const hold = holdbackLength(buffer);
    let ready = hold > 0 ? buffer.slice(0, buffer.length - hold) : buffer;
    if (hold > 0) this.tail = buffer.slice(buffer.length - hold);

    if (this.swallowBracket) {
      this.swallowBracket = false;
      ready = ready.replace(/^(\s*)\[/, "$1");
    }

    const clean = stripModelMarkers(ready);
    // The model writes `]<]minimax[>[`: when the marker sits at the end of this
    // chunk, the closing `[` is the first character of the next one.
    if (/<\]\s*[a-z0-9_.:-]{1,40}\s*\[>\s*$/i.test(ready)) this.swallowBracket = true;
    return clean;
  }

  /** Flush whatever was held, with markers removed. */
  end(): string {
    let rest = stripModelMarkers(this.tail);
    if (this.swallowBracket) rest = rest.replace(/^(\s*)\[/, "$1");
    this.swallowBracket = false;
    this.tail = "";
    return rest;
  }
}

/** Length of a suffix that may still turn into a control marker. */
function holdbackLength(text: string): number {
  let start = Math.max(text.lastIndexOf("<]"), text.lastIndexOf("<|"));

  if (start < 0) {
    // The opening characters of `]<]minimax[>` or `] <]minimax[>` can arrive
    // before the `<]` does. Holding them for one chunk keeps the stray bracket
    // out of the transcript, and is invisible next to a token.
    const partial = /(\]\s*<\s*|\]\s*|<\s*)$/.exec(text);
    return partial ? partial[1].length : 0;
  }

  // Include the leading bracket the model puts in front of the marker,
  // including when it is separated by a space (`] <]minimax[>`).
  let before = start;
  while (before > 0 && /\s/.test(text[before - 1])) before -= 1;
  if (before > 0 && text[before - 1] === "]") start = before - 1;
  const suffix = text.slice(start);
  if (suffix.length > 60) return 0;
  // A complete marker can be stripped now, unless the trailing `[` is still
  // on its way; then hold the whole thing one chunk longer.
  if (suffix.includes(">") && !suffix.endsWith("[")) return 0;
  return suffix.length;
}
