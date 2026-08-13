#!/usr/bin/env python3
"""Inlines fonts and imagery into preview/template.html -> preview/index.html.

The Artifact CSP blocks every external host, so nothing may be linked: fonts
and images are embedded as data URIs.
"""

import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = "/mnt/skills/examples/canvas-design/canvas-fonts"
PREVIEW = os.path.join(ROOT, "preview")

ASSETS = {
    "FONT_JURA":        os.path.join(FONT_DIR, "Jura-Light.ttf"),
    "FONT_OUTFIT":      os.path.join(FONT_DIR, "Outfit-Regular.ttf"),
    "FONT_OUTFIT_BOLD": os.path.join(FONT_DIR, "Outfit-Bold.ttf"),
    "FONT_MONO":        os.path.join(FONT_DIR, "GeistMono-Regular.ttf"),
    "S_LOCK":           os.path.join(PREVIEW, "screen_lock.jpg"),
    "S_HOME":           os.path.join(PREVIEW, "screen_home.jpg"),
    "S_QUICK":          os.path.join(PREVIEW, "screen_quick.jpg"),
    "W_LOCK":           os.path.join(PREVIEW, "lock_small.jpg"),
    "W_HOME":           os.path.join(PREVIEW, "home_small.jpg"),
    "W_AMBIENT":        os.path.join(PREVIEW, "ambient_small.jpg"),
    "W_AOD":            os.path.join(PREVIEW, "aod_small.jpg"),
}


def main():
    with open(os.path.join(PREVIEW, "template.html"), encoding="utf-8") as fh:
        html = fh.read()

    # Escape every non-ASCII char to a numeric entity. The published page has
    # no charset declaration of its own, and a raw UTF-8 byte read as Latin-1
    # turns "1440 x 3088" into mojibake.
    html = html.encode("ascii", "xmlcharrefreplace").decode("ascii")

    for key, path in ASSETS.items():
        token = "{{" + key + "}}"
        if token not in html:
            raise SystemExit(f"template is missing placeholder {token}")
        with open(path, "rb") as fh:
            html = html.replace(token, base64.b64encode(fh.read()).decode("ascii"))

    if "{{" in html:
        raise SystemExit("unsubstituted placeholder left in template")

    out = os.path.join(PREVIEW, "index.html")
    with open(out, "w") as fh:
        fh.write(html)
    print(f"wrote {out}  ({os.path.getsize(out) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
