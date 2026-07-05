#!/usr/bin/env python3
"""
Process raw generated art into game-ready sprites.

- Chroma-keys the solid green (or magenta) background via flood fill from the
  image edges, so green/teal details INSIDE the object survive.
- Despills key color from edge pixels and feathers the alpha.
- Trims to content, pads to the aspect ratio the game draws each sprite at.
- Special cases: robot is rotated 180 (generated front-down), room is
  center-cropped to the 1680x1050 world.
"""
from collections import deque
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "art/raw"
OUT = ROOT / "public/assets/sprites"
OUT.mkdir(parents=True, exist_ok=True)

# name -> (aspect w/h, max long side, key color)
SPRITES = {
    "robot": (1.0, 560, "green"),
    "dock": (0.8, 560, "green"),
    "couch": (1.529, 720, "green"),
    "table": (1.241, 560, "green"),
    "plant": (0.786, 480, "magenta"),
    "toybox": (1.211, 480, "green"),
    "catbed": (1.333, 420, "green"),
    "basket": (1.0, 400, "green"),
    "window": (2.05, 640, "green"),
    "tv": (2.23, 640, "green"),
    "rug": (1.778, 900, "green"),
    "cat_sit": (1.0, 320, "green"),
    "cat_walk": (1.0, 320, "green"),
    "cat_sleep": (1.0, 320, "green"),
    "dog_sit": (1.0, 320, "green"),
    "dog_walk": (1.0, 320, "green"),
    "dog_sleep": (1.0, 320, "green"),
    "poop": (1.0, 220, "green"),
    "underside": (1.0, 512, "green"),
    "mop_pads": (1.0, 220, "green"),
    "icon_vacuum": (1.0, 160, "green"),
    "icon_mop": (1.0, 160, "green"),
    "icon_dust": (1.0, 160, "green"),
    "icon_water": (1.0, 160, "green"),
    "icon_dirty": (1.0, 160, "green"),
    "dustbunny": (1.0, 220, "green"),
    "crumbs": (1.0, 220, "green"),
    "cereal": (1.0, 220, "green"),
    "leaf": (1.0, 220, "magenta"),
    "sparkle": (1.0, 220, "green"),
    "sock": (1.0, 220, "green"),
    "toy_ball": (1.0, 220, "green"),
    "toy_block": (1.0, 220, "green"),
    "disco_ball": (1.0, 320, "green"),
}


def is_key(r, g, b, key):
    if key == "green":
        return g > 130 and g - max(r, b) > 55 and r < 190 and b < 190
    # magenta
    return r > 130 and b > 110 and g < 140 and (r - g) > 55 and (b - g) > 40


def key_image(img: Image.Image, key: str) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()

    cand = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if is_key(r, g, b, key):
                cand[row + x] = 1

    # Key ALL candidate pixels — catches enclosed holes (cereal loops!) that an
    # edge flood fill can't reach. Objects never contain true chroma green:
    # green-leaved sprites are generated on magenta instead.
    bg = cand

    out = Image.new("RGBA", (w, h))
    opx = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if bg[row + x]:
                opx[x, y] = (0, 0, 0, 0)
            else:
                # edge feather + despill if any 4-neighbor is background
                edge = False
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and bg[ny * w + nx]:
                        edge = True
                        break
                if edge:
                    if key == "green":
                        g = min(g, max(r, b) + 12)
                    else:
                        r = min(r, g + 30)
                        b = min(b, g + 30)
                    opx[x, y] = (r, g, b, 165)
                else:
                    opx[x, y] = (r, g, b, 255)
    return out


def trim_pad(img: Image.Image, aspect: float, max_side: int, pad_frac=0.03) -> Image.Image:
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    pad = int(max(w, h) * pad_frac)
    w2, h2 = w + pad * 2, h + pad * 2
    # grow to target aspect
    if w2 / h2 < aspect:
        w2 = int(h2 * aspect)
    else:
        h2 = int(w2 / aspect)
    canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    canvas.paste(img, ((w2 - img.width) // 2, (h2 - img.height) // 2))
    if max(w2, h2) > max_side:
        scale = max_side / max(w2, h2)
        canvas = canvas.resize((max(1, int(w2 * scale)), max(1, int(h2 * scale))), Image.LANCZOS)
    return canvas


def process_room():
    src = RAW / "room.png"
    if not src.exists():
        print("room: missing, skip")
        return
    img = Image.open(src).convert("RGB")
    tw, th = 1680, 1050
    scale = max(tw / img.width, th / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    x = (img.width - tw) // 2
    img = img.crop((x, 0, x + tw, th))
    img.save(OUT / "room.png", optimize=True)
    print(f"room: OK {img.size}")


def main():
    only = sys.argv[1:] or None
    process_room() if (only is None or "room" in only) else None
    for name, (aspect, max_side, key) in SPRITES.items():
        if only and name not in only:
            continue
        src = RAW / f"{name}.png"
        if not src.exists():
            print(f"{name}: missing, skip")
            continue
        img = Image.open(src)
        if name == "robot":
            img = img.rotate(180)
        keyed = key_image(img, key)
        final = trim_pad(keyed, aspect, max_side)
        final.save(OUT / f"{name}.png", optimize=True)
        print(f"{name}: OK {final.size}")


if __name__ == "__main__":
    main()
