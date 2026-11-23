#!/usr/bin/env python3
"""Draw the Finder background for the Lantas disk image.

The window is the first thing a new person sees, so it uses the real lockup
(the binary cloud and pixel wordmark from the site), cream paper, and a quiet
grid of bits. Finder draws the app and Applications icons on top at the
positions set in src-tauri/tauri.conf.json; this script draws around them.

    python3 scripts/make-dmg-background.py

Writes src-tauri/dmg/background.png at 660x420.
"""

from __future__ import annotations

import pathlib
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / ".tmp" / "fonts"
OUT = ROOT / "src-tauri" / "dmg" / "background.png"
LOGO = ROOT / "public" / "logo.png"

W, H = 660, 420
S = 3  # draw at 3x, downsample once

PAPER = (248, 242, 230)
PAPER_EDGE = (243, 235, 221)
INK = (29, 42, 35)
INK_2 = (78, 91, 83)
INK_3 = (110, 122, 114)
GREEN = (44, 106, 78)

FONTS = {
    "sans": (
        "InstrumentSans.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf",
    ),
    "serif": (
        "InstrumentSerif-Italic.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf",
    ),
    "mono": (
        "IBMPlexMono-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf",
    ),
}


def font(name: str, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    file_name, url = FONTS[name]
    path = FONT_DIR / file_name
    if not path.exists():
        FONT_DIR.mkdir(parents=True, exist_ok=True)
        print(f"downloading {file_name}")
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"could not download {file_name}: {exc}")
    face = ImageFont.truetype(str(path), size * S)
    if weight is not None and name == "sans" and hasattr(face, "set_variation_by_axes"):
        try:
            face.set_variation_by_axes([100, weight])
        except Exception:  # noqa: BLE001
            pass
    return face


def spaced(draw: ImageDraw.ImageDraw, centre_x: float, y: float, text: str, face, fill, tracking: float):
    widths = [draw.textlength(ch, font=face) for ch in text]
    total = sum(widths) + tracking * S * (len(text) - 1)
    x = centre_x - total / 2
    for ch, width in zip(text, widths):
        draw.text((x, y), ch, font=face, fill=fill)
        x += width + tracking * S
    return total


def ink_version(image: Image.Image) -> Image.Image:
    """Recolour the supplied cream lockup to ink, keeping its alpha edges."""
    out = Image.new("RGBA", image.size, INK + (0,))
    out.putalpha(image.getchannel("A"))
    return out


def vertical_gradient(size, top, bottom):
    strip = Image.new("RGB", (1, size[1]))
    pixels = strip.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        pixels[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return strip.resize(size, Image.BILINEAR)


def bit_columns(layer: Image.Image) -> None:
    """A few columns of 0/1 at the edges, the smallest nod to the cloud."""
    face = font("mono", 5)
    draw = ImageDraw.Draw(layer)
    columns = [(14, 54, "01001101"), (26, 268, "10110010"), (W - 22, 48, "01101001"), (W - 34, 276, "10010110")]
    for x, y, bits in columns:
        draw.text((x * S, y * S), "\n".join(bits), font=face, fill=(INK[0], INK[1], INK[2], 30), spacing=4 * S)


def cloud_mask(size) -> Image.Image:
    """Soft silhouette used for the ghost lockup behind the icon row."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    w, h = size
    draw.ellipse([w * 0.10, h * 0.34, w * 0.44, h * 0.90], fill=255)
    draw.ellipse([w * 0.32, h * 0.10, w * 0.68, h * 0.72], fill=255)
    draw.ellipse([w * 0.58, h * 0.32, w * 0.92, h * 0.88], fill=255)
    draw.rectangle([w * 0.18, h * 0.55, w * 0.84, h * 0.90], fill=255)
    return mask


def main() -> None:
    w, h = W * S, H * S
    img = vertical_gradient((w, h), PAPER, PAPER_EDGE).convert("RGBA")

    # Very light paper grain so the flat colour does not band on a wide screen.
    grain = Image.effect_noise((w, h), 16).convert("L").point(lambda value: int(value * 0.024))
    tint = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    img = Image.composite(tint, img, grain)

    logo = Image.open(LOGO).convert("RGBA")
    ink_logo = ink_version(logo)

    # The cloud half of the lockup, large and quiet, behind the two icon slots.
    cloud_crop = logo.crop((0, 0, logo.width, int(logo.height * 0.48)))
    ghost = ink_version(cloud_crop)
    ghost_w = int(w * 0.72)
    ghost_h = int(ghost.height * ghost_w / ghost.width)
    ghost = ghost.resize((ghost_w, ghost_h), Image.LANCZOS)
    ghost_mask = cloud_mask(ghost.size).filter(ImageFilter.GaussianBlur(18 * S))
    ghost_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ghost_layer.paste(ghost, ((w - ghost_w) // 2, int(h * 0.27)), ghost)
    ghost_alpha = Image.new("L", (w, h), 0)
    ghost_alpha.paste(ghost_mask, ((w - ghost_w) // 2, int(h * 0.27)))
    ghost_alpha = ghost_alpha.point(lambda value: int(value * 0.075))
    ghost_layer.putalpha(ghost_alpha)
    img = Image.alpha_composite(img, ghost_layer)

    bits = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bit_columns(bits)
    img = Image.alpha_composite(img, bits)
    draw = ImageDraw.Draw(img)

    # The real lockup: binary cloud, pixel LANTAS, hard offset shadow.
    logo_w = int(250 * S)
    logo_h = int(ink_logo.height * logo_w / ink_logo.width)
    hero = ink_logo.resize((logo_w, logo_h), Image.LANCZOS)
    hero_x = (w - logo_w) // 2
    hero_y = int(9 * S)
    img.paste(hero, (hero_x, hero_y), hero)
    draw = ImageDraw.Draw(img)

    # A hairline datum under the lockup, broken in the middle.
    line_y = hero_y + logo_h + int(7 * S)
    gap = int(34 * S)
    draw.line([(w * 0.27, line_y), (w / 2 - gap, line_y)], fill=(INK[0], INK[1], INK[2], 40), width=max(1, S // 2))
    draw.line([(w / 2 + gap, line_y), (w * 0.73, line_y)], fill=(INK[0], INK[1], INK[2], 40), width=max(1, S // 2))
    draw.ellipse([w / 2 - 2 * S, line_y - 2 * S, w / 2 + 2 * S, line_y + 2 * S], fill=GREEN + (150,))

    # Finder puts the icons at 185,204 and 475,204 in a 660x420 window.
    app_x, app_y = int(185 * S), int(204 * S)
    folder_x = int(475 * S)

    label = font("sans", 8, weight=600)
    spaced(draw, app_x, 296 * S, "LANTAS", label, INK_2, tracking=2.2)
    spaced(draw, folder_x, 296 * S, "APPLICATIONS", label, INK_2, tracking=2.2)

    # Dashed arrow between the slots.
    ax0, ax1 = app_x + int(68 * S), folder_x - int(68 * S)
    dash, gap_len = int(5 * S), int(4 * S)
    x = ax0
    while x < ax1 - int(8 * S):
        draw.line([(x, app_y), (min(x + dash, ax1 - 8 * S), app_y)], fill=(INK[0], INK[1], INK[2], 78), width=max(1, S // 2))
        x += dash + gap_len
    head = int(7 * S)
    draw.line(
        [(ax1 - head, app_y - int(head * 0.7)), (ax1, app_y), (ax1 - head, app_y + int(head * 0.7))],
        fill=(INK[0], INK[1], INK[2], 92),
        width=max(1, int(1.2 * S)),
        joint="curve",
    )

    caption = font("serif", 18)
    text = "Drag Lantas into Applications"
    tw = draw.textlength(text, font=caption)
    draw.text(((w - tw) / 2, 332 * S), text, font=caption, fill=INK_2)

    foot = font("mono", 7)
    spaced(draw, w / 2, 388 * S, "lantas.app   ·   free   ·   no account   ·   macOS 11+", foot, INK_3, tracking=0.6)

    draw.rectangle([0, 0, w - 1, h - 1], outline=(INK[0], INK[1], INK[2], 24), width=S)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({W}x{H})")


if __name__ == "__main__":
    main()
