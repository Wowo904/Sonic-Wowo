from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "icon"
ICONSET = ASSET_DIR / "SonicTopography.iconset"
PNG_PATH = ASSET_DIR / "sonic-topography-icon.png"

ASSET_DIR.mkdir(parents=True, exist_ok=True)
ICONSET.mkdir(parents=True, exist_ok=True)

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

bg = Image.new("RGBA", (SIZE, SIZE), (5, 8, 18, 255))
draw = ImageDraw.Draw(bg)

for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(5 + 14 * t)
    g = int(8 + 18 * t)
    b = int(18 + 38 * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
for radius, alpha, color in [
    (390, 70, (34, 211, 238)),
    (300, 90, (168, 85, 247)),
    (220, 110, (244, 114, 182)),
]:
    g.ellipse(
        (SIZE // 2 - radius, SIZE // 2 - radius, SIZE // 2 + radius, SIZE // 2 + radius),
        outline=(*color, alpha),
        width=20,
    )
glow = glow.filter(ImageFilter.GaussianBlur(28))
bg.alpha_composite(glow)

draw = ImageDraw.Draw(bg)

terrain_layers = [
    (620, 74, (34, 211, 238, 230)),
    (690, 54, (168, 85, 247, 210)),
    (760, 38, (244, 114, 182, 190)),
]

for base, amp, color in terrain_layers:
    points = []
    for x in range(88, 937, 8):
        wave = math.sin(x * 0.020) * amp + math.sin(x * 0.047 + 1.4) * amp * 0.42
        y = base + wave
        points.append((x, y))
    fill_points = points + [(936, 910), (88, 910)]
    draw.polygon(fill_points, fill=(color[0], color[1], color[2], 34))
    draw.line(points, fill=color, width=9, joint="curve")

for x in range(160, 900, 56):
    height = 80 + 90 * (0.5 + 0.5 * math.sin(x * 0.031))
    y1 = 650 - height
    y2 = 650 + height * 0.26
    draw.rounded_rectangle(
        (x - 8, y1, x + 8, y2),
        radius=8,
        fill=(34, 211, 238, 80),
        outline=(34, 211, 238, 160),
        width=2,
    )

for radius, alpha in [(286, 160), (210, 190), (136, 220)]:
    draw.arc(
        (SIZE // 2 - radius, SIZE // 2 - radius, SIZE // 2 + radius, SIZE // 2 + radius),
        start=204,
        end=338,
        fill=(255, 255, 255, alpha),
        width=12,
    )

draw.rounded_rectangle((276, 256, 748, 782), radius=88, outline=(255, 255, 255, 46), width=6)

mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle((40, 40, 984, 984), radius=220, fill=255)

shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow)
shadow_draw.rounded_rectangle((54, 70, 970, 998), radius=220, fill=(0, 0, 0, 110))
shadow = shadow.filter(ImageFilter.GaussianBlur(24))
img.alpha_composite(shadow)

rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rounded.paste(bg, (0, 0), mask)
img.alpha_composite(rounded)

highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
h = ImageDraw.Draw(highlight)
h.rounded_rectangle((56, 52, 968, 970), radius=205, outline=(255, 255, 255, 50), width=5)
img.alpha_composite(highlight)

img.save(PNG_PATH)

sizes = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

for name, size in sizes.items():
    img.resize((size, size), Image.Resampling.LANCZOS).save(ICONSET / name)

print(PNG_PATH)
