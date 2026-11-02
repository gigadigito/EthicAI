"""Curate the user-supplied Money Flow art into validated Phaser atlases.

The supplied PNGs are illustrated boards, not regular sprite sheets.  Frames are
located per row by transparent-gap detection (never by blindly dividing a row
into equal cells), alpha-trimmed inside their own cell so neighbouring art can
never bleed in, and normalised with ONE scale per sequence so characters do not
grow or shrink between frames.

Runtime code only consumes the generated atlases plus `money-flow-catalog.json`,
which records pivots, phase ranges and per-frame provenance.

    python tools/candle-battles/prepare-money-flow-assets.py
    python tools/candle-battles/prepare-money-flow-assets.py --check   # validate only

Originals under `source/money-flow/` are never modified.  The newest effects
board is preferred automatically: `financial-effects-composite-v2.png` when
present, otherwise `financial-effects-composite.png`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source" / "money-flow"
ASSETS = ROOT / "wwwroot" / "games" / "candle-battles" / "assets"
CATALOG = Path(__file__).parent / "money-flow-catalog.json"
ATLAS_WIDTH = 2048
ATLAS_LIMIT = 2048

# Only truly empty alpha is discarded.  Semi-transparent glow (flame, halo,
# wings) is art and must survive into the atlas.
ALPHA_FLOOR = 3

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


class Validation:
    """Collects asset-level defects so a build cannot silently ship bad art."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


CHECK = Validation()


def newest_effects_board() -> Path:
    """Prefer a corrected effects board when the artist supplies one."""
    for candidate in ("financial-effects-composite-v2.png", "financial-effects-composite.png"):
        path = SOURCE / candidate
        if path.exists():
            return path
    raise FileNotFoundError(f"Missing Money Flow effects board in {SOURCE}")


def load(name: str) -> Image.Image:
    path = SOURCE / name
    if not path.exists():
        raise FileNotFoundError(f"Missing Money Flow source: {path}")
    return strip_label_pills(Image.open(path).convert("RGBA"), name)


def alpha_array(image: Image.Image) -> np.ndarray:
    return np.array(image.convert("RGBA"))[:, :, 3]


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of non-empty alpha, preserving soft glow."""
    alpha = alpha_array(image)
    mask = alpha > ALPHA_FLOOR
    if not mask.any():
        return None
    ys = np.nonzero(mask.any(axis=1))[0]
    xs = np.nonzero(mask.any(axis=0))[0]
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


# The boards carry dark-teal caption pills ("BOLSA QUEIMANDO / ...").  On some
# rows the pill shares the art band, so it has to be removed before frames are
# located or it ends up baked into the first sprites of the sequence.
LABEL_TEAL = lambda r, g, b, al: (r < 80) & (g >= 20) & (g < 95) & (b >= 30) & (b < 115) & (al > 200)


def strip_label_pills(image: Image.Image, label: str) -> Image.Image:
    """Erase caption pills so they can never be cropped into a sprite frame."""
    rgba = np.array(image.convert("RGBA")).astype(int)
    r, g, b, al = (rgba[:, :, i] for i in range(4))
    teal = LABEL_TEAL(r, g, b, al)
    if teal.sum() < 400:
        return image
    rows = np.nonzero(teal.any(axis=1))[0]
    groups: list[tuple[int, int]] = []
    start = prev = int(rows[0])
    for y in rows[1:]:
        if y > prev + 6:
            groups.append((start, prev))
            start = int(y)
        prev = int(y)
    groups.append((start, prev))

    out = rgba.copy()
    removed = 0
    for y0, y1 in groups:
        # A caption pill is a wide, short rounded bar.  Requiring that shape
        # keeps character art (tall silhouettes, halos, shadows) untouched.
        if (y1 - y0) > 48:
            continue
        band = teal[y0:y1 + 1]
        cols = np.nonzero(band.any(axis=0))[0]
        if cols.size == 0:
            continue
        runs: list[tuple[int, int]] = []
        s = p = int(cols[0])
        for x in cols[1:]:
            if x > p + 25:
                runs.append((s, p))
                s = int(x)
            p = int(x)
        runs.append((s, p))
        for x0, x1 in runs:
            if (x1 - x0) < 150:
                continue
            out[y0 - 2:y1 + 3, x0 - 2:x1 + 3, 3] = 0
            removed += 1
            CHECK.warn(f"{label}: stripped caption pill x={x0}..{x1} y={y0}..{y1}")
    return Image.fromarray(out.astype(np.uint8), "RGBA") if removed else image


def trim(image: Image.Image) -> Image.Image:
    box = content_bbox(image)
    if box is None:
        return Image.new("RGBA", (1, 1))
    return image.crop((box[0], box[1], box[2] + 1, box[3] + 1))


def split_profile(profile: np.ndarray, expected: int) -> list[tuple[int, int]]:
    """Cut a row into `expected` frames at content minima near equal spacing.

    Evenly dividing a row is wrong whenever the artist spaced poses by size, so
    every internal boundary starts from an even estimate and then snaps to the
    emptiest column inside a bounded window.  When transparent gaps exist the
    snap lands inside them, which reproduces exact gap detection; when glow
    merges two drawings the snap still falls between them.  This is what keeps
    neighbouring frames out of one another's crops.

    Splitting is confined to the occupied span so boundaries can never fall
    inside the leading or trailing transparent margin.
    """
    n = len(profile)
    if expected <= 1:
        return [(0, n)]
    occupied = np.nonzero(profile > 0)[0]
    if occupied.size == 0:
        return [(0, n)]
    lo = int(occupied[0])
    hi = int(occupied[-1]) + 1
    span = hi - lo
    if span < expected:
        return [(i * n // expected, (i + 1) * n // expected) for i in range(expected)]

    spacing = span / expected
    reach = max(1, round(spacing * .34))
    boundaries = [lo]
    for index in range(1, expected):
        guess = lo + round(index * spacing)
        window_lo = max(boundaries[-1] + 1, guess - reach)
        window_hi = min(hi - 1, guess + reach + 1)
        if window_hi <= window_lo:
            cut = guess
        else:
            cut = window_lo + int(np.argmin(profile[window_lo:window_hi]))
        cut = max(boundaries[-1] + 1, min(cut, hi - (expected - index)))
        boundaries.append(cut)
    boundaries.append(hi)
    segments = list(zip(boundaries[:-1], boundaries[1:]))
    # Close the unoccupied margins back onto the first and last real frame.
    segments[0] = (0, segments[0][1])
    segments[-1] = (segments[-1][0], n)
    return segments


def detect_frames(
    image: Image.Image,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    expected: int,
    label: str,
) -> tuple[list[Image.Image], str]:
    """Locate frames by content-minima splitting, then trim each inside its cell.

    Trimming is bounded by the cell so art from a neighbouring frame can never
    bleed into the crop, and soft alpha (glow, wings, flame) is preserved.
    """
    band = np.array(image.convert("RGBA"))[y0:y1 + 1, x0:x1, 3]
    profile = (band > ALPHA_FLOOR).sum(axis=0)
    segments = split_profile(profile, expected)

    # Also measure true transparent gaps, for reporting only.
    gaps = 0
    run = 0
    for value in profile:
        if value == 0:
            run += 1
        else:
            if run >= 3:
                gaps += 1
            run = 0
    method = f"minima ({gaps} gaps / {expected} frames)"
    if gaps < expected - 1:
        CHECK.warn(f"{label}: {expected - 1 - gaps} frame boundary/ies are merged by glow; split at content minima")

    frames = [image.crop((a + x0, y0, b + x0, y1 + 1)) for a, b in segments]
    for index, frame in enumerate(frames, 1):
        if content_bbox(frame) is None:
            CHECK.error(f"{label}-{index}: frame is empty after split (wrong frame count or row band)")
    return frames, method


def normalize_sequence(
    frames: list[Image.Image],
    canvas: tuple[int, int],
    pivot: tuple[float, float],
    label: str,
) -> list[Image.Image]:
    """One scale and one anchor for the whole sequence.

    `pivot` is the normalised anchor of the *content* that must stay put: the
    feet for ground characters, the body centre for fliers.  Scaling is derived
    from the largest frame so nothing overflows and no frame is rescaled alone.
    """
    width, height = canvas
    trimmed = [trim(frame) for frame in frames]
    boxes = [content_bbox(t) for t in trimmed]
    valid = [(t, b) for t, b in zip(trimmed, boxes) if b is not None]
    if not valid:
        CHECK.error(f"{label}: every frame is empty")
        return [Image.new("RGBA", canvas) for _ in frames]

    max_w = max(b[2] - b[0] + 1 for _, b in valid)
    max_h = max(b[3] - b[1] + 1 for _, b in valid)
    margin = 4
    scale = min((width - 2 * margin) / max_w, (height - 2 * margin) / max_h, 1.0)

    out: list[Image.Image] = []
    for index, image in enumerate(trimmed):
        if boxes[index] is None:
            out.append(Image.new("RGBA", canvas))
            continue
        if scale < 1.0:
            new_w = max(1, round(image.width * scale))
            new_h = max(1, round(image.height * scale))
            image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # The pivot is a normalised point of the drawing.  It is pinned to the
        # same normalised point of the canvas, so every frame of the sequence
        # shares one anchor and the subject cannot drift or rescale.
        in_x = round((image.width - 1) * pivot[0])
        in_y = round((image.height - 1) * pivot[1])
        to_x = round((width - 1) * pivot[0])
        to_y = round((height - 1) * pivot[1])

        canvas_img = Image.new("RGBA", canvas)
        canvas_img.alpha_composite(image, (to_x - in_x, to_y - in_y))
        out.append(canvas_img)

        # A frame whose art is sliced by the canvas edge is a bad crop.  The
        # canvas sits at (1,1) inside the padded probe, so legal content spans
        # 1..canvas[0] / 1..canvas[1].
        padded = Image.new("RGBA", (canvas[0] + 2, canvas[1] + 2))
        padded.alpha_composite(canvas_img, (1, 1))
        edge = content_bbox(padded)
        if edge and (edge[0] <= 0 or edge[1] <= 0 or edge[2] > canvas[0] or edge[3] > canvas[1]):
            CHECK.warn(f"{label}-{index + 1}: art touches the canvas edge (possible crop)")
    return out


def sequence_report(label: str, frames: list[Image.Image], *, allow_shrink: bool = False) -> None:
    digests = [hashlib.sha256(f.tobytes()).hexdigest() for f in frames]
    duplicates = {d: [i + 1 for i, g in enumerate(digests) if g == d] for d in set(digests)}
    dupes = {d: idx for d, idx in duplicates.items() if len(idx) > 1}
    if dupes:
        CHECK.warn(f"{label}: identical frames {sorted(dupes.values())}")
    if allow_shrink:
        return
    boxes = [content_bbox(f) for f in frames]
    widths = [b[2] - b[0] + 1 for b in boxes if b]
    heights = [b[3] - b[1] + 1 for b in boxes if b]
    if widths and max(widths) > 0 and (max(widths) - min(widths)) / max(widths) > .45:
        CHECK.warn(f"{label}: content width jumps {min(widths)}..{max(widths)}px")
    if heights and max(heights) > 0 and (max(heights) - min(heights)) / max(heights) > .45:
        CHECK.warn(f"{label}: content height jumps {min(heights)}..{max(heights)}px")


items: dict[str, Image.Image] = {}
animations: dict[str, list[str]] = {}
catalog_sequences: dict[str, dict] = {}


def add_sequence(
    name: str,
    frames: list[Image.Image],
    *,
    canvas: tuple[int, int] = (128, 128),
    pivot: tuple[float, float] = (.5, 1.0),
    tag: str | None = None,
) -> list[str]:
    names = []
    placed = normalize_sequence(frames, canvas, pivot, name)
    for index, frame in enumerate(placed, 1):
        frame_name = f"{name}-{index}"
        items[frame_name] = frame
        names.append(frame_name)
    animations[name] = names
    catalog_sequences[name] = {
        "frames": names,
        "canvas": {"w": canvas[0], "h": canvas[1]},
        "pivot": {"x": pivot[0], "y": pivot[1]},
        "count": len(names),
    }
    if tag:
        catalog_sequences[name]["tag"] = tag
    sequence_report(name, placed, allow_shrink=tag in ("terminal", "absorbed", "ground", "landing", "aerial"))
    return names


# --------------------------------------------------------------------------
# Reviewed source layout.  Row/column bands are artistic facts of each board;
# frames inside them are located by gap detection wherever the art allows it.
# --------------------------------------------------------------------------

effects_board = newest_effects_board()
effects = load(effects_board.name)
effects_origin = effects_board.name

# Row 1: winged money bag falling (12).  Aerial phase must show no ground
# impact, so the plate-bearing tail frames are catalogued separately.
fall_frames, fall_method = detect_frames(effects, 45, 256, 0, 1536, 12, "bag-fall")
add_sequence("bag-fall", fall_frames, canvas=(112, 152), pivot=(.5, 1.0), tag="aerial")

# Row 2 left: positive coins / plus signs (8).
pos_frames, pos_method = detect_frames(effects, 320, 525, 0, 768, 8, "positive-coins")
add_sequence("positive-coins", pos_frames, canvas=(112, 132), pivot=(.5, 1.0))

# Row 2 right: negative arrows / minus signs (8).
neg_frames, neg_method = detect_frames(effects, 320, 525, 768, 1536, 8, "negative-arrows")
add_sequence("negative-arrows", neg_frames, canvas=(112, 132), pivot=(.5, 1.0))

# Row 3: infernal pit (10).  Band starts at the rim, not mid-flame.
pit_frames, pit_method = detect_frames(effects, 527, 668, 0, 1536, 10, "infernal-pit")
add_sequence("infernal-pit", pit_frames, canvas=(152, 112), pivot=(.5, 1.0), tag="ground")

# Row 4: bag falling into the pit (10) - the demon drop-off.
into_frames, into_method = detect_frames(effects, 722, 856, 0, 1536, 10, "bag-into-pit")
add_sequence("bag-into-pit", into_frames, canvas=(128, 128), pivot=(.5, 1.0), tag="absorbed")

# Row 5: bag burning / disappearing (8).
burn_frames, burn_method = detect_frames(effects, 872, 1012, 0, 1536, 8, "bag-burn")
add_sequence("bag-burn", burn_frames, canvas=(128, 128), pivot=(.5, 1.0), tag="terminal")

# Landing squash is its own sequence; it is never part of the aerial fall.
squash_board = trim_row = detect_frames(load("money-bag-squash.png"), 115, 622, 0, 2172, 4, "bag-squash")[0]
add_sequence("bag-squash", squash_board, canvas=(128, 128), pivot=(.5, 1.0), tag="landing")


# ---- collectors -----------------------------------------------------------
# Each board holds two narrative rows: top travels right, bottom is the same
# story told leftward.  The bottom row is reversed into forward narrative order
# so real left-facing art is used - animation is never played backwards.

demon_steal = load("demon-steal-directions.png")
demon_right = detect_frames(demon_steal, 241, 453, 0, 1536, 8, "demon-steal-right")[0]
demon_left = list(reversed(detect_frames(demon_steal, 613, 829, 0, 1536, 8, "demon-steal-left")[0]))

# Reviewed pose map over the 8-pose narrative:
#   0 emerge-low, 1 emerge-high, 2 empty-idle, 3 reach,
#   4 grab, 5 carry, 6 stride, 7 descend-into-pit
# Slices are strictly disjoint so no frame is reused across states.
DEMON_POSES = {
    "emerge": (0, 2),    # rise out of the pit, empty-handed
    "idle": (2, 3),      # standing empty beside the bag
    "approach": (3, 4),  # leaning / reaching toward the bag
    "grab": (4, 5),      # hands on the bag at contact
    "carry": (5, 7),     # holding the bag, walking away
    "descend": (7, 8),   # sinking back through the floor
}
for direction, row in (("right", demon_right), ("left", demon_left)):
    for state, (start, end) in DEMON_POSES.items():
        add_sequence(f"demon-{state}-{direction}", row[start:end], canvas=(176, 176), pivot=(.5, 1.0))

demon_run = load("demon-run-loop.png")
for direction, source_row in (("right", 0), ("left", 1)):
    row = detect_frames(demon_run, 17 if source_row == 0 else 385,
                        307 if source_row == 0 else 672, 0, 2172, 6, f"demon-run-{direction}")[0]
    if direction == "left":
        row = list(reversed(row))
    add_sequence(f"demon-run-{direction}", row, canvas=(176, 176), pivot=(.5, 1.0), tag="carrying")

tug = load("demon-tug-tableau.png")
add_sequence("demon-tug", [tug], canvas=(320, 176), pivot=(.5, 1.0))

angel_grab = load("angel-grab-directions.png")
# Top row travels right.  Bottom row is the leftward story, reversed into
# forward narrative order.  Top row glows merge, so it uses the reviewed grid.
angel_right = detect_frames(angel_grab, 0, 425, 0, 1536, 8, "angel-grab-right")[0]
angel_left = list(reversed(detect_frames(angel_grab, 592, 909, 0, 1536, 8, "angel-grab-left")[0]))
# Pose map: 0-1 fly empty, 2 dive, 3 reach, 4 hands-on-bag, 5 lift, 6-7 carry.
ANGEL_POSES = {
    "empty": (0, 2),
    "approach": (2, 4),
    "grab": (4, 5),
    "hold": (5, 6),
    "carry": (6, 8),
}
for direction, row in (("right", angel_right), ("left", angel_left)):
    for state, (start, end) in ANGEL_POSES.items():
        add_sequence(f"angel-{state}-{direction}", row[start:end], canvas=(176, 176), pivot=(.5, .5))

angel_carry = load("angel-carry-loop.png")
for direction, source_row in (("right", 0), ("left", 1)):
    row = detect_frames(angel_carry, 19 if source_row == 0 else 382,
                        300 if source_row == 0 else 662, 0, 2172, 6, f"angel-fly-{direction}")[0]
    if direction == "left":
        row = list(reversed(row))
    add_sequence(f"angel-fly-{direction}", row, canvas=(176, 176), pivot=(.5, .5), tag="carrying")


# --------------------------------------------------------------------------
# Aerial phase ranges: the winged bag must never show a ground impact.
# --------------------------------------------------------------------------
def detect_aerial_frames() -> dict:
    """Frames whose art is free of a wide bottom plate are the aerial phase."""
    names = animations["bag-fall"]
    aerial: list[str] = []
    for name in names:
        image = items[name]
        w, h = image.size
        strip = image.crop((0, h - 18, w, h))
        box = content_bbox(strip)
        if box is None:
            aerial.append(name)
            continue
        span = (box[2] - box[0] + 1) / w
        # A landing plate spans most of the canvas width; a bag body does not.
        if span < .72:
            aerial.append(name)
    if not aerial:
        aerial = names[:1]
    return {
        "flying": aerial,
        "landing": [n for n in names if n not in aerial],
    }


catalog_sequences["bag-fall"]["phases"] = detect_aerial_frames()


# --------------------------------------------------------------------------
# Packing
# --------------------------------------------------------------------------
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
            raise RuntimeError("Money Flow atlas exceeds 2048x2048; split the atlas before reducing art quality")
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


def validate_outputs(outputs: dict) -> None:
    for atlas_name in outputs:
        image = Image.open(ASSETS / f"{atlas_name}.png").convert("RGBA")
        data = json.loads((ASSETS / f"{atlas_name}.json").read_text(encoding="utf-8"))
        seen: set[str] = set()
        for name, entry in data["frames"].items():
            if name in seen:
                CHECK.error(f"{atlas_name}: duplicated frame name {name}")
            seen.add(name)
            rect = entry["frame"]
            crop = image.crop((rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"]))
            if content_bbox(crop) is None:
                CHECK.error(f"{atlas_name}:{name} is an empty frame")
            # Real transparency: the frame must not be a solid rectangle.
            alpha = alpha_array(crop)
            if (alpha > ALPHA_FLOOR).mean() > .985:
                CHECK.error(f"{atlas_name}:{name} has no transparent background")
        for anim, names in data["meta"]["animations"].items():
            missing = [n for n in names if n not in data["frames"]]
            if missing:
                CHECK.error(f"{atlas_name}:{anim} references missing frames {missing}")
            if len(names) < 1:
                CHECK.error(f"{atlas_name}:{anim} is an empty sequence")
        # Every declared sequence must exist in the catalog too.
        if atlas_name.endswith("effects"):
            for anim in data["meta"]["animations"]:
                if anim not in catalog_sequences:
                    CHECK.error(f"catalog is missing sequence {anim}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate existing atlases only")
    args = parser.parse_args()

    if args.check:
        validate_outputs({"money-flow-effects": True, "money-flow-collectors": True})
    else:
        ASSETS.mkdir(parents=True, exist_ok=True)
        collector_items = {n: i for n, i in items.items() if n.startswith(("angel-", "demon-"))}
        effect_items = {n: i for n, i in items.items() if n not in collector_items}
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

        validate_outputs(outputs)

        catalog = {
            "effectsBoard": effects_origin,
            "sequences": catalog_sequences,
            "extraction": {
                "bag-fall": fall_method, "positive-coins": pos_method,
                "negative-arrows": neg_method, "infernal-pit": pit_method,
                "bag-into-pit": into_method, "bag-burn": burn_method,
            },
        }
        CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")

        source_manifest = {
            name: {
                "originalName": original,
                "sha256": hashlib.sha256((SOURCE / name).read_bytes()).hexdigest(),
                "runtimeSource": True,
            }
            for name, original in SOURCE_NAMES.items() if (SOURCE / name).exists()
        }
        if effects_origin != "financial-effects-composite.png":
            source_manifest[effects_origin] = {
                "originalName": "corrected Money Flow effects board",
                "sha256": hashlib.sha256((SOURCE / effects_origin).read_bytes()).hexdigest(),
                "runtimeSource": True,
            }
        (SOURCE / "source-manifest.json").write_text(
            json.dumps(source_manifest, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(json.dumps(outputs, indent=2))

    for message in CHECK.warnings:
        print(f"WARN  {message}")
    for message in CHECK.errors:
        print(f"ERROR {message}")
    print(f"\n{len(CHECK.errors)} error(s), {len(CHECK.warnings)} warning(s)")
    return 1 if CHECK.errors else 0


if __name__ == "__main__":
    sys.exit(main())
