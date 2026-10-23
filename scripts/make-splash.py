"""Render transparent native launch wordmarks. Run from the repo root.

The OS knows light/dark appearance, not the saved Aoi palette. Theme artwork
belongs to the React splash after preferences hydrate.
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 512, 512
FONT = "/System/Library/Fonts/Helvetica.ttc"


def render(fg, out):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 160, index=0)
    bbox = d.textbbox((0, 0), "aoi", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((W - tw) / 2 - bbox[0], (H - th) / 2 - bbox[1]), "aoi", font=font, fill=fg)
    img.save(out)
    print("wrote", out, img.size)


render("#2C1C2B", "assets/images/splash.png")
render("#F6EDF3", "assets/images/splash-dark.png")
