#!/usr/bin/env python3
"""Generate PromptForge icons (16/48/128 px) as PNGs.
Writes to icons/icon-{16,48,128}.png.
Re-run if you change the colors or design.
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS_DIR = os.path.join(ROOT, "icons")
os.makedirs(ICONS_DIR, exist_ok=True)

ACCENT = (255, 122, 89, 255)       # orange
ACCENT_DARK = (255, 95, 61, 255)   # deeper
INK = (27, 27, 27, 255)

def make(size: int):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded square background
    radius = max(2, size // 5)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=ACCENT)

    # Simple "hammer / forge" mark: a thick orange-on-ink diagonal stroke
    # forming a stylized "P" overlay.
    pad = max(2, size // 8)
    stroke = max(2, size // 10)
    # vertical stem
    d.rectangle(
        (size // 2 - stroke // 2 - size // 8, pad, size // 2 + stroke // 2 - size // 8, size - pad),
        fill=INK,
    )
    # top loop
    loop_w = size - 2 * pad - size // 4
    loop_h = size // 2 - pad
    loop_x = size // 2 - size // 8 + stroke // 2
    d.rounded_rectangle(
        (loop_x, pad, loop_x + loop_w, pad + loop_h),
        radius=max(2, loop_h // 3),
        outline=INK,
        width=stroke,
    )

    out = os.path.join(ICONS_DIR, f"icon-{size}.png")
    img.save(out, "PNG")
    print(f"wrote {out}")

if __name__ == "__main__":
    for s in (16, 48, 128):
        make(s)
