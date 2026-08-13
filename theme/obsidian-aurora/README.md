# Obsidian Aurora

A premium dark theme built for the **Samsung Galaxy S23 Ultra** — near-black obsidian ground with an
iridescent teal → violet → rose aurora, frosted-glass surfaces, and a light geometric type stack.

Everything is rendered at the panel's native **1440 × 3088 (WQHD+, 19.3:9)** and tuned to the specific
quirks of this display:

- **True black costs nothing.** The base sits at `#07080B` and the AOD variant is pure `#000000`, so
  unlit pixels are genuinely off. The AOD lights well under 10% of the panel.
- **Light is accumulated in linear space**, not sRGB, so the glow reads as emitted light instead of
  the chalky wash you get from blending gradients in gamma space.
- **Dark gradients band badly on 8-bit AMOLED.** Every render is dithered (TPDF, ±0.5 LSB) before
  quantisation, which is why you won't see contour rings in the dark upper half.
- **Composition follows the UI.** The lock wallpaper is held near-black across the top 45% so the
  clock and notification stack sit on clean ground; the home variant is pushed lower and dimmer so a
  4×4 icon grid keeps contrast all the way down.

---

## What's in the box

```
wallpapers/
  lock_1440x3088.png      Lock screen — dark top, curtains rising through the lower third
  home_1440x3088.png      Home screen — dimmer, pushed low, icon-safe
  ambient_1440x3088.png   Full-bleed variant — app drawer, alternate, desktop
  aod_1440x3088.png       Always-On Display — true black, single thin filament
widgets/
  clock.png               Stacked hour/minute + hairline + date
  weather.png             Frosted weather pill
  battery.png             Gradient arc gauge
  placement.json          Exact fonts, sizes, colours, bindings and coordinates
preview/
  screen_lock.jpg         Full composites — what it looks like assembled
  screen_home.jpg
  screen_quick.jpg
palette.json              Every colour token in the system
tools/
  generate.py             Wallpaper + widget renderer (re-run to retune)
  mockup.py               Screen compositor
```

---

## Quick start (about 10 minutes)

1. **Set the panel to WQHD+** — Settings → Display → Screen resolution → **WQHD+ (1440 × 3088)**.
   The wallpapers are cut for exactly this. At FHD+ they still downscale cleanly, but you're leaving
   sharpness on the table on a screen this good.
2. **Apply the wallpapers** — Settings → Wallpaper and style → Change wallpapers → Gallery. Set
   `lock_1440x3088.png` to the lock screen and `home_1440x3088.png` to the home screen.
   Turn **Wallpaper services → None** first, or One UI will layer its own effects over them.
   Because the files match the panel exactly, decline any crop it offers.
3. **Kill the lock-screen dim** — Settings → Wallpaper and style → uncheck *Dim wallpaper when
   Always On Display is on*, and turn off any "blur" on the lock wallpaper. The gradient is doing the
   work; One UI's dim just muddies it.
4. **Set the colour palette** — Settings → Wallpaper and style → Colour palette → **Basic colours**,
   then pick the swatch closest to `#4FE3C1`. For exact control, use Theme Park (below).
5. **Install the fonts** (optional but it's most of the character) — Jura, Outfit and Geist Mono are
   all free and open-licence on Google Fonts.

That gets you 80% of the look. The rest is below.

---

## Full setup

### 1 · Colour — Theme Park

Samsung's own Themes store only accepts themes built and signed through Galaxy Themes Studio and
published to the store, so a hand-built `.apk` theme can't be sideloaded onto a retail phone.
**Theme Park**, part of Samsung's official **Good Lock** suite, is the supported route to the same
result — and it gives finer colour control than the stock palette picker.

Install **Good Lock** from the Galaxy Store, then add the **Theme Park** module.

1. Theme Park → **Create theme** → choose `home_1440x3088.png` as the source image.
2. It extracts a palette automatically. Open the palette editor and override the key slots:

   | Slot | Hex | Role |
   |---|---|---|
   | Primary | `#4FE3C1` | Toggles, sliders, active states, cursor |
   | Secondary | `#7C6CF5` | Selected chips, secondary accents |
   | Tertiary | `#E85A9B` | Badges, alerts, the accent dot |
   | Background | `#07080B` | System background |
   | Surface | `#0E1116` | Cards, sheets, dialogs |
   | Surface variant | `#151A21` | Raised surfaces, quick-panel tiles |
   | Outline | `#232A34` | Dividers, hairlines, borders |
   | On-surface | `#F2F4F7` | Primary text |
   | On-surface muted | `#8B93A1` | Secondary text, labels |

3. Set the theme to **Dark mode only** so One UI never tries to derive a light variant — the palette
   is built for dark and a generated light version will look wrong.
4. Apply, then reboot. Some system surfaces only re-tint after a restart.

### 2 · Type

| Role | Face | Where |
|---|---|---|
| Display | **Jura Light / Medium** | Clock digits, battery %, temperature |
| UI | **Outfit Regular / Bold** | Titles, app labels, tile labels |
| Mono | **Geist Mono Regular** | Date line, small-caps metadata |

Samsung only accepts fonts as signed font packages, so for the *system* font either buy a Jura or
Outfit package from the Galaxy Store, or use **[F]ont** / Theme Park's font section on a rooted
device. On an unrooted phone the practical move is: leave the system font as **One UI Sans**, and use
Jura and Geist Mono only inside KWGT widgets, where custom `.ttf` files load freely. That's where the
type actually shows.

### 3 · Icons

The mockups use a **monochrome line-and-dot set on glass squircles**. To match without a third-party
launcher, Theme Park's icon section will re-tint stock icons to the palette. For the full look, run
**Nova Launcher** or **Niagara Launcher** with a pack that has these properties:

- thin, uniform stroke weight (~6px at 216px)
- geometric, not skeuomorphic
- a single accent hue per icon rather than multicolour
- squircle or no background at all

Packs that fit the brief: **Caelus**, **Delta**, **Lines**, **Reev Pro**, **Whicons** (white-only).
Set the icon accent to cycle through `#4FE3C1`, `#7C6CF5`, `#E85A9B`, `#5AC8E8`, `#B364E0` if the pack
supports per-icon tinting.

### 4 · Lock screen — LockStar

Good Lock → **LockStar**:

- Clock: **hidden** (the KWGT clock replaces it — otherwise you get two clocks)
- Shortcuts: two, bottom corners, `#4FE3C1` left and `#E85A9B` right
- Notification style: **card**, transparency ~35%, corner radius max
- Turn off the "shadow behind clock" — the widget carries its own shadow

### 5 · Always-On Display — ClockFace

Good Lock → **ClockFace** → AOD:

- Background image: `aod_1440x3088.png`
- Clock: minimal digital, `#F2F4F7`, positioned in the upper third
- Brightness: low — the filament is designed to read at minimum brightness

This variant deliberately lights almost nothing. On an AMOLED panel, an AOD that fills the screen
with colour is a real battery cost; this one isn't.

### 6 · Quick panel — QuickStar

Good Lock → **QuickStar**:

- Active toggle colour: `#4FE3C1`
- Inactive toggle: `#151A21` at ~59% opacity
- Status bar icons: `#F2F4F7`
- Background transparency: ~62% with blur on — the composite in `preview/screen_quick.jpg` is 62%
  scrim over a 34px blur, which is what makes the aurora read behind the tiles without fighting them

### 7 · Home grid — Home Up

Good Lock → **Home Up** → Home screen:

- Grid: **4 × 5** (the mockup shows 4 × 4 plus a widget row)
- Icon size: 216px equivalent
- Dock: 5 icons, background on, transparency ~66%, corner radius max
- App drawer: vertical scroll, `ambient_1440x3088.png` as the drawer background

### 8 · Widgets — KWGT

`widgets/placement.json` carries the full spec: every font, size, colour, opacity, offset and KWGT
binding (`$df(hh)$`, `$wi(temp)$`, `$bi(level)$`).

Two ways to use it:

- **Rebuild in KWGT** (recommended — the widgets stay live). Create a blank widget, then add the
  layers listed in `placement.json` in order. Coordinates are given in px at 1440 × 3088 and as
  resolution-independent fractions.
- **Import the PNGs as bitmap layers** for the parts that never change (the hairline, the accent dot,
  the arc track), and put live text on top. Faster, but the PNGs show a fixed 09:41 / 18° / 78%, so
  don't use them for the values themselves.

Placement on the lock screen: clock at `(108, 300)`, weather at `(108, 1090)`.
On home: clock at `(96, 230)` scaled to 72%, battery arc at `(984, 300)`, weather at `(96, 900)`.

---

## Palette reference

| Token | Hex | Use |
|---|---|---|
| `base` | `#07080B` | System background, wallpaper ground |
| `surface` | `#0E1116` | Cards, sheets, dialogs |
| `surfaceAlt` | `#151A21` | Raised surfaces, quick-panel tiles |
| `outline` | `#232A34` | Dividers, hairlines, borders |
| `teal` | `#4FE3C1` | **Primary** — active states, toggles, minutes |
| `violet` | `#7C6CF5` | Secondary accent |
| `rose` | `#E85A9B` | Tertiary accent, badges |
| `indigo` | `#2B2C6B` | Deep shadow tint |
| `text` | `#F2F4F7` | Primary text |
| `muted` | `#8B93A1` | Secondary text |

Aurora ramp (the gradient the curtains walk along, left to right):
`#3BD9C4` → `#4FE3C1` → `#5AC8E8` → `#7C6CF5` → `#B364E0` → `#E85A9B`

---

## Retuning it

```bash
pip install Pillow numpy
python3 tools/generate.py    # wallpapers + widgets  (~2 min)
python3 tools/mockup.py      # full-screen composites
```

The compositions live in `VARIANTS` in `tools/generate.py`. Per ribbon:

| Key | Effect |
|---|---|
| `y` | Height of the bright lower edge (0 = top, 1 = bottom) |
| `sigma` | Edge sharpness — smaller is crisper |
| `tail` | Ray length above the edge, in units of `sigma` |
| `gain` | Brightness |
| `core` | Intensity of the hot filament riding the edge |
| `ray_pow` | Striation contrast — higher is more separated rays |
| `fan` | Perspective spread of the rays toward the top |
| `ceiling` | Height where rays fade out completely (keeps the clock zone dark) |
| `ramp_off` | Where this ribbon starts along the colour ramp |

Want it calmer? Drop `gain` and raise `ceiling`. Want it bolder? Raise `core` and `bloom_gain`.
To re-colour the whole theme, edit `RAMP` — everything else follows from it.

---

## Notes

- These are wallpapers, widget specs and a palette, applied through Samsung's own supported
  customisation tools. Nothing here needs root, and nothing modifies system files.
- Good Lock is region-limited in the Galaxy Store. If it doesn't appear for you, it's tied to the
  store's country setting rather than the device.
- The preview composites are renders showing the intended result, not screenshots from a phone.
