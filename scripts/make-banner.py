#!/usr/bin/env python3
"""The README's banner (docs/images/banner.png, 1600x480): a bright sky, rolling hills, a ramp and a loose wheel
flying off it, and the title. Original art: nothing from the game (the title in Liberation Sans, the runtime's own
font in runtime/fonts, SIL Open Font License).

    python3 scripts/make-banner.py
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
W, H = 1600, 480
SKY_TOP, SKY_LOW = (64, 128, 226), (178, 222, 255)
HILL_FAR, HILL_NEAR = (96, 168, 112), (62, 132, 70)
RAMP = (110, 116, 128)
TEXT_TOP, TEXT_LOW = (255, 244, 214), (255, 182, 72)
MUTED = (214, 226, 240)


def font(size, name="LiberationSans-Bold.ttf"):
    for path in (os.path.join(ROOT, "runtime", "fonts", name), "C:/Windows/Fonts/arialbd.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hill(d, base, amp, period, phase, colour):
    pts = [(0, H)]
    for x in range(0, W + 8, 8):
        pts.append((x, base - amp * (0.6 * math.sin(x / period + phase) + 0.4 * math.sin(x / (period * 0.43) + phase * 2))))
    pts.append((W, H))
    d.polygon(pts, fill=colour)


def wheel(img, cx, cy, r, angle):
    """A bicycle wheel: tyre, rim, hub and spokes, turned by `angle`."""
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(34, 34, 40), width=max(6, r // 9))
    d.ellipse([cx - r + r // 7, cy - r + r // 7, cx + r - r // 7, cy + r - r // 7], outline=(196, 200, 210), width=3)
    for k in range(16):
        a = angle + k * math.pi / 8
        d.line([(cx, cy), (cx + math.cos(a) * (r - r // 7), cy + math.sin(a) * (r - r // 7))], fill=(206, 210, 218), width=2)
    d.ellipse([cx - r // 8, cy - r // 8, cx + r // 8, cy + r // 8], fill=(60, 62, 70))


def scene():
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(SKY_TOP, SKY_LOW, (y / (H - 1)) ** 1.3))
    # Soft clouds: blurred white ellipses.
    clouds = Image.new("L", (W, H), 0)
    cd = ImageDraw.Draw(clouds)
    for x, y, w, h in ((120, 70, 260, 70), (230, 50, 200, 80), (520, 120, 240, 60), (640, 100, 180, 70)):
        cd.ellipse([x, y, x + w, y + h], fill=210)
    clouds = clouds.filter(ImageFilter.GaussianBlur(18))
    img = Image.composite(Image.new("RGB", (W, H), (255, 255, 255)), img, clouds)
    d = ImageDraw.Draw(img)
    hill(d, H * 0.70, 26, 180, 0.4, HILL_FAR)
    hill(d, H * 0.84, 18, 130, 2.1, HILL_NEAR)
    # The ramp: a deck up to a lip, on a red frame of posts and braces.
    x0, x1, top = 70, 440, int(H * 0.50)
    ground = int(H * 0.86)
    deck_y = lambda x: ground - (x - x0) * (ground - top) / (x1 - x0)
    posts = [x0 + 90 + k * 70 for k in range(5)] + [x1 - 6]
    for a, b in zip(posts, posts[1:]):
        d.line([(a, ground - 2), (b, deck_y(b) + 16)], fill=(150, 34, 34), width=5)
    for x in posts:
        d.line([(x, deck_y(x) + 10), (x, ground)], fill=(176, 40, 40), width=9)
    d.polygon([(x0, ground), (x1, top), (x1 + 8, top + 2), (x1 + 8, top + 20), (x0 + 40, ground)], fill=RAMP)
    d.line([(x0, ground), (x1, top)], fill=(150, 156, 168), width=4)
    # The wheel off the lip, with speed lines trailing back along its flight.
    cx, cy, r = 640, int(H * 0.28), 80
    lip = (x1 + 8, top)
    dx, dy = cx - lip[0], cy - lip[1]
    n = math.hypot(dx, dy)
    ux, uy = dx / n, dy / n
    for k in range(-2, 3):
        ox, oy = -uy * k * 16, ux * k * 16
        back = 120 - abs(k) * 28
        sx, sy = cx - ux * (r + 18) + ox, cy - uy * (r + 18) + oy
        d.line([(sx - ux * back, sy - uy * back), (sx, sy)], fill=(255, 255, 255), width=4)
    wheel(img, cx, cy, r, 0.35)
    return img


def text_panel(img):
    """The right side darkens towards the title, so the text reads over the sky."""
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    start = int(W * 0.45)
    for x in range(start, W):
        sd.line([(x, 0), (x, H)], fill=int(215 * min(1.0, ((x - start) / (W * 0.20)) ** 1.2)))
    return Image.composite(Image.new("RGB", (W, H), (14, 22, 44)), img, shade)


def gradient_text(img, xy, text, f, top, low, glow=None):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=f, fill=255)
    box = mask.getbbox()
    if glow:
        halo = mask.filter(ImageFilter.GaussianBlur(14))
        halo = ImageChops.multiply(halo, Image.new("L", img.size, glow[1]))
        img = Image.composite(Image.new("RGB", img.size, glow[0]), img, halo)
    fill = Image.new("RGB", img.size)
    fd = ImageDraw.Draw(fill)
    for y in range(box[1], box[3] + 1):
        fd.line([(box[0], y), (box[2], y)], fill=lerp(top, low, (y - box[1]) / max(1, box[3] - box[1])))
    return Image.composite(fill, img, mask)


def main():
    img = text_panel(scene())
    x = int(W * 0.53)
    size = 104
    while size > 40 and ImageDraw.Draw(img).textlength("HAPPY WHEELS", font=font(size)) > W - x - 50:
        size -= 2
    img = gradient_text(img, (x, 96), "HAPPY WHEELS", font(size), TEXT_TOP, TEXT_LOW, glow=((255, 150, 40), 140))
    img = gradient_text(img, (x + 4, 214), "for PS4", font(66), (255, 226, 150), (240, 120, 40), glow=((255, 150, 40), 100))
    d = ImageDraw.Draw(img)
    d.text((x + 6, 318), "the web game  \u00b7  a controller  \u00b7  its own runtime", font=font(30, "LiberationSans-Regular.ttf"), fill=MUTED)
    for i in range(560):
        d.point((x + 6 + i, 370), fill=lerp((255, 170, 60), (14, 22, 44), (i / 560) ** 0.8))
    out = os.path.join(ROOT, "docs", "images", "banner.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
