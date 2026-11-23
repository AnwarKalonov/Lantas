/**
 * The Lantas mark.
 *
 * Letterforms follow the logo exactly: a crossbar-less A and a reversed N,
 * drawn on a 5×7 pixel grid with a hard one-cell shadow. The full lockup adds
 * the dashed circuit ridge and its faceted enclosure.
 */

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

function cellsFor(label: string) {
  const letters = label.split("").filter((letter) => GLYPHS[letter]);
  const cells: Array<{ x: number; y: number }> = [];
  letters.forEach((letter, letterIndex) => {
    GLYPHS[letter].forEach((row, y) => {
      row.split("").forEach((bit, x) => {
        if (bit === "1") cells.push({ x: letterIndex * (GLYPH_W + TRACKING) + x, y });
      });
    });
  });
  return { cells, columns: letters.length * GLYPH_W + Math.max(0, letters.length - 1) * TRACKING };
}

interface WordmarkProps {
  cell?: number;
  className?: string;
  label?: string;
}

/** The wordmark alone, with its hard offset shadow. */
export function Wordmark({ cell = 6, className, label = "LANTAS" }: WordmarkProps) {
  const { cells, columns } = cellsFor(label);
  const shadow = Math.max(1, Math.round(cell * 0.9));

  return (
    <svg
      className={className}
      width={columns * cell + shadow}
      height={GLYPH_H * cell + shadow}
      viewBox={`0 0 ${columns + 1} ${GLYPH_H + 1}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <g transform={`translate(${shadow / cell}, ${shadow / cell})`} fill="var(--logo-shadow)">
        {cells.map((pos, index) => (
          <rect key={`s${index}`} x={pos.x} y={pos.y} width={1} height={1} />
        ))}
      </g>
      <g fill="var(--logo-ink)">
        {cells.map((pos, index) => (
          <rect key={`f${index}`} x={pos.x} y={pos.y} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}

/** The supplied artwork, cropped to a transparent asset. */
export function Lockup({ className }: { className?: string }) {
  return (
    <img
      className={`lockup-img ${className ?? ""}`.trim()}
      src="/logo.png"
      alt="Lantas"
      draggable={false}
    />
  );
}

/** Vector fallback lockup, kept for print and favicons. */
export function LockupVector({ className }: { className?: string }) {
  const { cells, columns } = cellsFor("LANTAS");
  const cell = 11;
  const originX = 290;
  const originY = 332;
  const wordRight = originX + columns * cell;

  return (
    <svg
      className={className}
      viewBox="0 0 1000 540"
      role="img"
      aria-label="Lantas"
      fill="none"
    >
      {/* enclosure */}
      <path
        d="M197 306 L236 240 L326 176 L424 122 L500 96 L590 116 L690 166 L790 224 L852 272 L864 330 L800 408 L640 452 L362 452 L250 410 L197 344 Z"
        stroke="var(--logo-line)"
        strokeWidth="1.6"
        strokeDasharray="9 12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* facets and ticks on the enclosure */}
      <path
        d="M236 240 L300 262 M424 122 L470 150 M590 116 L560 148 M790 224 L742 252 M852 272 L806 296 M250 410 L300 372 M640 452 L604 404"
        stroke="var(--logo-line)"
        strokeWidth="1.4"
        strokeDasharray="7 11"
        strokeLinecap="round"
        opacity="0.65"
      />

      {/* ridge */}
      <path
        d="M318 318 L414 200 L466 246 L520 152 L592 232 L644 198 L714 318"
        stroke="var(--logo-ink)"
        strokeWidth="2.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity="0.92"
      />
      <path
        d="M248 318 L300 262 L344 318"
        stroke="var(--logo-ink)"
        strokeWidth="1.8"
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity="0.7"
      />
      <path
        d="M286 318 L306 292"
        stroke="var(--logo-line)"
        strokeWidth="1.4"
        strokeLinecap="square"
        opacity="0.7"
      />
      <path
        d="M700 318 L748 268 L796 318"
        stroke="var(--logo-ink)"
        strokeWidth="1.8"
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity="0.7"
      />

      {/* contour dashes inside the peak */}
      <path
        d="M486 190 H556 M466 216 H588 M444 242 H616 M420 268 H646"
        stroke="var(--logo-line)"
        strokeWidth="1.3"
        strokeDasharray="10 14"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* baseline rules flanking the wordmark */}
      <path
        d="M214 434 H286 M212 452 H276"
        stroke="var(--logo-line)"
        strokeWidth="1.5"
        strokeDasharray="10 12"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        d={`M${wordRight + 14} 434 H846 M${wordRight + 30} 452 H812`}
        stroke="var(--logo-line)"
        strokeWidth="1.5"
        strokeDasharray="10 12"
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* wordmark */}
      <g transform={`translate(${originX}, ${originY}) scale(${cell})`}>
        <g transform="translate(1, 1)" fill="var(--logo-shadow)">
          {cells.map((pos, index) => (
            <rect key={`s${index}`} x={pos.x} y={pos.y} width={1} height={1} />
          ))}
        </g>
        <g fill="var(--logo-ink)">
          {cells.map((pos, index) => (
            <rect key={`f${index}`} x={pos.x} y={pos.y} width={1} height={1} />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Small ridge glyph for dense chrome. */
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
