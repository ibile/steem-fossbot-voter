#!/usr/bin/env python3
"""
Composites the Obsidian Aurora theme onto full 1440x3088 screens — lock, home
and quick panel — so the wallpapers, widgets and UI tint can be judged the way
they'll actually be seen. Output feeds the preview page.
"""

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from generate import (H, PALETTE, ROOT, W, font, frosted_panel, rgba, _text_at)

SCREENS = os.path.join(ROOT, "preview")


# --------------------------------------------------------------------------
# Supersampled drawing
# --------------------------------------------------------------------------

def ss(size, fn, factor=4):
    """Draw at `factor`x and downsample — PIL has no antialiased primitives."""
    w, h = size
    im = Image.new("RGBA", (w * factor, h * factor), (0, 0, 0, 0))
    fn(ImageDraw.Draw(im), factor)
    return im.resize((w, h), Image.LANCZOS)


def glyph(d, cx, cy, s, kind, col, f=1):
    """Abstract app marks — stands in for the themed icon set."""
    w = max(2, int(6 * f))
    r = s / 2
    if kind == "ring":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=w)
        d.ellipse([cx - r * 0.28, cy - r * 0.28, cx + r * 0.28, cy + r * 0.28], fill=col)
    elif kind == "dot":
        d.ellipse([cx - r * 0.62, cy - r * 0.62, cx + r * 0.62, cy + r * 0.62], fill=col)
    elif kind == "bars":
        for i, hgt in enumerate((0.45, 0.85, 0.62)):
            bx = cx - r * 0.62 + i * r * 0.62
            d.rounded_rectangle([bx - w, cy + r * 0.6 - s * hgt, bx + w, cy + r * 0.6],
                                radius=w, fill=col)
    elif kind == "tri":
        d.polygon([(cx, cy - r * 0.8), (cx + r * 0.78, cy + r * 0.6), (cx - r * 0.78, cy + r * 0.6)],
                  outline=col, width=w)
    elif kind == "square":
        d.rounded_rectangle([cx - r * 0.72, cy - r * 0.72, cx + r * 0.72, cy + r * 0.72],
                            radius=r * 0.34, outline=col, width=w)
    elif kind == "wave":
        pts = [(cx - r + i * (2 * r / 24), cy + r * 0.45 * np.sin(i / 24 * 3.4 * np.pi))
               for i in range(25)]
        d.line(pts, fill=col, width=w, joint="curve")
    elif kind == "grid":
        for gx in (-1, 1):
            for gy in (-1, 1):
                d.rounded_rectangle([cx + gx * r * 0.62 - r * 0.30, cy + gy * r * 0.62 - r * 0.30,
                                     cx + gx * r * 0.62 + r * 0.30, cy + gy * r * 0.62 + r * 0.30],
                                    radius=r * 0.12, fill=col)
    elif kind == "arc":
        d.arc([cx - r, cy - r, cx + r, cy + r], start=145, end=395, fill=col, width=w)
    elif kind == "chev":
        for i in (-1, 1):
            d.line([(cx - r * 0.45, cy + i * r * 0.42), (cx + r * 0.10, cy),
                    (cx - r * 0.45, cy - i * r * 0.42)][:2], fill=col, width=w)
        d.line([(cx - r * 0.40, cy - r * 0.45), (cx + r * 0.25, cy), (cx - r * 0.40, cy + r * 0.45)],
               fill=col, width=w, joint="curve")
    elif kind == "plus":
        d.rounded_rectangle([cx - w, cy - r * 0.7, cx + w, cy + r * 0.7], radius=w, fill=col)
        d.rounded_rectangle([cx - r * 0.7, cy - w, cx + r * 0.7, cy + w], radius=w, fill=col)


ACCENTS = [PALETTE["teal"], PALETTE["violet"], PALETTE["rose"], "#5AC8E8", "#B364E0"]

APPS = [
    ("Phone", "ring"), ("Messages", "square"), ("Camera", "dot"), ("Gallery", "grid"),
    ("Clock", "arc"), ("Weather", "wave"), ("Maps", "tri"), ("Music", "bars"),
    ("Notes", "square"), ("Files", "grid"), ("Store", "plus"), ("Settings", "ring"),
    ("Mail", "chev"), ("Calendar", "square"), ("Health", "wave"), ("Wallet", "dot"),
]


def app_icon(size, kind, accent, squircle=0.30):
    """A themed icon tile: glass squircle, accent glyph, top specular edge."""
    def draw(d, f):
        s = size * f
        rad = s * squircle
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, fill=(18, 23, 31, 214))
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, outline=(255, 255, 255, 34), width=2 * f)
        d.rounded_rectangle([2 * f, 2 * f, s - 2 * f, s * 0.55], radius=rad * 0.9,
                            outline=(255, 255, 255, 20), width=2 * f)
        glyph(d, s / 2, s / 2, s * 0.46, kind, rgba(accent, 245), f)
    return ss((size, size), draw)


# --------------------------------------------------------------------------
# Chrome
# --------------------------------------------------------------------------

def status_bar(im, show_clock=True):
    d = ImageDraw.Draw(im)
    if show_clock:
        _text_at(d, (96, 62), "9:41", font("Outfit-Bold.ttf", 42), rgba(PALETTE["text"], 240))

    def draw(dd, f):
        col = rgba(PALETTE["text"], 232)
        # signal
        for i in range(4):
            hgt = (i + 1) * 9 * f
            x = i * 15 * f
            dd.rounded_rectangle([x, 44 * f - hgt, x + 10 * f, 44 * f], radius=3 * f, fill=col)
        # wifi
        ox = 82 * f
        for i, rr in enumerate((34, 23, 12)):
            dd.arc([ox - rr * f, 44 * f - rr * f, ox + rr * f, 44 * f + rr * f],
                   start=205, end=335, fill=col, width=6 * f)
        dd.ellipse([ox - 5 * f, 38 * f, ox + 5 * f, 48 * f], fill=col)
        # battery
        bx = 128 * f
        dd.rounded_rectangle([bx, 12 * f, bx + 62 * f, 44 * f], radius=9 * f, outline=col, width=4 * f)
        dd.rounded_rectangle([bx + 68 * f, 22 * f, bx + 76 * f, 34 * f], radius=3 * f, fill=col)
        dd.rounded_rectangle([bx + 7 * f, 19 * f, bx + 45 * f, 37 * f], radius=5 * f,
                             fill=rgba(PALETTE["teal"], 245))
    bar = ss((210, 56), draw)
    im.alpha_composite(bar, (W - 96 - 210, 46))
    return im


def paste(base, layer, xy):
    base.alpha_composite(layer.convert("RGBA"), xy)


# --------------------------------------------------------------------------
# Screens
# --------------------------------------------------------------------------

def lock_screen():
    bg = Image.open(os.path.join(ROOT, "wallpapers", "lock_1440x3088.png")).convert("RGBA")
    status_bar(bg, show_clock=False)

    clock = Image.open(os.path.join(ROOT, "widgets", "clock.png"))
    paste(bg, clock, (108, 300))

    weather = Image.open(os.path.join(ROOT, "widgets", "weather.png"))
    paste(bg, weather, (108, 1090))

    # notification card
    card = frosted_panel((1224, 232), 52)
    d = ImageDraw.Draw(card)
    d.ellipse([36, 56, 156, 176], fill=rgba(PALETTE["violet"], 235))
    glyph(d, 96, 116, 58, "chev", rgba("#0B0E13", 255), 1)
    _text_at(d, (200, 66), "Aurora Studio", font("Outfit-Bold.ttf", 40), rgba(PALETTE["text"], 244))
    _text_at(d, (200, 124), "Your theme is ready to apply", font("Outfit-Regular.ttf", 36),
             rgba(PALETTE["muted"], 226))
    _text_at(d, (1080, 68), "now", font("GeistMono-Regular.ttf", 28), rgba(PALETTE["muted"], 190))
    paste(bg, card, (108, 1420))

    # bottom shortcuts + swipe hint
    def shortcut(kind, accent):
        def draw(d, f):
            s = 148 * f
            d.ellipse([0, 0, s, s], fill=(255, 255, 255, 26))
            d.ellipse([0, 0, s, s], outline=(255, 255, 255, 46), width=2 * f)
            glyph(d, s / 2, s / 2, s * 0.42, kind, rgba(accent, 240), f)
        return ss((150, 150), draw)

    paste(bg, shortcut("ring", PALETTE["teal"]), (150, 2740))
    paste(bg, shortcut("dot", PALETTE["rose"]), (W - 150 - 150, 2740))

    d = ImageDraw.Draw(bg)
    _text_at(d, (W // 2 - 132, 2620), "SWIPE TO UNLOCK", font("GeistMono-Regular.ttf", 26),
             rgba(PALETTE["muted"], 170))
    d.rounded_rectangle([W // 2 - 130, 2980, W // 2 + 130, 2990], radius=5,
                        fill=rgba(PALETTE["text"], 120))
    return bg


def home_screen():
    bg = Image.open(os.path.join(ROOT, "wallpapers", "home_1440x3088.png")).convert("RGBA")
    status_bar(bg)

    clock = Image.open(os.path.join(ROOT, "widgets", "clock.png"))
    clock = clock.resize((int(clock.width * 0.72), int(clock.height * 0.72)), Image.LANCZOS)
    paste(bg, clock, (96, 230))

    batt = Image.open(os.path.join(ROOT, "widgets", "battery.png"))
    paste(bg, batt, (W - 96 - batt.width, 300))

    weather = Image.open(os.path.join(ROOT, "widgets", "weather.png"))
    weather = weather.resize((int(weather.width * 0.95), int(weather.height * 0.95)), Image.LANCZOS)
    paste(bg, weather, (96, 900))

    # 4x4 app grid
    margin, size = 96, 216
    gap = (W - 2 * margin - 4 * size) // 3
    top = 1240
    pitch = size + 128
    d = ImageDraw.Draw(bg)
    lbl = font("Outfit-Regular.ttf", 30)
    for i, (name, kind) in enumerate(APPS):
        col, row = i % 4, i // 4
        x = margin + col * (size + gap)
        y = top + row * pitch
        paste(bg, app_icon(size, kind, ACCENTS[i % len(ACCENTS)]), (x, y))
        bb = d.textbbox((0, 0), name, font=lbl)
        _text_at(d, (x + (size - (bb[2] - bb[0])) // 2, y + size + 22), name, lbl,
                 rgba(PALETTE["text"], 214))

    # page dots
    for i in range(3):
        cx = W // 2 - 40 + i * 40
        on = i == 1
        rr = 8 if on else 6
        d.ellipse([cx - rr, 2660 - rr, cx + rr, 2660 + rr],
                  fill=rgba(PALETTE["teal"] if on else PALETTE["muted"], 240 if on else 130))

    # dock
    dock = frosted_panel((W - 144, 268), 64, fill=(16, 21, 28, 168))
    for i, (name, kind) in enumerate([("Phone", "ring"), ("Messages", "square"),
                                      ("Camera", "dot"), ("Music", "bars"), ("Settings", "plus")]):
        ic = app_icon(172, kind, ACCENTS[i % len(ACCENTS)])
        dock.alpha_composite(ic, (60 + i * 244, 48))
    paste(bg, dock, (72, 2720))

    d.rounded_rectangle([W // 2 - 130, 3020, W // 2 + 130, 3030], radius=5,
                        fill=rgba(PALETTE["text"], 120))
    return bg


def quick_panel():
    bg = Image.open(os.path.join(ROOT, "wallpapers", "home_1440x3088.png")).convert("RGB")
    bg = bg.filter(ImageFilter.GaussianBlur(34))
    bg = Image.blend(bg, Image.new("RGB", (W, H), (7, 9, 13)), 0.62).convert("RGBA")
    status_bar(bg)

    d = ImageDraw.Draw(bg)
    _text_at(d, (96, 190), "Tuesday, 13 August", font("Outfit-Regular.ttf", 40),
             rgba(PALETTE["muted"], 225))

    tiles = [("Wi-Fi", "arc", True), ("Bluetooth", "chev", True), ("Sound", "wave", True),
             ("Rotate", "ring", False), ("Torch", "dot", False), ("Airplane", "tri", False)]
    tw, th = (W - 2 * 96 - 2 * 36) // 3, 300
    for i, (name, kind, on) in enumerate(tiles):
        col, row = i % 3, i // 3
        x, y = 96 + col * (tw + 36), 300 + row * (th + 36)
        accent = ACCENTS[i % 3]
        if on:
            tile = frosted_panel((tw, th), 56, fill=rgba(accent, 62), border=rgba(accent, 120))
        else:
            tile = frosted_panel((tw, th), 56, fill=(20, 26, 34, 150))
        td = ImageDraw.Draw(tile)
        glyph(td, tw // 2, 118, 92, kind, rgba(accent if on else PALETTE["muted"], 240), 1)
        bb = td.textbbox((0, 0), name, font=font("Outfit-Regular.ttf", 32))
        _text_at(td, ((tw - (bb[2] - bb[0])) // 2, 200), name, font("Outfit-Regular.ttf", 32),
                 rgba(PALETTE["text"] if on else PALETTE["muted"], 235))
        paste(bg, tile, (x, y))

    # brightness slider
    y = 300 + 2 * (th + 36)
    track = frosted_panel((W - 192, 120), 60, fill=(20, 26, 34, 150))
    td = ImageDraw.Draw(track)
    fillw = int((W - 192) * 0.66)
    td.rounded_rectangle([0, 0, fillw, 119], radius=60, fill=rgba(PALETTE["teal"], 130))
    glyph(td, 78, 60, 56, "ring", rgba("#0B0E13", 235), 1)
    paste(bg, track, (96, y))

    # media card
    media = frosted_panel((W - 192, 340), 60)
    md = ImageDraw.Draw(media)
    md.rounded_rectangle([44, 60, 264, 280], radius=44, fill=rgba(PALETTE["violet"], 210))
    glyph(md, 154, 170, 110, "bars", rgba("#0B0E13", 240), 1)
    _text_at(md, (312, 96), "Solar Fields", font("Outfit-Bold.ttf", 44), rgba(PALETTE["text"], 244))
    _text_at(md, (312, 158), "Movements", font("Outfit-Regular.ttf", 36), rgba(PALETTE["muted"], 220))
    md.rounded_rectangle([312, 232, W - 260, 244], radius=6, fill=rgba(PALETTE["outline"], 220))
    md.rounded_rectangle([312, 232, 312 + int((W - 572) * 0.42), 244], radius=6,
                         fill=rgba(PALETTE["teal"], 240))
    paste(bg, media, (96, y + 190))
    return bg


def main():
    os.makedirs(SCREENS, exist_ok=True)
    for name, fn in (("lock", lock_screen), ("home", home_screen), ("quick", quick_panel)):
        print(f"  compositing {name} ...", flush=True)
        im = fn().convert("RGB")
        im.save(os.path.join(SCREENS, f"screen_{name}.jpg"), "JPEG", quality=92, optimize=True)
        im.resize((W // 3, H // 3), Image.LANCZOS).save(
            os.path.join(SCREENS, f"screen_{name}_small.jpg"), "JPEG", quality=86, optimize=True)
    print("done.")


if __name__ == "__main__":
    main()
