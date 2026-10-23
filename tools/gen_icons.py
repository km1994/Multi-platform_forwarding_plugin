# -*- coding: utf-8 -*-
"""Generate plugin icons: rounded square + paper-plane (multi-platform send)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")

def make_icon(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(s * 0.22)
    # rounded-square gradient-ish background (solid indigo)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=(79, 70, 229, 255))
    # subtle inner highlight
    d.rounded_rectangle([int(s*0.04), int(s*0.04), s-1-int(s*0.04), s-1-int(s*0.04)],
                        radius=int(r*0.85), outline=(255, 255, 255, 40), width=max(1, s//64))
    # paper plane triangle, centered, pointing top-right
    cx, cy = s * 0.5, s * 0.52
    k = s * 0.30  # half-width
    white = (255, 255, 255, 255)
    light = (199, 210, 254, 255)
    # main body
    d.polygon([(cx - k, cy + k * 0.55), (cx + k, cy - k * 0.75), (cx - k * 0.15, cy + k * 0.95)], fill=white)
    # fold (darker wing)
    d.polygon([(cx + k, cy - k * 0.75), (cx - k * 0.15, cy + k * 0.95), (cx - k * 0.05, cy + k * 0.15)], fill=light)
    # small motion dots bottom-left
    dot_r = max(1, s // 40)
    for i, (dx, dy) in enumerate([(-0.62, 0.10), (-0.50, 0.28), (-0.36, 0.42)]):
        d.ellipse([cx + k*dx - dot_r, cy + k*dy - dot_r, cx + k*dx + dot_r, cy + k*dy + dot_r], fill=light)
    return img

for size in (16, 32, 48, 128):
    make_icon(size).save(os.path.join(OUT, f"icon{size}.png"))

print("icons generated:", os.listdir(OUT))
