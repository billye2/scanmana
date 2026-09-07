#!/usr/bin/env python3
"""Generate Coil PWA icons (spiral glyph on dark ground) as raw PNGs. Stdlib only."""
import math, struct, zlib, sys

BG = (10, 14, 20)          # near-black blue
FG = (52, 211, 153)        # emerald

def make_icon(size):
    px = [[BG for _ in range(size)] for _ in range(size)]
    cx = cy = size / 2
    # rounded-square background is implicit (solid); draw an archimedean spiral
    turns = 2.6
    max_r = size * 0.36
    steps = size * 40
    thickness = max(size * 0.055, 2.0)
    for i in range(int(steps)):
        t = i / steps
        ang = turns * 2 * math.pi * t - math.pi / 2
        r = max_r * t
        x = cx + r * math.cos(ang)
        y = cy + r * math.sin(ang)
        rad = int(math.ceil(thickness))
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                d = math.hypot(dx, dy)
                if d <= thickness:
                    xi, yi = int(x) + dx, int(y) + dy
                    if 0 <= xi < size and 0 <= yi < size:
                        a = min(1.0, thickness - d + 0.5)
                        old = px[yi][xi]
                        px[yi][xi] = tuple(int(old[k] + (FG[k] - old[k]) * a) for k in range(3))
    return px

def write_png(path, px):
    size = len(px)
    raw = b"".join(b"\x00" + b"".join(struct.pack("BBB", *p) for p in row) for row in px)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size})")

for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    write_png(f"public/icons/{name}", make_icon(size))
