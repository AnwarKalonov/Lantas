#!/usr/bin/env python3
"""Turn the supplied logo artwork into a transparent, theme-friendly PNG.

The source is a JPEG with a near-black background, so luminance becomes alpha:
the dashes and letterforms stay crisp, the background disappears and the asset
can sit on either theme.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Gemini_Generated_Image_si3qnwsi3qnwsi3q.jpeg"
OUT = ROOT / "public" / "logo.png"


def main() -> None:
    image = Image.open(SOURCE).convert("L")
    mask = image.point(lambda value: 255 if value > 40 else 0)
    box = mask.getbbox()
    if box:
        pad = 8
        box = (
            max(0, box[0] - pad),
            max(0, box[1] - pad),
            min(image.width, box[2] + pad),
            min(image.height, box[3] + pad),
        )
        image = image.crop(box)

    # Lift the ink off the background: everything below 12 is black, above 200 is solid.
    alpha = image.point(lambda value: max(0, min(255, int((value - 12) * 1.35))))

    target_width = 1440
    width, height = image.size
    if width != target_width:
        ratio = target_width / width
        size = (target_width, round(height * ratio))
        alpha = alpha.resize(size, Image.LANCZOS)

    ink = Image.new("RGB", alpha.size, (242, 240, 233))
    out = Image.merge("RGBA", (*ink.split(), alpha))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
