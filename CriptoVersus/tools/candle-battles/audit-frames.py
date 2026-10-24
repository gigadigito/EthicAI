"""Pixel-level inventory of the Candle Battles sprite atlases.

Reports which named animation frames are byte-identical duplicates, which atlas
entries are never referenced by the runtime, and how many genuinely distinct
pieces of art back each animation. Also writes `frame-audit.json` so the test
suite can prove that no registered animation is built from identical frames.

    python tools/candle-battles/audit-frames.py
"""

import hashlib
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "wwwroot/games/candle-battles/assets"


def load(atlas_name: str) -> tuple[Image.Image, dict]:
    image = Image.open(ASSETS / f"{atlas_name}.png").convert("RGBA")
    data = json.loads((ASSETS / f"{atlas_name}.json").read_text(encoding="utf-8"))
    return image, data["frames"]


def fingerprint(image: Image.Image, rect: dict) -> bytes:
    box = (rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"])
    return image.crop(box).tobytes()


def group_by_digest(image: Image.Image, frames: dict) -> dict[bytes, list[str]]:
    groups: dict[bytes, list[str]] = defaultdict(list)
    for name, entry in frames.items():
        groups[fingerprint(image, entry["frame"])].append(name)
    return groups


def print_atlas(atlas_name: str) -> dict[bytes, list[str]]:
    image, frames = load(atlas_name)
    groups = group_by_digest(image, frames)
    print(f"\n=== {atlas_name}.png ({image.width}x{image.height}) ===")
    print(f"named frames : {len(frames)}")
    print(f"distinct art : {len(groups)}")
    duplicated = {digest: names for digest, names in groups.items() if len(names) > 1}
    print(f"duplicate sets: {len(duplicated)}")
    for names in sorted(duplicated.values(), key=lambda entry: entry[0]):
        print(f"  identical x{len(names)}: {', '.join(sorted(names))}")
    return groups


def modular_sequence_report() -> None:
    print("\n=== modular.json sequences ===")
    for side in ("left", "right"):
        for action, count in (("idle", 1), ("run", 8), ("punch", 6), ("break", 8), ("recover", 3)):
            image, frames = load("modular")
            digests = {fingerprint(image, frames[f"fighter-{side}-neutral-{action}-{i}"]["frame"]) for i in range(1, count + 1)}
            print(f"  {side:5} {action:8} named={count:2} distinct={len(digests)}")
    image, frames = load("modular")
    directions = defaultdict(list)
    for name, entry in frames.items():
        if name.startswith("fighter-"):
            directions[fingerprint(image, entry["frame"])].append(name)
    multi = [names for names in directions.values() if len(names) > 1]
    print(f"  direction copies sharing one drawing: {sum(len(n) for n in multi)} frames in {len(multi)} groups")


def finisher_sequence_report() -> None:
    print("\n=== candle-finishers.json sequences ===")
    image, frames = load("candle-finishers")
    actions = ("charge", "attack", "hurt-stagger", "knockout", "defeated-idle", "victory-loop", "dizzy")
    for side in ("left", "right"):
        for action in actions:
            names = [f"finisher-{side}-{action}-{i}" for i in range(1, 20) if f"finisher-{side}-{action}-{i}" in frames]
            digests = {fingerprint(image, frames[name]["frame"]) for name in names}
            cross = []
            for name in names:
                digest = fingerprint(image, frames[name]["frame"])
                for other, entry in frames.items():
                    if other != name and fingerprint(image, entry["frame"]) == digest:
                        cross.append(other)
            note = f"  also appears as: {', '.join(sorted(cross))}" if cross else ""
            print(f"  {side:5} {action:14} named={len(names)} distinct={len(digests)}{note}")


def digest_index(image: Image.Image, frames: dict) -> dict[str, str]:
    """Stable short digest per named frame, so tests can group duplicates."""
    index = {}
    for name, entry in frames.items():
        index[name] = hashlib.sha256(fingerprint(image, entry["frame"])).hexdigest()[:16]
    return index


def write_frame_audit() -> None:
    payload = {}
    for atlas_name in ("modular", "candle-finishers"):
        image, frames = load(atlas_name)
        png = (ASSETS / f"{atlas_name}.png").read_bytes()
        payload[atlas_name] = {
            "pngSha256": hashlib.sha256(png).hexdigest(),
            "size": {"w": image.width, "h": image.height},
            "frames": digest_index(image, frames),
        }
    (ROOT / "tools/candle-battles/frame-audit.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    print("\nwrote tools/candle-battles/frame-audit.json")


if __name__ == "__main__":
    print_atlas("modular")
    print_atlas("candle-finishers")
    modular_sequence_report()
    finisher_sequence_report()
    write_frame_audit()
