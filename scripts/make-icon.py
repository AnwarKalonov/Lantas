"""Render the Lantas app icon (1024px PNG) from the same geometry as the UI mark.

    python3 scripts/make-icon.py
    npx tauri icon src-tauri/icon.png -o src-tauri/icons

Drawn at 4x and downsampled so the thin lines stay clean.
"""

from PIL import Image, ImageDraw

S = 4096  # supersampled canvas
SCALE = S / 1024

BG = (10, 11, 10)
SAGE = (242, 240, 233)
SAGE_SOFT = (143, 141, 132)


def dashed(draw, points, fill, width, dash=26, gap=22):
    """Draw a dashed polyline through points."""
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        dx, dy = x2 - x1, y2 - y1
        length = (dx * dx + dy * dy) ** 0.5
        if length == 0:
            continue
        ux, uy = dx / length, dy / length
        pos = 0.0
        while pos < length:
            end = min(pos + dash, length)
            draw.line(
                [(x1 + ux * pos, y1 + uy * pos), (x1 + ux * end, y1 + uy * end)],
                fill=fill,
                width=width,
            )
            pos = end + gap


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # macOS-style rounded square.
    draw.rounded_rectangle([0, 0, S, S], radius=int(228 * SCALE), fill=BG)

    def p(x, y):
        return (x * SCALE, y * SCALE)

    # Hex frame.
    frame = [p(212, 330), p(512, 168), p(812, 330), p(812, 694), p(512, 856), p(212, 694), p(212, 330)]
    dashed(draw, frame, SAGE_SOFT, int(7 * SCALE), dash=int(20 * SCALE), gap=int(26 * SCALE))

    # Ridge.
    ridge = [p(268, 636), p(392, 452), p(456, 520), p(552, 372), p(748, 636)]
    draw.line(ridge, fill=SAGE, width=int(15 * SCALE), joint="curve")

    left = [p(196, 640), p(272, 542), p(348, 640)]
    draw.line(left, fill=SAGE_SOFT, width=int(10 * SCALE), joint="curve")

    # Baseline.
    dashed(
        draw,
        [p(332, 704), p(692, 704)],
        SAGE_SOFT,
        int(9 * SCALE),
        dash=int(16 * SCALE),
        gap=int(22 * SCALE),
    )

    # Nodes.
    for cx, cy, r in ((512, 168, 10), (812, 694, 8), (212, 330, 8)):
        draw.ellipse(
            [
                (cx - r) * SCALE,
                (cy - r) * SCALE,
                (cx + r) * SCALE,
                (cy + r) * SCALE,
            ],
            fill=SAGE,
        )

    img.resize((1024, 1024), Image.LANCZOS).save("src-tauri/icon.png")
    print("wrote src-tauri/icon.png")


if __name__ == "__main__":
    main()
