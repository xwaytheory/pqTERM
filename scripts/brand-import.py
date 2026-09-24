#!/usr/bin/env python3
"""Derive every pqTERM brand asset from the logo master.

The master (resources/brand/pq-master.jpg) is a black banner with the pq mark
centred. One source, one recipe, so the taskbar icon, the favicon, the Tauri
icons and the in-app mark can never drift apart again.

Run from the repo root:  python scripts/brand-import.py

Needs Pillow (pip install pillow) — it is not a project dependency, so this
stays a manual, offline step: assets are committed, not built.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "resources" / "brand" / "pq-master.jpg"

# Thresholds for "this pixel is part of the mark", used to crop JPEG noise and
# the empty banner around the glyphs.
BRIGHT = 50
MIN_RUN = 4
# Breathing room on every icon: the mark fills 1 - 2*PAD of the tile (60% here),
# so the taskbar/exe icon reads as a discreet logo, not a full-bleed tile. One
# knob — raise it for a smaller mark, lower it for a bigger one.
PAD = 0.20


def content_box(img: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the mark, ignoring stray JPEG sparkle."""
    luma = img.convert("L")
    px = luma.load()
    w, h = luma.size
    rows: list[int] = []
    cols: list[int] = []
    for y in range(h):
        hit = sum(1 for x in range(w) if px[x, y] > BRIGHT)
        if hit >= MIN_RUN:
            rows.append(y)
    for x in range(w):
        hit = sum(1 for y in range(h) if px[x, y] > BRIGHT)
        if hit >= MIN_RUN:
            cols.append(x)
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def square_tile(img: Image.Image, size: int) -> Image.Image:
    """Mark centred on a square black tile — the app/executable icon.

    The tile stays `side` square and only the mark scales down to `inner`, so
    PAD is real padding. (Scaling the tile itself left the mark edge-to-edge.)
    """
    x0, y0, x1, y1 = content_box(img)
    mark = img.crop((x0, y0, x1, y1))
    side = max(mark.size)
    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    canvas.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    inner = max(1, int(side * (1 - 2 * PAD)))
    tile = Image.new("RGB", (side, side), (0, 0, 0))
    offset = (side - inner) // 2
    tile.paste(canvas.resize((inner, inner), Image.LANCZOS), (offset, offset))
    return tile.resize((size, size), Image.LANCZOS)


def transparent_mark(img: Image.Image, width: int) -> Image.Image:
    """Glyphs on alpha, for use on the app's own dark chrome."""
    x0, y0, x1, y1 = content_box(img)
    mark = img.crop((x0, y0, x1, y1)).convert("RGB")
    height = round(mark.height * width / mark.width)
    mark = mark.resize((width, height), Image.LANCZOS)
    luma = mark.convert("L")
    # Soft ramp: the master's anti-aliased edges already sit between the black
    # background and the glyph, so a linear window keeps them smooth.
    lo, hi = 18, 60
    alpha = luma.point(lambda v: 0 if v <= lo else 255 if v >= hi else int((v - lo) * 255 / (hi - lo)))
    out = Image.new("RGBA", mark.size)
    out.putalpha(alpha)
    # Un-premultiply so the semi-transparent edge pixels do not read as grey.
    src, dst = mark.load(), out.load()
    for y in range(mark.height):
        for x in range(mark.width):
            a = dst[x, y][3]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
            else:
                r, g, b = src[x, y]
                f = 255 / a
                dst[x, y] = (min(255, round(r * f)), min(255, round(g * f)), min(255, round(b * f)), a)
    return out


def main() -> None:
    if not MASTER.exists():
        raise SystemExit(f"missing logo master: {MASTER}")
    master = Image.open(MASTER).convert("RGB")

    for size in (256, 512):
        square_tile(master, size).save(ROOT / "resources" / "brand" / f"pq-{size}.png")

    ico = square_tile(master, 256)
    ico.save(
        ROOT / "resources" / "brand" / "pq.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Renderer favicon (src/renderer/index.html links both) + window icon fallback.
    square_tile(master, 32).save(ROOT / "src" / "renderer" / "favicon.png")
    ico.save(ROOT / "src" / "renderer" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # Tauri bundle icons (src-tauri/tauri.conf.json points at icons/icon.*).
    icons = ROOT / "src-tauri" / "icons"
    square_tile(master, 32).save(icons / "32x32.png")
    square_tile(master, 128).save(icons / "128x128.png")
    square_tile(master, 256).save(icons / "128x128@2x.png")
    square_tile(master, 512).save(icons / "icon.png")
    ico.save(icons / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (128, 128), (256, 256)])

    # In-app mark (titlebar, login screen): glyphs, no tile.
    transparent_mark(master, 96).save(ROOT / "src" / "renderer" / "src" / "assets" / "brand-mark.png")

    print("brand assets regenerated from", MASTER)


if __name__ == "__main__":
    main()
