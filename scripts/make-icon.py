"""Compose the Lantas app icon from the supplied cloud artwork.

    python3 scripts/make-icon.py
    npx tauri icon src-tauri/icon.png -o src-tauri/icons

The mark is the dashed cloud with LANTAS inside it — never redrawn by hand.
The artwork is cream ink on transparency, so it is composited onto the app's
dark rounded square at 4x and downsampled.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public" / "logo.png"
OUT = ROOT / "src-tauri" / "icon.png"
EXTENSION = ROOT / "chrome-extension" / "icons"

BG = (11, 11, 10, 255)
SUPERSAMPLE = 4


def artwork() -> Image.Image:
    """The cloud lockup, trimmed to its ink."""
    image = Image.open(ART).convert("RGBA")
    box = image.getchannel("A").getbbox()
    return image.crop(box) if box else image


def compose(size: int, fill: float) -> Image.Image:
    """A square app icon: rounded dark tile with the cloud centred in it."""
    canvas_size = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        [0, 0, canvas_size - 1, canvas_size - 1],
        radius=round(canvas_size * 0.223),
        fill=BG,
    )

    art = artwork()
    width = round(canvas_size * fill)
    height = max(1, round(art.height * width / art.width))
    art = art.resize((width, height), Image.LANCZOS)
    canvas.alpha_composite(
        art,
        ((canvas_size - width) // 2, (canvas_size - height) // 2),
    )
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = compose(1024, 0.92)
    icon.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} {icon.size[0]}x{icon.size[1]}")

    EXTENSION.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        # Small sizes get a little more ink, or the cloud disappears.
        tile = compose(size, 0.96 if size <= 32 else 0.94)
        tile.save(EXTENSION / f"icon{size}.png")
        print(f"wrote {(EXTENSION / f'icon{size}.png').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
