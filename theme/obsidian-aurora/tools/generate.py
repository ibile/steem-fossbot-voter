#!/usr/bin/env python3
"""
Obsidian Aurora — a premium theme for the Samsung Galaxy S23 Ultra.

Renders wallpapers at the panel's native 1440x3088 (QHD+, 19.3:9) and the
KWGT widget reference layers that sit on top of them.

Design notes that matter for this specific panel:
  * The S23 Ultra is AMOLED, so #000000 costs zero power. The base is kept at
    near-black and the AOD variant is true black with a minimal lit area.
  * Light is accumulated in LINEAR space, not sRGB. Additive glow blended in
    sRGB looks chalky; in linear it reads like actual emitted light.
  * Dark gradients band horribly on a 8-bit AMOLED panel. Every render gets
    TPDF dither at +/- 0.5 LSB before quantisation, which removes the rings.
"""

import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1440, 3088
FONT_DIR = "/mnt/skills/examples/canvas-design/canvas-fonts"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

PALETTE = {
    "base":        "#07080B",
    "surface":     "#0E1116",
    "surfaceAlt":  "#151A21",
    "outline":     "#232A34",
    "teal":        "#4FE3C1",
    "violet":      "#7C6CF5",
    "rose":        "#E85A9B",
    "indigo":      "#2B2C6B",
    "text":        "#F2F4F7",
    "muted":       "#8B93A1",
}

# Ramp the aurora walks along its length.
RAMP = ["#3BD9C4", "#4FE3C1", "#5AC8E8", "#7C6CF5", "#B364E0", "#E85A9B"]


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1 / 2.4)) - 0.055).astype(np.float32)


def ramp_lookup(t):
    """Sample the aurora ramp at t in [0,1]; returns linear-light RGB."""
    stops = np.stack([srgb_to_linear(hex_rgb(c)) for c in RAMP])   # (N,3)
    n = len(stops) - 1
    t = np.clip(t, 0.0, 1.0) * n
    i = np.clip(np.floor(t).astype(int), 0, n - 1)
    f = (t - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _box1d(a, r, axis):
    """Edge-clamped box blur along one axis via prefix sums. O(n) in radius."""
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    ap = np.pad(a, pad, mode="edge")

    c = np.cumsum(ap, axis=axis, dtype=np.float64)
    zshape = list(c.shape)
    zshape[axis] = 1
    c = np.concatenate([np.zeros(zshape, dtype=np.float64), c], axis=axis)

    n = a.shape[axis]
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    return ((c[tuple(hi)] - c[tuple(lo)]) / (2 * r + 1)).astype(np.float32)


def _boxes_for_gauss(sigma, n=3):
    """Box widths whose n-fold convolution approximates a Gaussian (Kutskir)."""
    if sigma <= 0:
        return [1] * n
    w_ideal = math.sqrt((12 * sigma * sigma / n) + 1)
    wl = int(math.floor(w_ideal))
    if wl % 2 == 0:
        wl -= 1
    wu = wl + 2
    m_ideal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
    m = int(round(m_ideal))
    return [wl if i < m else wu for i in range(n)]


def blur(a, radius):
    """Gaussian-equivalent blur of a float32 2-D array.

    PIL's GaussianBlur refuses mode 'F' buffers, and we need to stay in float
    because the aurora is accumulated as linear light well above 1.0.
    """
    a = a.astype(np.float32, copy=False)
    for w in _boxes_for_gauss(float(radius)):
        r = (w - 1) // 2
        a = _box1d(a, r, 0)
        a = _box1d(a, r, 1)
    return a


def smooth_noise(w, h, scale, seed, octaves=3):
    """Cheap fBm: stack of upsampled low-res random fields, in [0,1]."""
    rng = np.random.default_rng(seed)
    total = np.zeros((h, w), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        lw = max(2, int(w / (scale / (2 ** o))))
        lh = max(2, int(h / (scale / (2 ** o))))
        low = rng.random((lh, lw)).astype(np.float32)
        up = np.asarray(
            Image.fromarray(low, mode="F").resize((w, h), Image.BICUBIC),
            dtype=np.float32,
        )
        total += up * amp
        norm += amp
        amp *= 0.5
    return np.clip(total / norm, 0.0, 1.0)


def tpdf_dither(shape, seed):
    """Triangular-PDF dither, +/- 0.5 LSB. Kills banding in dark gradients."""
    rng = np.random.default_rng(seed)
    a = rng.random(shape, dtype=np.float32)
    b = rng.random(shape, dtype=np.float32)
    return (a - b) / 255.0


# --------------------------------------------------------------------------
# Aurora field
# --------------------------------------------------------------------------

def render_aurora(cfg, seed=7):
    """Accumulate the aurora ribbons into a linear-light RGB buffer."""
    xs = np.linspace(0.0, 1.0, W, dtype=np.float32)
    ys = np.linspace(0.0, 1.0, H, dtype=np.float32)
    Y = ys[:, None]

    light = np.zeros((H, W, 3), dtype=np.float32)

    # Domain warp so the ribbons never look like clean sine waves.
    warp = (smooth_noise(W, H, 620, seed + 41) - 0.5) * cfg.get("warp", 0.030)

    for ri, rb in enumerate(cfg["ribbons"]):
        # --- the bright lower edge: harmonics keep it from reading as a sine
        yc = np.full(W, rb["y"], dtype=np.float32)
        for (amp, freq, phase) in rb["waves"]:
            yc = yc + amp * np.sin(2 * math.pi * freq * xs + phase)

        # --- edge sharpness breathes along the ribbon ---------------------
        sig = rb["sigma"] * (
            1.0 + rb.get("swell", 0.45) * np.sin(2 * math.pi * rb.get("swellf", 0.8) * xs + rb.get("swellp", 1.3))
        )
        sig = np.maximum(sig, 0.002).astype(np.float32)

        # u > 0 is BELOW the edge (y grows downward), u < 0 is above it.
        u = (Y - yc[None, :] + warp) / sig[None, :]

        # --- ray noise: the vertical striation that makes it read as aurora
        cseed = seed + 100 + ri
        fine = smooth_noise(W, 8, 26, cseed)[0]
        mid = smooth_noise(W, 8, 85, cseed + 9)[0]
        broad = smooth_noise(W, 8, 300, cseed + 17)[0]
        rays1d = np.clip(0.30 * fine + 0.42 * mid + 0.45 * broad, 0, 1) ** rb.get("ray_pow", 1.5)
        rays1d = (0.18 + 1.05 * rays1d).astype(np.float32)

        # Perspective fan: ray spacing widens with height, as though the
        # curtain recedes to a vanishing point below the frame. Without this
        # the striations read as a flat barcode.
        y_edge = float(np.mean(yc))
        h_above = np.clip(y_edge - ys, 0.0, 1.0)[:, None]
        fan = 1.0 + rb.get("fan", 0.40) * h_above
        xi = (0.5 + (xs[None, :] - 0.5) / fan) * (W - 1)
        rays2d = rays1d[np.clip(np.rint(xi), 0, W - 1).astype(np.int32)]

        # Ray length varies across the ribbon so the curtain has silhouette.
        tail = rb["tail"] * (0.45 + 1.05 * broad).astype(np.float32)

        # Sharp cutoff below the edge, long striated tail above it.
        below = np.exp(-0.5 * (np.maximum(u, 0) / rb.get("under", 0.75)) ** 2)
        above = np.exp(-np.maximum(-u, 0) / tail[None, :])
        band = np.where(u > 0, below, above).astype(np.float32)

        # Striation fades in as we climb the tail, leaving the edge unbroken.
        climb = np.clip(np.maximum(-u, 0) / (0.35 * tail[None, :]), 0, 1)
        band = band * (1.0 - climb * (1.0 - rays2d))

        # A hot filament riding the edge itself.
        band = band + rb.get("core", 0.55) * np.exp(-0.5 * (u / 0.45) ** 2)

        # --- ceiling: rays must die out before they reach the clock --------
        ceiling = rb.get("ceiling", cfg.get("ceiling"))
        if ceiling is not None:
            f = np.clip((ys - ceiling) / rb.get("ceil_soft", cfg.get("ceil_soft", 0.20)), 0.0, 1.0)
            band = band * (f * f * (3.0 - 2.0 * f))[:, None]

        # --- fade the ribbon out at the frame edges -----------------------
        x0, x1 = rb.get("x0", -0.18), rb.get("x1", 1.18)
        env = np.clip(np.sin(math.pi * np.clip((xs - x0) / (x1 - x0), 0, 1)) ** 0.55, 0, 1)
        band = band * env[None, :].astype(np.float32)

        # --- colour walks the ramp along the ribbon's length --------------
        t = np.clip(xs * rb.get("ramp_span", 1.0) + rb.get("ramp_off", 0.0), 0.0, 1.0)
        colour = ramp_lookup(t)                                   # (W,3) linear
        light += band[..., None] * colour[None, :, :] * rb["gain"]

    # --- bloom: derived from the cores, added ONCE ------------------------
    # (Blurring `light` back into itself compounds and turns the whole frame
    #  into pastel fog, so the source is snapshotted first.)
    bloom_r = cfg.get("bloom", 60)
    if bloom_r:
        src = light.copy()
        gain = cfg.get("bloom_gain", 0.28)
        for c in range(3):
            near = blur(src[..., c], bloom_r)
            far = blur(src[..., c], bloom_r * 3.4)
            light[..., c] += near * gain + far * gain * 0.65

    # --- high, faint wisp for depth ---------------------------------------
    if cfg.get("haze", 0):
        haze = smooth_noise(W, H, 900, seed + 77)
        falloff = np.exp(-((ys - cfg.get("haze_y", 0.35)) ** 2) / (2 * 0.16 ** 2))[:, None]
        hz = (haze * falloff * cfg["haze"]).astype(np.float32)
        light += hz[..., None] * srgb_to_linear(hex_rgb("#5E6BD8"))[None, None, :]

    # --- starfield ---------------------------------------------------------
    if cfg.get("stars", 0):
        rng = np.random.default_rng(seed + 5)
        n = cfg["stars"]
        sx = rng.integers(0, W, n)
        sy = (rng.power(0.7, n) * H * 0.72).astype(int)          # biased upward
        mag = (rng.random(n) ** 3.2).astype(np.float32) * 0.5
        star = np.zeros((H, W), dtype=np.float32)
        np.add.at(star, (sy, sx), mag)
        star = blur(star, 1.1) + blur(star, 3.5) * 0.35
        light += star[..., None] * np.array([0.85, 0.90, 1.0], dtype=np.float32)

    return light


def finish(light, cfg, seed=7, out_path=None):
    """Ambient + vignette + tonemap + grain + dither -> 8-bit PNG."""
    ys = np.linspace(0.0, 1.0, H, dtype=np.float32)
    xs = np.linspace(0.0, 1.0, W, dtype=np.float32)

    # Ambient base: a whisper of colour lift toward the bottom of the frame.
    base_lin = srgb_to_linear(hex_rgb(cfg.get("base", PALETTE["base"])))
    lift = (ys ** 2.4)[:, None, None] * cfg.get("lift", 0.010)
    ambient = base_lin[None, None, :] + lift * srgb_to_linear(hex_rgb("#2A3550"))[None, None, :]
    light = light + ambient

    # Vignette — pulls the eye to the aurora, hides the corners.
    if cfg.get("vignette", 0.55):
        vx = (xs - 0.5)[None, :]
        vy = (ys - 0.52)[:, None]
        r = np.sqrt(vx * vx * 1.0 + vy * vy * 0.42)
        vig = 1.0 - cfg.get("vignette", 0.55) * np.clip(r / 0.72, 0, 1) ** 2.1
        light = light * vig[..., None].astype(np.float32)

    # Extended Reinhard: highlight cores roll into white instead of clipping.
    wpt = cfg.get("white", 2.6)
    light = (light * (1.0 + light / (wpt * wpt))) / (1.0 + light)

    rgb = linear_to_srgb(light)

    # Fine grain, strongest in the mids — reads as texture, not noise.
    if cfg.get("grain", 0.0035):
        rng = np.random.default_rng(seed + 3)
        g = rng.normal(0, 1, (H, W)).astype(np.float32)
        g = blur(g, 0.6)
        lum = rgb.mean(axis=2)
        mask = np.clip(1.0 - np.abs(lum - 0.35) / 0.55, 0.15, 1.0)
        rgb = rgb + (g * mask)[..., None] * cfg.get("grain", 0.0035)

    rgb = rgb + tpdf_dither((H, W, 3), seed + 11)
    out = np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8)

    im = Image.fromarray(out, "RGB")
    if out_path:
        im.save(out_path, "PNG", optimize=True)
    return im


# --------------------------------------------------------------------------
# Wallpaper variants
# --------------------------------------------------------------------------

def wave(a, f, p):
    return (a, f, p)


VARIANTS = {
    # Lock screen: the top 45% is held near-black so the clock, date and
    # notification stack sit on clean ground. Curtains rise from the lower
    # third and the sharp lower edge keeps the shortcut row dark.
    "lock": dict(
        warp=0.010,
        ribbons=[
            dict(y=0.735, sigma=0.010, tail=17.0, gain=0.90, core=0.55, ray_pow=1.45,
                 waves=[wave(0.052, 0.9, 0.4), wave(0.019, 2.1, 2.2), wave(0.008, 4.3, 5.1)],
                 ramp_span=0.85, ramp_off=0.00, swell=0.50),
            dict(y=0.818, sigma=0.013, tail=13.0, gain=0.72, core=0.45, ray_pow=1.6,
                 waves=[wave(0.044, 0.75, 2.6), wave(0.017, 1.9, 0.5)],
                 ramp_span=0.95, ramp_off=0.28, swell=0.42, swellf=1.1),
            dict(y=0.902, sigma=0.019, tail=9.0, gain=0.46, core=0.35, ray_pow=1.7,
                 waves=[wave(0.030, 0.6, 4.4)],
                 ramp_span=0.70, ramp_off=0.50, swell=0.36, swellf=0.6),
        ],
        ceiling=0.375, ceil_soft=0.235,
        haze=0.013, haze_y=0.52, stars=1500, bloom=58, bloom_gain=0.26,
        vignette=0.58, white=2.6, lift=0.010,
    ),

    # Home screen: same world pushed lower and dimmer, so a 5x6 icon grid
    # keeps contrast all the way down the page.
    "home": dict(
        warp=0.009,
        ribbons=[
            dict(y=0.866, sigma=0.011, tail=15.0, gain=0.58, core=0.40, ray_pow=1.5,
                 waves=[wave(0.042, 0.8, 1.4), wave(0.016, 2.0, 3.2)],
                 ramp_span=0.90, ramp_off=0.05, swell=0.45),
            dict(y=0.938, sigma=0.015, tail=10.0, gain=0.46, core=0.32, ray_pow=1.65,
                 waves=[wave(0.032, 0.65, 3.6)],
                 ramp_span=0.95, ramp_off=0.34, swell=0.40, swellf=1.0),
        ],
        ceiling=0.560, ceil_soft=0.230,
        haze=0.010, haze_y=0.68, stars=1000, bloom=64, bloom_gain=0.24,
        vignette=0.50, white=2.9, lift=0.007, grain=0.003,
    ),

    # Full-bleed variant — app drawer, alternate wallpaper, desktop.
    "ambient": dict(
        warp=0.012,
        ribbons=[
            dict(y=0.520, sigma=0.009, tail=19.0, gain=0.88, core=0.55, ray_pow=1.4,
                 waves=[wave(0.055, 1.0, 1.1), wave(0.020, 2.4, 4.0), wave(0.009, 4.9, 2.0)],
                 ramp_span=0.85, ramp_off=0.00, swell=0.55),
            dict(y=0.618, sigma=0.012, tail=15.0, gain=0.76, core=0.48, ray_pow=1.5,
                 waves=[wave(0.048, 0.8, 3.1), wave(0.018, 1.8, 1.7)],
                 ramp_span=1.00, ramp_off=0.24, swell=0.48, swellf=1.2),
            dict(y=0.722, sigma=0.016, tail=11.0, gain=0.56, core=0.38, ray_pow=1.6,
                 waves=[wave(0.038, 0.7, 0.2)],
                 ramp_span=0.90, ramp_off=0.44, swell=0.42, swellf=0.9),
            dict(y=0.852, sigma=0.023, tail=8.0, gain=0.34, core=0.28, ray_pow=1.75,
                 waves=[wave(0.026, 0.55, 2.9)],
                 ramp_span=0.62, ramp_off=0.60, swell=0.32),
        ],
        ceiling=0.120, ceil_soft=0.230,
        haze=0.024, haze_y=0.30, stars=2000, bloom=56, bloom_gain=0.28,
        vignette=0.55, white=2.4, lift=0.012,
    ),
}


def render_aod(path):
    """
    Always-On Display: true black, minimal lit pixels. Only a thin aurora
    filament near the lower third so the panel draws almost nothing.
    """
    cfg = dict(
        warp=0.005,
        ribbons=[
            dict(y=0.725, sigma=0.0055, tail=9.0, gain=0.60, core=0.60, ray_pow=1.6,
                 waves=[wave(0.030, 0.8, 1.2), wave(0.010, 2.0, 3.4)],
                 ramp_span=1.0, ramp_off=0.05, swell=0.55),
        ],
        ceiling=0.545, ceil_soft=0.150,
        haze=0.0, stars=0, bloom=34, bloom_gain=0.18,
        vignette=0.70, white=2.0, lift=0.0, grain=0.0,
        base="#000000",
    )
    light = render_aurora(cfg, seed=19)
    return finish(light, cfg, seed=19, out_path=path)


# --------------------------------------------------------------------------
# KWGT widget reference layers
# --------------------------------------------------------------------------

def font(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


def rgba(hex_s, a=255):
    r, g, b = [int(hex_s.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return (r, g, b, a)


def soft_shadow(layer, radius=20, opacity=0.80):
    """Blurred dark copy behind the layer so type stays legible on any hue."""
    a = layer.split()[3].filter(ImageFilter.GaussianBlur(radius))
    a = a.point(lambda v: min(255, int(v * opacity * 1.7)))
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(a)
    return Image.alpha_composite(sh, layer)


def frosted_panel(size, radius, fill=(20, 26, 34, 150), border=(255, 255, 255, 40)):
    """A glass card: translucent fill, 1px light top-edge, soft outer border."""
    w, h = size
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, outline=border, width=2)
    # Specular top edge — the detail that sells "glass".
    hi = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.rounded_rectangle([2, 2, w - 3, h - 3], radius=radius - 2, outline=(255, 255, 255, 70), width=2)
    grad = np.zeros((h, w), dtype=np.float32)
    grad[:] = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None] ** 2.6
    ha = np.asarray(hi.split()[3], dtype=np.float32) * grad
    hi.putalpha(Image.fromarray(ha.astype(np.uint8), "L"))
    return Image.alpha_composite(card, hi)


def _text_at(d, xy, text, fnt, fill):
    """Draw with the glyph ink box pinned to xy, and return its size."""
    bb = d.textbbox((0, 0), text, font=fnt)
    d.text((xy[0] - bb[0], xy[1] - bb[1]), text, font=fnt, fill=fill)
    return bb[2] - bb[0], bb[3] - bb[1]


def widget_clock(path, pad=48):
    """Stacked hour/minute, hairline rule with accent dot, date beneath."""
    im = Image.new("RGBA", (1200, 900), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    f_h = font("Jura-Light.ttf", 320)
    f_m = font("Jura-Medium.ttf", 320)
    f_date = font("GeistMono-Regular.ttf", 34)

    x0, y0 = pad, pad
    _, h1 = _text_at(d, (x0, y0), "09", f_h, rgba(PALETTE["text"], 238))
    y = y0 + h1 + 40
    w2, h2 = _text_at(d, (x0, y), "41", f_m, rgba(PALETTE["teal"], 250))

    y = y + h2 + 54
    rule_w = max(430, w2 + 150)
    d.line([(x0 + 16, y), (x0 + rule_w, y)], fill=rgba(PALETTE["outline"], 235), width=3)
    d.ellipse([x0 - 1, y - 8, x0 + 15, y + 8], fill=rgba(PALETTE["rose"], 255))

    _text_at(d, (x0, y + 32), "TUESDAY, 13 AUGUST", f_date, rgba(PALETTE["muted"], 225))

    im = soft_shadow(im, radius=26, opacity=0.7)
    bb = im.getbbox()
    im = im.crop((max(0, bb[0] - 8), max(0, bb[1] - 8), bb[2] + 8, bb[3] + 8))
    im.save(path, "PNG", optimize=True)
    return im


def widget_weather(path):
    """Frosted weather pill."""
    w, h = 620, 210
    panel = frosted_panel((w, h), 46)
    d = ImageDraw.Draw(panel)

    f_temp = font("Jura-Light.ttf", 108)
    f_cond = font("Outfit-Regular.ttf", 36)
    f_meta = font("GeistMono-Regular.ttf", 26)

    # Glyph: a crescent + stars, drawn rather than iconfont'd.
    cx, cy = 108, 105
    d.ellipse([cx - 46, cy - 46, cx + 46, cy + 46], fill=rgba(PALETTE["teal"], 235))
    d.ellipse([cx - 22, cy - 62, cx + 70, cy + 30], fill=(14, 17, 22, 255))
    for (sx, sy, sr) in [(178, 62, 5), (196, 96, 3), (166, 116, 3)]:
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=rgba(PALETTE["text"], 210))

    d.text((236, 34), "18°", font=f_temp, fill=rgba(PALETTE["text"], 245))
    d.text((432, 62), "Clear", font=f_cond, fill=rgba(PALETTE["muted"], 225))
    d.text((434, 112), "H 24  L 14", font=f_meta, fill=rgba(PALETTE["muted"], 175))

    panel.save(path, "PNG", optimize=True)
    return panel


def widget_battery(path):
    """Circular arc gauge with an aurora-graded sweep."""
    S = 360
    SS = 4                      # supersample for clean arc edges
    im = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    pad = 26 * SS
    box = [pad, pad, S * SS - pad, S * SS - pad]
    width = 16 * SS

    d.arc(box, start=135, end=405, fill=rgba(PALETTE["outline"], 190), width=width)

    # Grade the live arc by drawing it in short segments along the ramp.
    pct = 0.78
    start, sweep = 135, 270 * pct
    segs = 90
    for i in range(segs):
        a0 = start + sweep * (i / segs)
        a1 = start + sweep * ((i + 1) / segs) + 0.8
        c = ramp_lookup(np.array(i / segs, dtype=np.float32) * 0.8)
        col = tuple(int(v * 255) for v in linear_to_srgb(c))
        d.arc(box, start=a0, end=a1, fill=col + (255,), width=width)

    im = im.resize((S, S), Image.LANCZOS)
    d2 = ImageDraw.Draw(im)
    f_pct = font("Jura-Light.ttf", 92)
    f_lbl = font("GeistMono-Regular.ttf", 22)
    t = "78"
    bb = d2.textbbox((0, 0), t, font=f_pct)
    d2.text(((S - (bb[2] - bb[0])) / 2 - bb[0], 118), t, font=f_pct, fill=rgba(PALETTE["text"], 240))
    bb2 = d2.textbbox((0, 0), "BATTERY", font=f_lbl)
    d2.text(((S - (bb2[2] - bb2[0])) / 2 - bb2[0], 212), "BATTERY", font=f_lbl, fill=rgba(PALETTE["muted"], 200))

    im.save(path, "PNG", optimize=True)
    return im


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    wp_dir = os.path.join(ROOT, "wallpapers")
    wg_dir = os.path.join(ROOT, "widgets")
    pv_dir = os.path.join(ROOT, "preview")
    for p in (wp_dir, wg_dir, pv_dir):
        os.makedirs(p, exist_ok=True)

    rendered = {}
    for name, cfg in VARIANTS.items():
        path = os.path.join(wp_dir, f"{name}_1440x3088.png")
        print(f"  rendering {name} ...", flush=True)
        light = render_aurora(cfg, seed={"lock": 7, "home": 23, "ambient": 61}[name])
        rendered[name] = finish(light, cfg, seed={"lock": 7, "home": 23, "ambient": 61}[name], out_path=path)

    print("  rendering aod ...", flush=True)
    rendered["aod"] = render_aod(os.path.join(wp_dir, "aod_1440x3088.png"))

    print("  rendering widgets ...", flush=True)
    widget_clock(os.path.join(wg_dir, "clock.png"))
    widget_weather(os.path.join(wg_dir, "weather.png"))
    widget_battery(os.path.join(wg_dir, "battery.png"))

    # Downscaled copies for the preview page.
    for name, im in rendered.items():
        im.resize((W // 4, H // 4), Image.LANCZOS).save(
            os.path.join(pv_dir, f"{name}_small.jpg"), "JPEG", quality=88, optimize=True)

    with open(os.path.join(ROOT, "palette.json"), "w") as fh:
        json.dump({"name": "Obsidian Aurora", "device": "Samsung Galaxy S23 Ultra",
                   "resolution": [W, H], "palette": PALETTE, "auroraRamp": RAMP}, fh, indent=2)

    print("done.")


if __name__ == "__main__":
    main()
