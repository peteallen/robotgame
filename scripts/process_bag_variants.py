#!/usr/bin/env python3
"""
Process the edited dock variants (half/full dust bag) so they align EXACTLY
with the shipped dock sprite: key, crop to the BASE dock's content bbox,
pad and resize identically. Any extra elements the edit hallucinated outside
the dock's silhouette get cropped away for free.
"""
from pathlib import Path
import sys

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from process_art import key_image, RAW, OUT

BASE = "dock"
VARIANTS = {"dock_bag_half": "dock_half.png", "dock_bag_full": "dock_full.png"}


def main():
    base_raw = Image.open(RAW / f"{BASE}.png")
    base_keyed = key_image(base_raw, "green")
    bbox = base_keyed.getbbox()
    final_size = Image.open(OUT / f"{BASE}.png").size
    print(f"base bbox {bbox}, final {final_size}")
    for name, outname in VARIANTS.items():
        src = RAW / f"{name}.png"
        if not src.exists():
            print(f"{name}: missing raw, skip")
            continue
        img = Image.open(src)
        if img.size != base_raw.size:
            img = img.resize(base_raw.size, Image.LANCZOS)
        keyed = key_image(img, "green")
        cropped = keyed.crop(bbox)
        # replicate trim_pad's aspect/pad steps implicitly: base pipeline was
        # trim(bbox) -> pad to 0.8 aspect -> resize; easiest exact match is to
        # rebuild via the same helper on the base's crop geometry
        from process_art import trim_pad
        final = rebuild_like_base(cropped, final_size)
        final.save(OUT / outname, optimize=True)
        print(f"{name}: OK -> {outname} {final.size}")


def rebuild_like_base(cropped: Image.Image, final_size):
    # pad the crop to the final aspect, centered, then resize — mirrors
    # trim_pad(aspect=w/h, pad_frac=0.03) applied to the base
    fw, fh = final_size
    aspect = fw / fh
    w, h = cropped.size
    pad = int(max(w, h) * 0.03)
    w2, h2 = w + pad * 2, h + pad * 2
    if w2 / h2 < aspect:
        w2 = int(h2 * aspect)
    else:
        h2 = int(w2 / aspect)
    canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    canvas.paste(cropped, ((w2 - cropped.width) // 2, (h2 - cropped.height) // 2))
    return canvas.resize(final_size, Image.LANCZOS)


if __name__ == "__main__":
    main()
