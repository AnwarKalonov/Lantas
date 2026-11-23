#!/usr/bin/env python3
"""Draw the background of the macOS install window.

The Finder window that opens from the dmg is the first thing a new person sees,
so it is built from the same pieces as the website: cream paper, green ink, the
cloud, and Instrument Sans / Serif. Finder draws the app icon and the
Applications folder on top; this file only draws everything around them.

    python3 scripts/make-dmg-background.py

Writes src-tauri/dmg/background.png (660x420, the window size set in
src-tauri/tauri.conf.json). Fonts are OFL and downloaded on first run into
.tmp/fonts, which git ignores.
"""

from __future__ import annotations

import pathlib
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / ".tmp" / "fonts"
OUT = ROOT / "src-tauri" / "dmg" / "background.png"

W, H = 660, 420
SCALE = 3  # draw big, shrink at the end so type and edges stay smooth

PAPER = (248, 242, 230)
PAPER_LOW = (240, 231, 214)
INK = (29, 42, 35)
INK_2 = (78, 91, 83)
INK_3 = (110, 122, 114)
INK_4 = (147, 160, 150)

FONTS = {
    "sans": (
        "InstrumentSans.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf",
    ),
    "serif": (
        "InstrumentSerif-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf",
    ),
    "serif-italic": (
        "InstrumentSerif-Italic.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf",
    ),
}


def font(name: str, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    path = FONT_DIR / FONTS[name][0]
    if not path.exists():
        FONT_DIR.mkdir(parents=True, exist_ok=True)
        print(f"downloading {path.name}")
        try:
            urllib.request.urlretrieve(FONTS[name][1], path)
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"could not download {path.name}: {exc}")
    f = ImageFont.truetype(str(path), size * SCALE)
    if weight is not None and name == "sans" and hasattr(f, "set_variation_by_axes"):
        try:
            f.set_variation_by_axes([100, weight])
        except Exception:  # noqa: BLE001 - older builds without axes support
            pass
    return f


def spaced(draw: ImageDraw.ImageDraw, xy, text, f, fill, tracking=0):
    """Draw text with letter spacing, centred on x when tracking is used."""
    widths = [draw.textlength(ch, font=f) for ch in text]
    total = sum(widths) + tracking * SCALE * (len(text) - 1)
    x, y = xy
    x -= total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=f, fill=fill)
        x += w + tracking * SCALE
    return total


def vertical_gradient(size, top, bottom):
    grad = Image.new("RGB", (1, size[1]))
    px = grad.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return grad.resize(size, Image.BILINEAR)


def main() -> None:
    w, h = W * SCALE, H * SCALE
    img = vertical_gradient((w, h), PAPER, PAPER_LOW).convert("RGBA")

    # The site's cloud horizon as a band across the top, fading into the paper.
    cloud_path = ROOT / "public-repo" / "assets" / "img" / "cloud-horizon-cut.webp"
    if cloud_path.exists():
        cloud = Image.open(cloud_path).convert("RGBA")
        cloud = cloud.resize((int(w * 1.12), int(w * 1.12 * cloud.height / cloud.width)), Image.LANCZOS)
        band_top = -int(cloud.height * 0.22)
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        layer.paste(cloud, ((w - cloud.width) // 2, band_top), cloud)
        alpha = layer.getchannel("A")
        # Fade to nothing by the band's own bottom edge, so no seam is left behind.
        edge = band_top + cloud.height
        ramp = Image.new("L", (1, h))
        for y in range(h):
            t = max(0.0, min(1.0, (edge - y) / (edge * 0.55)))
            ramp.putpixel((0, y), int(255 * (t ** 1.35)))
        alpha = Image.composite(alpha, Image.new("L", (w, h), 0), ramp.resize((w, h)))
        pale = Image.new("RGBA", (w, h), PAPER + (255,))
        layer = Image.blend(layer, pale, 0.55)  # a whisper of sky, not a photo
        layer.putalpha(alpha.point(lambda a: int(a * 0.85)))
        img = Image.alpha_composite(img, layer)

    # A faint warm glow behind the wordmark, so the top does not feel empty.
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([w * 0.22, -h * 0.34, w * 0.78, h * 0.34], fill=52)
    glow = glow.filter(ImageFilter.GaussianBlur(48 * SCALE / 2))
    tint = Image.new("RGBA", (w, h), (255, 253, 247, 255))
    img = Image.composite(tint, img, glow)

    draw = ImageDraw.Draw(img)

    # Wordmark.
    lockup_path = ROOT / "public-repo" / "assets" / "img" / "lockup-ink.png"
    if lockup_path.exists():
        lock = Image.open(lockup_path).convert("RGBA")
        lock_h = int(54 * SCALE)
        lock = lock.resize((int(lock.width * lock_h / lock.height), lock_h), Image.LANCZOS)
        img.paste(lock, ((w - lock.width) // 2, int(30 * SCALE)), lock)
        draw = ImageDraw.Draw(img)

    # Icon row: Finder puts Lantas on the left, Applications on the right.
    app_x, app_y = int(W * 0.28 * SCALE), int(H * 0.485 * SCALE)
    folder_x = int(W * 0.72 * SCALE)

    label = font("sans", 9, weight=600)
    spaced(draw, (app_x, app_y + 92 * SCALE), "LANTAS", label, INK_3, tracking=1.8)
    spaced(draw, (folder_x, app_y + 92 * SCALE), "APPLICATIONS", label, INK_3, tracking=1.8)

    # Arrow between the two slots, hand-drawn but precise.
    ax0, ax1, ay = app_x + 66 * SCALE, folder_x - 66 * SCALE, app_y
    draw.line([(ax0, ay), (ax1 - 4 * SCALE, ay)], fill=(INK[0], INK[1], INK[2], 92), width=max(1, int(1.4 * SCALE)))
    head = 7 * SCALE
    draw.line([(ax1 - head, ay - head * 0.72), (ax1, ay), (ax1 - head, ay + head * 0.72)],
              fill=(INK[0], INK[1], INK[2], 92), width=max(1, int(1.4 * SCALE)), joint="curve")

    # Closing line, in the site's serif.
    caption = font("serif-italic", 17)
    text = "Drag Lantas into Applications to install"
    tw = draw.textlength(text, font=caption)
    draw.text(((w - tw) / 2, 332 * SCALE), text, font=caption, fill=INK_2)

    # Footer.
    foot = font("sans", 9, weight=500)
    spaced(draw, (w / 2, 384 * SCALE), "FREE  ·  NO ACCOUNT  ·  MACOS 11+", foot, (INK_4[0], INK_4[1], INK_4[2], 230), tracking=1.9)

    # Hairline frame, like the site's cards.
    draw.rectangle([0, 0, w - 1, h - 1], outline=(INK[0], INK[1], INK[2], 22), width=SCALE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({W}x{H})")


if __name__ == "__main__":
    main()
