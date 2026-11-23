"""Compose the Lantas app icon from the supplied cloud + L mark.

    python3 scripts/make-icon.py
    npx tauri icon src-tauri/icon.png -o src-tauri/icons

The source is a square JPEG of the mark on near-black. Luminance becomes alpha,
so the paper texture and the hard shadow survive while the background goes, and
the mark is placed on the app's dark rounded tile.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "Gemini_Generated_Image_2erwnc2erwnc2erw.jpeg"
OUT = ROOT / "src-tauri" / "icon.png"
EXTENSION = ROOT / "chrome-extension" / "icons"

BG = (11, 11, 10, 255)
SUPERSAMPLE = 4


def artwork() -> Image.Image:
    """The mark with its background removed, trimmed to its ink."""
    rgb = Image.open(ART).convert("RGB")
    alpha = rgb.convert("L").point(lambda value: max(0, min(255, int((value - 18) * 1.15))))
    box = alpha.getbbox()
    if box:
        rgb = rgb.crop(box)
        alpha = alpha.crop(box)
    rgb.putalpha(alpha)
    return rgb


def compose(size: int, height_fraction: float) -> Image.Image:
    """A square icon: rounded dark tile with the mark centred in it."""
    canvas_size = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        [0, 0, canvas_size - 1, canvas_size - 1],
        radius=round(canvas_size * 0.223),
        fill=BG,
    )

    art = artwork()
    height = round(canvas_size * height_fraction)
    width = max(1, round(art.width * height / art.height))
    art = art.resize((width, height), Image.LANCZOS)
    canvas.alpha_composite(
        art,
        ((canvas_size - width) // 2, (canvas_size - height) // 2),
    )
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = compose(1024, 0.74)
    icon.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} {icon.size[0]}x{icon.size[1]}")

    # The in-app rail uses the bare mark, no tile.
    mark = artwork()
    scale = 256 / mark.height
    mark = mark.resize((max(1, round(mark.width * scale)), 256), Image.LANCZOS)
    mark_path = ROOT / "public" / "mark.png"
    mark_path.parent.mkdir(parents=True, exist_ok=True)
    mark.save(mark_path, optimize=True)
    print(f"wrote {mark_path.relative_to(ROOT)} {mark.size[0]}x{mark.size[1]}")

    EXTENSION.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        # Small sizes get a little more ink so the cloud still reads.
        tile = compose(size, 0.84 if size <= 32 else 0.8)
        tile.save(EXTENSION / f"icon{size}.png")
        print(f"wrote {(EXTENSION / f'icon{size}.png').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
