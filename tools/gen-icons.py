#!/usr/bin/env python3
"""
Generate the ShotSmith launcher icons.

The mark is the same in every size: a camera body outline with a blue lens on a
near-black rounded square, drawn as flat geometry (no gradients, no emoji —
house rules). Everything is rendered at 4x and downsampled, which gives clean
edges without pulling in an SVG rasteriser.

    python3 tools/gen-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"

BG = (19, 19, 20, 255)          # --app-dark
INK = (255, 255, 255, 255)
BLUE = (11, 86, 255, 255)       # --app-blue
SS = 4                          # supersampling factor
SIZES = (32, 192, 512, 1024)


def rounded(draw, box, radius, fill=None, outline=None, width=0):
    draw.rounded_rectangle(
        box, radius=radius, fill=fill, outline=outline, width=width
    )


def draw_mark(size: int) -> Image.Image:
    canvas = size * SS
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background: rounded square, full bleed so a maskable mask can crop it.
    rounded(d, (0, 0, canvas - 1, canvas - 1), radius=int(canvas * 0.22), fill=BG)

    # Content stays inside the 66% safe zone for adaptive icons.
    u = canvas / 100.0
    body = (22 * u, 32 * u, 78 * u, 76 * u)
    rounded(d, body, radius=int(9 * u), outline=INK, width=max(2, int(2.6 * u)))

    # Viewfinder bump on top of the body.
    rounded(
        d,
        (36 * u, 24 * u, 64 * u, 34 * u),
        radius=int(4 * u),
        fill=INK,
    )

    # Lens: accent-filled circle with a thin light ring around it.
    lens = (37 * u, 44 * u, 63 * u, 70 * u)
    d.ellipse(lens, fill=BLUE)
    d.ellipse(
        (34 * u, 41 * u, 66 * u, 73 * u),
        outline=INK,
        width=max(2, int(2 * u)),
    )

    # Shutter dot, the one warm detail on the right side of the body.
    d.ellipse((67 * u, 39 * u, 72 * u, 44 * u), fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}.png"
        draw_mark(size).save(path, optimize=True)
        print(f"{path.relative_to(OUT.parent.parent)}  {size}x{size}")


if __name__ == "__main__":
    main()