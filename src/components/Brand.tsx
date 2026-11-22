const GLYPHS: Record<string, string[]> = {
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const TRACKING = 1;

interface WordmarkProps {
  cell?: number;
  className?: string;
  label?: string;
}

/**
 * Pixel wordmark from the LANTAS mark: solid letters with a one-cell
 * offset shadow. Ink and shadow come from theme tokens.
 */
export function Wordmark({ cell = 6, className, label = "LANTAS" }: WordmarkProps) {
  const letters = label.split("").filter((letter) => GLYPHS[letter]);
  const width = letters.length * GLYPH_W + Math.max(0, letters.length - 1) * TRACKING;
  const cells: Array<{ x: number; y: number }> = [];

  letters.forEach((letter, letterIndex) => {
    const glyph = GLYPHS[letter];
    const offsetX = letterIndex * (GLYPH_W + TRACKING);
    glyph.forEach((row, y) => {
      row.split("").forEach((bit, x) => {
        if (bit === "1") cells.push({ x: offsetX + x, y });
      });
    });
  });

  return (
    <svg
      className={className}
      width={width * cell + cell}
      height={GLYPH_H * cell + cell}
      viewBox={`0 0 ${width + 1} ${GLYPH_H + 1}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      {cells.map((cellPos, index) => (
        <rect
          key={`s${index}`}
          x={cellPos.x + 1}
          y={cellPos.y + 1}
          width={1}
          height={1}
          fill="var(--logo-shadow)"
        />
      ))}
      {cells.map((cellPos, index) => (
        <rect
          key={`f${index}`}
          x={cellPos.x}
          y={cellPos.y}
          width={1}
          height={1}
          fill="var(--logo-ink)"
        />
      ))}
    </svg>
  );
}

interface MarkProps {
  size?: number;
  className?: string;
  withFrame?: boolean;
}

/** The constellation: a dashed angular frame around a stepped ridge. */
export function LantasMark({ size = 24, className, withFrame = true }: MarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={(size * 180) / 240}
      viewBox="0 0 240 180"
      fill="none"
      role="img"
      aria-label="Lantas"
    >
      {withFrame && (
        <>
          <path
            d="M46 60 L86 30 L148 27 L196 54 L207 92 L192 132 L152 150 L84 151 L40 128 L31 92 Z"
            stroke="var(--logo-line)"
            strokeWidth="1.1"
            strokeDasharray="2.5 5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
          <path
            d="M104 44 L120 38 M132 33 L150 31 M166 36 L182 43 M190 62 L198 74"
            stroke="var(--logo-line)"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.6"
          />
        </>
      )}

      <path
        d="M62 128 L92 82 L106 94 L128 60 L152 96 L168 82 L186 128"
        stroke="var(--logo-ink)"
        strokeWidth="1.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M44 130 L58 106 L74 130"
        stroke="var(--logo-line)"
        strokeWidth="1.1"
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity="0.75"
      />
      <path
        d="M74 140 L166 140"
        stroke="var(--logo-line)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="3 6"
        opacity="0.7"
      />

      <circle cx="128" cy="60" r="1.6" fill="var(--logo-ink)" />
      <circle cx="207" cy="92" r="1.4" fill="var(--logo-line)" />
      <circle cx="31" cy="92" r="1.4" fill="var(--logo-line)" />
    </svg>
  );
}

/** Compact glyph for chrome: the ridge alone, no frame. */
export function MarkGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 19 L9 7.5 L12.5 13 L15.5 9 L21 19"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path d="M4 21.5 H20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export function Lockup() {
  return (
    <div className="lockup">
      <LantasMark size={240} className="lockup-mark" />
      <Wordmark cell={6} className="lockup-word" />
    </div>
  );
}
