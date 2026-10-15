"""Build the Candle Battles runtime atlas from the supplied art.

The fighter board is an illustrated reference sheet rather than a regular
Phaser grid. The crop boxes below intentionally exclude its baked labels.
Frames are alpha-trimmed and padded on a common transparent canvas so their
feet share a baseline without stretching the original artwork.
"""
import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path

from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("archive", type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
out = root / "wwwroot/games/candle-battles/assets"
source = Path(__file__).parent / "source"
source.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)

z = zipfile.ZipFile(a.archive)
prefix = "CandleBattles_Assets/"
base = z.read(prefix + "assets/sprites/characters/source/candle_fighters_base.png")
(source / "candle_fighters_base.png").write_bytes(base)
im = Image.open(io.BytesIO(base)).convert("RGBA")
face = im.crop((61, 132, 94, 172))
# Keep only the dark facial ink for the small financial doji fallback.
for y in range(face.height):
    for x in range(face.width):
        r, g, b, alpha = face.getpixel((x, y))
        ink = max(0, min(1, (125 - max(r, g, b)) / 65))
        face.putpixel((x, y), (5, 18, 19, round(alpha * ink)))
face = face.crop(face.getbbox())

blocks = Image.open(io.BytesIO(z.read(prefix + "assets/sprites/blocks/source/territory_tiles.png"))).convert("RGBA")
vfx = Image.open(io.BytesIO(z.read(prefix + "assets/sprites/effects/source/combat_vfx.png"))).convert("RGBA")
items = {
    "face": face,
    "tile-left": blocks.crop((46, 190, 176, 320)),
    "tile-right": blocks.crop((46, 405, 176, 535)),
    "impact-left": vfx.crop((16, 10, 166, 170)),
    "impact-right": vfx.crop((16, 164, 166, 324)),
}
hud = Image.open(io.BytesIO(z.read(prefix + "assets/sprites/ui/source/hud_icons.png"))).convert("RGBA")
items["logo-BTC"] = hud.crop((29, 45, 219, 245))
items["logo-ETH"] = hud.crop((223, 45, 416, 245))

# Top and bottom rows are the two team colour variants. Each action group has
# three subcells: neutral, buy/up and sell/down. Different actions have
# different group widths, so use reviewed row/group metadata rather than a
# fixed-size sprite-sheet assumption.
extended_bytes = z.read(prefix + "assets/sprites/characters/source/candle_fighters_extended.png")
(source / "candle_fighters_extended.png").write_bytes(extended_bytes)
extended = Image.open(io.BytesIO(extended_bytes)).convert("RGBA")
action_rows = {
    # The lower edge of every tuple stops before the baked action label.
    "run": ((0, 164, 8), (646, 762, 8)),
    "punch": ((195, 317, 6), (805, 918, 6)),
    "break": ((350, 472, 8), (951, 1071, 8)),
    "recover": ((500, 613, 3), (1104, 1214, 3)),
}
directions = ("neutral", "up", "down")


def padded_frame(image: Image.Image, size=(200, 200)) -> Image.Image:
    """Preserve aspect ratio and place the original feet on one baseline."""
    image = image.crop(image.getbbox() or (0, 0, 1, 1))
    scale = min(size[0] / image.width, size[1] / image.height, 1.0)
    if scale < 1:
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new("RGBA", size)
    canvas.alpha_composite(image, ((size[0] - image.width) // 2, size[1] - image.height - 3))
    return canvas


for action, team_rows in action_rows.items():
    for team, (y0, y1, count) in enumerate(team_rows):
        group_width = extended.width / count
        for frame in range(count):
            x0 = round(frame * group_width)
            x1 = round((frame + 1) * group_width)
            for variant, direction in enumerate(directions):
                vx0 = x0 + round((x1 - x0) * variant / 3)
                vx1 = x0 + round((x1 - x0) * (variant + 1) / 3)
                tile = extended.crop((vx0, y0, vx1, y1))
                side = "left" if team == 0 else "right"
                items[f"fighter-{side}-{direction}-{action}-{frame + 1}"] = padded_frame(tile)

atlas_width = 1536
atlas_height = 256 * ((len(items) + 6) // 7)
atlas = Image.new("RGBA", (atlas_width, atlas_height))
frames = {}
x = 4
y = 4
for name, image in items.items():
    if x + image.width + 4 > atlas_width:
        x = 4
        y += 256
    atlas.alpha_composite(image, (x, y))
    frames[name] = {
        "frame": {"x": x, "y": y, "w": image.width, "h": image.height},
        "rotated": False,
        "trimmed": False,
        "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height},
        "sourceSize": {"w": image.width, "h": image.height},
    }
    x += image.width + 8

atlas.save(out / "modular.png", optimize=True)
(out / "modular.json").write_text(
    json.dumps({"frames": frames, "meta": {"image": "modular.png", "size": {"w": atlas.width, "h": atlas.height}, "scale": "1"}}, indent=2)
)

audio = []
for entry in z.infolist():
    relative = entry.filename.removeprefix(prefix)
    if relative.startswith("assets/audio/") and relative.endswith(".wav") and ".." not in Path(relative).parts:
        target = out / relative.removeprefix("assets/")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(z.read(entry))
        audio.append(relative.removeprefix("assets/"))

(out / "manifest.json").write_text(
    json.dumps(
        {
            "atlas": "modular.json",
            "texture": "modular.png",
            "audio": audio,
            "sourceSha256": hashlib.sha256(base).hexdigest(),
            "fighterSourceSha256": hashlib.sha256(extended_bytes).hexdigest(),
            "poses": {"run": 8, "punch": 6, "break": 8, "recover": 3},
            "directions": list(directions),
            "notes": "Fighter action frames are extracted from the approved extended sheet, alpha-trimmed and padded without aspect-ratio deformation. OHLC body and wicks remain financial geometry; unavailable idle/lunge/victory/defeat poses use the closest real action sequence.",
        },
        indent=2,
    )
)
print("Atlas:", len(frames), "frames; fighter:", len(items) - 7, "frames; audio:", len(audio), "files; face:", face.size)
