"""Extract single-character action frames from the approved base sheet.

The extended sheet places three fighters in overlapping triptychs. Cropping
those cells directly leaves parts of the neighbouring fighter in motion.
"""

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source/candle_fighters_base.png"
ATLAS = ROOT / "wwwroot/games/candle-battles/assets/modular.png"
ATLAS_DATA = ATLAS.with_suffix(".json")

POSES = {
    "idle": (23, 65, 113, 220),
    "walk_a": (22, 276, 98, 393),
    "walk_b": (332, 276, 405, 393),
    "lunge": (634, 260, 754, 393),
    "punch": (6, 438, 100, 582),
    "hit": (331, 438, 385, 582),
    "victory": (778, 438, 852, 582),
}
SEQUENCES = {
    "run": ("walk_a", "walk_b", "lunge", "walk_b", "walk_a", "walk_b", "lunge", "walk_b"),
    "punch": ("idle", "walk_b", "punch", "idle", "walk_b", "punch"),
    "break": ("idle",) * 8,
    "recover": ("hit", "victory", "idle"),
}


def single_fighter_frames(base: Image.Image) -> dict[str, Image.Image]:
    frames = {}
    for side, y_offset in (("left", 0), ("right", 620)):
        for action, poses in SEQUENCES.items():
            for index, pose in enumerate(poses, 1):
                x0, y0, x1, y1 = POSES[pose]
                tile = base.crop((x0, y0 + y_offset, x1, y1 + y_offset))
                tile = tile.resize((round(tile.width * .7), round(tile.height * .7)), Image.Resampling.LANCZOS)
                canvas = Image.new("RGBA", (200, 200))
                canvas.alpha_composite(tile, ((200 - tile.width) // 2, 197 - tile.height))
                for direction in ("neutral", "up", "down"):
                    frames[f"fighter-{side}-{direction}-{action}-{index}"] = canvas
    return frames


if __name__ == "__main__":
    base = Image.open(SOURCE).convert("RGBA")
    atlas = Image.open(ATLAS).convert("RGBA")
    metadata = json.loads(ATLAS_DATA.read_text())
    for name, frame in single_fighter_frames(base).items():
        rectangle = metadata["frames"][name]["frame"]
        atlas.paste(frame, (rectangle["x"], rectangle["y"]))
    atlas.save(ATLAS, optimize=True)
    print("Updated single-character action frames in", ATLAS)
