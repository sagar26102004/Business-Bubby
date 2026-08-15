"""Generate the Play Store feature graphic (1024x500) from the app icon.

Play requires a feature graphic and there is no iOS equivalent, so nothing in the
build produces one. This script composes it from the same source of truth as the
icon so the banner can never drift from the launcher mark: re-run it after any
icon change.

    python scripts/make-feature-graphic.py

Output: docs/play-store/play-feature-graphic-1024x500.png

Two Play rules are baked into the layout and must survive any edit:
  * No alpha channel. The file is flattened to RGB before saving.
  * Nothing important within ~8% of any edge. Play crops this image differently
    on different surfaces, and text that touches the edge gets clipped.
Also policy, not taste: the feature graphic must not contain screenshots of the
app.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "assets" / "icon.png"
OUT = ROOT / "docs" / "play-store" / "play-feature-graphic-1024x500.png"

W, H = 1024, 500
BG = (0, 0, 0)
FG = (255, 255, 255)
MUTED = (176, 176, 176)
FAINT = (122, 122, 122)

# Matches the icon and the splash background (app.json -> splash + adaptiveIcon).
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REG = "C:/Windows/Fonts/segoeui.ttf"


def main() -> None:
    canvas = Image.new("RGB", (W, H), BG)

    # The mark, left of the wordmark. The icon is already white-on-black, so it
    # sits on the canvas seamlessly with no masking needed.
    mark = Image.open(ICON).convert("RGB").resize((236, 236), Image.LANCZOS)
    canvas.paste(mark, (86, (H - 236) // 2))

    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_BOLD, 92)
    tagline = ImageFont.truetype(FONT_REG, 38)
    strip = ImageFont.truetype(FONT_REG, 27)

    x = 372
    draw.text((x, 132), "One Place", font=title, fill=FG)
    draw.text((x + 4, 250), "Your neighbourhood, in one app", font=tagline, fill=MUTED)
    draw.text(
        (x + 4, 306),
        "Shops  ·  Services  ·  Rentals  ·  Stalls",
        font=strip,
        fill=FAINT,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}  {canvas.size}  mode={canvas.mode}")


if __name__ == "__main__":
    main()
