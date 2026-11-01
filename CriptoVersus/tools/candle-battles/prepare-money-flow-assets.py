"""Curate the user-supplied Money Flow collector art into a Phaser atlas.

The supplied PNGs are illustrated boards, not regular sprite sheets.  Every
source has reviewed row/column metadata and is cleaned before it is placed on a
fixed logical canvas.  Runtime code only consumes the generated atlas.

    python tools/candle-battles/prepare-money-flow-assets.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source" / "money-flow"
ASSETS = ROOT / "wwwroot" / "games" / "candle-battles" / "assets"
ATLAS_WIDTH = 2048
ATLAS_LIMIT = 2048

SOURCE_NAMES = {
    "financial-effects-composite.png": "Sprite Sheet de Efeitos Financeiros Pixelados-2.png",
    "financial-effects-numbered.png": "Sprite Sheet de Efeitos Financeiros Pixel Art-1.png",
    "demon-steal-directions.png": "Imagem do ChatGPT 1 de nov. de 2026, 13_52_42-2.png",
    "angel-grab-directions.png": "Imagem do ChatGPT 1 de nov. de 2026, 13_52_11-3.png",
    "angel-carry-loop.png": "Imagem do ChatGPT 1 de nov. de 2026, 13_52_12-4.png",
    "demon-tug-tableau.png": "Imagem do ChatGPT 1 de nov. de 2026, 13_52_10-2.png",
    "demon-run-loop.png": "Imagem do ChatGPT 1 de nov. de 2026, 13_52_10-1.png",
    "money-bag-squash.png": "Faixa de Sprites_ Sacos de Dinheiro Pixelados.png",
}


def load(name: str) -> Image.Image:
    path = SOURCE / name
    if not path.exists():
        raise FileNotFoundError(f"Missing Money Flow source: {path}")
    return Image.open(path).convert("RGBA")


def clean_alpha(image: Image.Image, threshold: int) -> Image.Image:
    """Remove board haze while retaining the opaque pixel-art silhouette."""
    result = image.copy()
    pixels = result.load()
    for y in range(result.height):
        for x in range(result.width):
            r, g, b, alpha = pixels[x, y]
            if alpha < threshold:
                pixels[x, y] = (r, g, b, 0)
    alpha = result.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        return Image.new("RGBA", (1, 1))
    return result.crop(bounds)


def logical_frame(
    image: Image.Image,
    size: tuple[int, int],
    *,
    threshold: int = 24,
    bottom: int = 6,
    max_fill: float = 0.92,
) -> Image.Image:
    image = clean_alpha(image, threshold)
    available_w = max(1, round(size[0] * max_fill))
    available_h = max(1, round((size[1] - bottom) * max_fill))
    scale = min(available_w / image.width, available_h / image.height, 1.0)
    if scale < 1:
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new("RGBA", size)
    canvas.alpha_composite(image, ((size[0] - image.width) // 2, size[1] - bottom - image.height))
    return canvas


def grid(image: Image.Image, columns: int, rows: int) -> list[list[Image.Image]]:
    """Reviewed source layout only; content is still alpha-trimmed per cell."""
    cell_w = image.width / columns
    cell_h = image.height / rows
    return [
        [
            image.crop((round(column * cell_w), round(row * cell_h), round((column + 1) * cell_w), round((row + 1) * cell_h)))
            for column in range(columns)
        ]
        for row in range(rows)
    ]


def effect_row(
    image: Image.Image,
    y0: int,
    y1: int,
    count: int,
    *,
    x0: int = 250,
    x1: int = 1530,
) -> list[Image.Image]:
    width = (x1 - x0) / count
    return [
        image.crop((round(x0 + index * width), y0, round(x0 + (index + 1) * width), y1))
        for index in range(count)
    ]


items: dict[str, Image.Image] = {}
animations: dict[str, list[str]] = {}


def add_sequence(name: str, frames: list[Image.Image], *, size=(200, 200), threshold=24) -> list[str]:
    names = []
    for index, frame in enumerate(frames, 1):
        frame_name = f"{name}-{index}"
        items[frame_name] = logical_frame(frame, size, threshold=threshold)
        names.append(frame_name)
    animations[name] = names
    return names


# Angel boards: top row travels right; bottom row is reviewed in reverse for
# leftward travel.  Temporal reversal is never used at runtime.
angel_grab = grid(load("angel-grab-directions.png"), 8, 2)
angel_right = angel_grab[0]
angel_left = list(reversed(angel_grab[1]))
add_sequence("angel-empty-right", angel_right[:3], threshold=96)
add_sequence("angel-empty-left", angel_left[:3], threshold=96)
add_sequence("angel-grab-right", angel_right[3:7], threshold=96)
add_sequence("angel-grab-left", angel_left[3:7], threshold=96)

angel_carry = grid(load("angel-carry-loop.png"), 6, 2)
add_sequence("angel-carry-right", angel_carry[0])
add_sequence("angel-carry-left", list(reversed(angel_carry[1])))

# Demon board provides explicit emerge/approach/grab/descend poses.  Runtime
# state boundaries reference these forward-playing sequences.
demon_steal = grid(load("demon-steal-directions.png"), 8, 2)
demon_right = demon_steal[0]
demon_left = list(reversed(demon_steal[1]))
for direction, row in (("right", demon_right), ("left", demon_left)):
    add_sequence(f"demon-emerge-{direction}", row[:3], threshold=72)
    add_sequence(f"demon-approach-{direction}", row[1:4], threshold=72)
    add_sequence(f"demon-grab-{direction}", row[3:6], threshold=72)
    add_sequence(f"demon-descend-{direction}", row[5:8], threshold=72)

demon_run = grid(load("demon-run-loop.png"), 6, 2)
add_sequence("demon-run-right", demon_run[0])
add_sequence("demon-run-left", list(reversed(demon_run[1])))

tug = load("demon-tug-tableau.png")
items["demon-tug"] = logical_frame(tug, (400, 200), threshold=24, max_fill=0.96)
animations["demon-tug"] = ["demon-tug"]

bag_board = grid(load("money-bag-squash.png"), 4, 1)[0]
add_sequence("bag-squash", bag_board, size=(128, 128), threshold=24)

# The composite board has evenly spaced strips without frame-number pills.  The
# numbered board remains the timing reference recorded in source-manifest.json.
effects = load("financial-effects-composite.png")
effects_numbered = load("financial-effects-numbered.png")
add_sequence("bag-fall", effect_row(effects, 48, 250, 12, x0=0, x1=1536), size=(128, 128), threshold=72)
add_sequence("positive-coins", effect_row(effects, 318, 515, 8, x0=0, x1=768), size=(128, 128), threshold=72)
add_sequence("negative-arrows", effect_row(effects, 318, 515, 8, x0=768, x1=1536), size=(128, 128), threshold=72)
add_sequence("infernal-pit", effect_row(effects, 575, 680, 10, x0=0, x1=1536), size=(128, 128), threshold=64)
add_sequence("bag-burn", effect_row(effects_numbered, 255, 415, 12), size=(128, 128), threshold=88)


def pack(selected: dict[str, Image.Image]) -> tuple[Image.Image, dict]:
    atlas = Image.new("RGBA", (ATLAS_WIDTH, ATLAS_LIMIT))
    frames: dict[str, dict] = {}
    x = 4
    y = 4
    row_height = 0
    for name, image in selected.items():
        if x + image.width + 4 > ATLAS_WIDTH:
            x = 4
            y += row_height + 8
            row_height = 0
        if y + image.height + 4 > ATLAS_LIMIT:
            raise RuntimeError("Money Flow collector atlas exceeds 2048x2048; split the atlas before reducing art quality")
        atlas.alpha_composite(image, (x, y))
        frames[name] = {
            "frame": {"x": x, "y": y, "w": image.width, "h": image.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height},
            "sourceSize": {"w": image.width, "h": image.height},
        }
        x += image.width + 8
        row_height = max(row_height, image.height)
    used_height = y + row_height + 4
    return atlas.crop((0, 0, ATLAS_WIDTH, used_height)), frames


ASSETS.mkdir(parents=True, exist_ok=True)
collector_items = {name: image for name, image in items.items() if name.startswith(("angel-", "demon-"))}
effect_items = {name: image for name, image in items.items() if name not in collector_items}
outputs = {}
for atlas_name, selected in (("money-flow-collectors", collector_items), ("money-flow-effects", effect_items)):
    atlas, frames = pack(selected)
    atlas_path = ASSETS / f"{atlas_name}.png"
    json_path = ASSETS / f"{atlas_name}.json"
    atlas.save(atlas_path, optimize=True)
    atlas_animations = {
        name: sequence for name, sequence in animations.items()
        if sequence and sequence[0] in selected
    }
    json_path.write_text(
        json.dumps(
            {
                "frames": frames,
                "meta": {
                    "image": atlas_path.name,
                    "size": {"w": atlas.width, "h": atlas.height},
                    "scale": "1",
                    "animations": atlas_animations,
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    outputs[atlas_name] = {
        "frames": len(frames), "width": atlas.width, "height": atlas.height,
        "bytes": atlas_path.stat().st_size,
    }

source_manifest = {
    name: {
        "originalName": original,
        "sha256": hashlib.sha256((SOURCE / name).read_bytes()).hexdigest(),
        "runtimeSource": True,
    }
    for name, original in SOURCE_NAMES.items()
}
(SOURCE / "source-manifest.json").write_text(
    json.dumps(source_manifest, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps(outputs, indent=2))
