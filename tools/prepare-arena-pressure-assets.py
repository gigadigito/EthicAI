import os
import shutil
from collections import deque

import numpy as np
from PIL import Image

SRC_DIR = r"C:\Users\PCMasterSound\OneDrive\Área de Trabalho\Arena Pressure\arena-pressure-neon-kit\arena-pressure-neon-kit"
ASSETS_SRC = os.path.join(SRC_DIR, "assets")
REF_SRC = os.path.join(SRC_DIR, "reference")
DEST_DIR = r"c:\EthicAI\EthicAI\CriptoVersus\wwwroot\games\arena-pressure\assets"

os.makedirs(DEST_DIR, exist_ok=True)

FRAME_W = 112
FRAME_H = 160

# Neutral pixels in this luminance band are keying residue (the source art was generated
# on a baked checkerboard). Near-white stays art (teeth, sweat drops); dark stays art
# (outlines, boots, gloves).
RESIDUE_LUM_MIN = 150
RESIDUE_LUM_MAX = 232
RESIDUE_SAT_MAX = 32

# Detached debris: thin line fragments and isolated specks are dropped, but any chunky
# detached piece and any bright speck (sweat drops, highlights) stays.
DEBRIS_MAX_PIXELS = 40
DEBRIS_MAX_THICKNESS = 6
BRIGHT_LUM_MIN = 232


def zero_hidden_rgb(arr):
    """Clears colour data under fully transparent pixels so no viewer shows ghost art."""
    hidden = arr[:, :, 3] == 0
    arr[hidden, 0] = 0
    arr[hidden, 1] = 0
    arr[hidden, 2] = 0
    return arr


def neutralize_colored_ring(arr, radius_min=142, radius_max=250):
    """Remove baked orange/cyan pressure coding from the fixed base shell."""
    h, w = arr.shape[:2]
    y, x = np.ogrid[:h, :w]
    radius = np.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2)
    rgb = arr[:, :, :3].astype(np.float32)
    saturation = rgb.max(2) - rgb.min(2)
    orange = (rgb[:, :, 0] > rgb[:, :, 2] * 1.22) & (rgb[:, :, 1] > rgb[:, :, 2] * 1.08)
    cyan = (rgb[:, :, 2] > rgb[:, :, 0] * 1.22) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.08)
    connector_zone = (np.abs(x - w / 2) > 160) & (y >= 200) & (y <= 335)
    side_light_zone = ((x < 48) | (x > 464)) & (y >= 220) & (y <= 295)
    support_zone = y > 432
    mask = (arr[:, :, 3] > 0) & (radius >= radius_min) & (radius <= radius_max)
    mask &= ~(connector_zone & ~side_light_zone) & ~support_zone
    mask &= saturation > 28
    mask &= orange | cyan
    luminance = rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114
    neutral = np.clip(luminance * 0.55, 36, 168)
    arr[mask, :3] = (rgb[mask] * 0.08 + neutral[mask, None] * 0.92).astype(np.uint8)
    return arr


def remove_disc_direction_colors(arr):
    """Remove only the colored chevrons from the rotating mechanical disc."""
    h, w = arr.shape[:2]
    y, x = np.ogrid[:h, :w]
    cx, cy = w / 2, h / 2
    radius = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    rgb = arr[:, :, :3].astype(np.float32)
    saturation = rgb.max(2) - rgb.min(2)
    orange = (rgb[:, :, 0] > rgb[:, :, 2] * 1.22) & (rgb[:, :, 1] > rgb[:, :, 2] * 1.08)
    cyan = (rgb[:, :, 2] > rgb[:, :, 0] * 1.22) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.08)
    mask = (arr[:, :, 3] > 0) & (radius >= 92) & (radius <= 156)
    mask &= (y >= 212) & (y <= 300) & (np.abs(x - cx) >= 82)
    mask &= saturation > 28
    mask &= orange | cyan
    arrow_area = (((x >= 106) & (x <= 196)) | ((x >= 316) & (x <= 406))) & (y >= 232) & (y <= 282)
    arrow_area &= arr[:, :, 3] > 0
    metal = np.broadcast_to((38 + ((np.arange(h)[:, None] - 232) % 9) * 2).astype(np.uint8), (h, w))
    arr[arrow_area, 0] = metal[arrow_area]
    arr[arrow_area, 1] = np.clip(metal[arrow_area].astype(np.int16) + 4, 0, 255).astype(np.uint8)
    arr[arrow_area, 2] = np.clip(metal[arrow_area].astype(np.int16) + 10, 0, 255).astype(np.uint8)
    mask &= ~arrow_area
    # Copy adjacent neutral metal across each side bar so the arrow silhouette disappears.
    shifted = np.roll(arr[:, :, :3], 80, axis=1)
    shifted[:, :80] = arr[:, :80, :3]
    shifted_right = np.roll(arr[:, :, :3], -80, axis=1)
    shifted_right[:, -80:] = arr[:, -80:, :3]
    left = mask & (x < cx)
    right = mask & (x >= cx)
    arr[left, :3] = shifted[left]
    arr[right, :3] = shifted_right[right]
    return arr


def neutral_residue_mask(arr):
    rgb = arr[:, :, :3].astype(np.int16)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    sat = rgb.max(2) - rgb.min(2)
    return (sat < RESIDUE_SAT_MAX) & (lum >= RESIDUE_LUM_MIN) & (lum < RESIDUE_LUM_MAX)


def bright_mask(arr):
    rgb = arr[:, :, :3].astype(np.int16)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    sat = rgb.max(2) - rgb.min(2)
    return (sat < RESIDUE_SAT_MAX) & (lum >= BRIGHT_LUM_MIN)


def flood_from_border(candidate):
    """Marks every candidate pixel reachable from the image border (4-connectivity)."""
    h, w = candidate.shape
    reached = np.zeros((h, w), dtype=bool)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                queue.append((ny, nx))

    return reached


def label_components(mask):
    """4-connected component labels, 0 means background."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx]:
                continue
            current += 1
            labels[sy, sx] = current
            queue = deque([(sy, sx)])
            while queue:
                y, x = queue.popleft()
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = current
                        queue.append((ny, nx))
    return labels, current


def clean_sheet(image_path, side="orange"):
    """
    Removes checkerboard keying residue from the sprite sheets.

    - Halos are neutral mid-grey blobs connected to the transparent background; they are
      removed by a border flood restricted to the residue colour band, so interior art
      (teeth, sweat drops, glove and boot highlights) is never touched.
    - Detached dark debris (stray rope fragments baked into the source art) is dropped.
    """
    img = Image.open(image_path).convert("RGBA")
    arr = np.array(img).copy()

    result = arr.copy()

    residue = neutral_residue_mask(arr)
    background = (arr[:, :, 3] < 20) | residue
    reached = flood_from_border(background)
    drop = reached & residue
    result[drop, 3] = 0

    # Detached debris removal on the remaining opaque pixels. Only thin line fragments
    # (stray rope and ground lines baked into the source art) and isolated specks are
    # dropped. Any chunky detached piece is treated as character art and kept.
    opaque = result[:, :, 3] >= 20
    labels, count = label_components(opaque)
    bright = bright_mask(result)
    for label_id in range(1, count + 1):
        component = labels == label_id
        size = int(component.sum())
        if bright[component].all():
            continue

        ys, xs = np.where(component)
        height = int(ys.max() - ys.min() + 1)
        width = int(xs.max() - xs.min() + 1)
        thin = min(height, width) <= DEBRIS_MAX_THICKNESS
        speck = size <= DEBRIS_MAX_PIXELS
        if not (thin or speck):
            continue

        print(f"    dropped debris: {size}px bbox={width}x{height} at ({xs.min()},{ys.min()})")
        result[component, 3] = 0

    # Defringe: collapse the remaining low-alpha fringe so no grey border survives.
    fringe = (result[:, :, 3] > 0) & (result[:, :, 3] < 20)
    result[fringe, 3] = 0

    rgb = result[:, :, :3].astype(np.int16)
    edge = (result[:, :, 3] > 0) & (result[:, :, 3] < 180)
    sat = rgb.max(2) - rgb.min(2)
    edge_neutral = edge & (sat < RESIDUE_SAT_MAX)
    if side == "orange":
        result[edge_neutral, 0] = np.clip(rgb[edge_neutral, 0] + 30, 0, 255)
        result[edge_neutral, 1] = np.clip(rgb[edge_neutral, 1] * 0.7, 0, 255)
        result[edge_neutral, 2] = np.clip(rgb[edge_neutral, 2] * 0.2, 0, 255)
    else:
        result[edge_neutral, 0] = np.clip(rgb[edge_neutral, 0] * 0.2, 0, 255)
        result[edge_neutral, 1] = np.clip(rgb[edge_neutral, 1] + 20, 0, 255)
        result[edge_neutral, 2] = np.clip(rgb[edge_neutral, 2] + 30, 0, 255)

    result = zero_hidden_rgb(result)
    return Image.fromarray(result, "RGBA")


def clean_hud_asset(image_path):
    img = Image.open(image_path).convert("RGBA")
    arr = np.array(img).copy()
    alpha = arr[:, :, 3]
    arr[alpha < 12, 3] = 0
    return Image.fromarray(zero_hidden_rgb(arr), "RGBA")


def build_concentric_wheel_layers(comp_path):
    """
    Extracts high-res concentric 512x512 layers from arena-neon-composition.png.
    Centre is exactly at (256, 256).
    Layer 1: wheel-base.png (outer gear ring + fixed rope cleats)
    Layer 2: wheel-disc.png (rotating mechanical disc with radial spokes)
    Layer 3: wheel-hub.png (stationary centre cap with crown + rope brackets)
    """
    comp = Image.open(comp_path).convert("RGBA")
    cx, cy = 836.6, 456.1
    half = 256

    raw_wheel = comp.crop((int(round(cx - half)), int(round(cy - half)),
                          int(round(cx + half)), int(round(cy + half))))
    raw_arr = np.array(raw_wheel)

    y, x = np.ogrid[:512, :512]
    dist_from_center = np.sqrt((x - 256) ** 2 + (y - 256) ** 2)

    # 1. WHEEL DISC (rotating radial spokes and rim)
    disc_arr = np.zeros_like(raw_arr)
    disc_mask = (dist_from_center >= 46) & (dist_from_center <= 152)
    disc_arr[disc_mask] = raw_arr[disc_mask]

    inner_feather = np.clip((dist_from_center - 44) / 4.0, 0, 1)
    outer_feather = np.clip((154 - dist_from_center) / 4.0, 0, 1)
    disc_alpha = (disc_mask.astype(float) * inner_feather * outer_feather * 255).astype(np.uint8)
    disc_arr[:, :, 3] = disc_alpha
    disc_arr = zero_hidden_rgb(disc_arr)

    disc_rgb = disc_arr[:, :, :3].astype(float)
    disc_lum = (0.299 * disc_rgb[:, :, 0] + 0.587 * disc_rgb[:, :, 1] + 0.114 * disc_rgb[:, :, 2])
    metal_tint = np.zeros_like(disc_rgb)
    metal_tint[:, :, 0] = disc_lum * 0.95
    metal_tint[:, :, 1] = disc_lum * 0.95
    metal_tint[:, :, 2] = disc_lum * 1.05
    disc_arr[disc_mask, :3] = np.clip(disc_rgb[disc_mask] * 0.4 + metal_tint[disc_mask] * 0.6, 0, 255).astype(np.uint8)
    disc_arr = remove_disc_direction_colors(disc_arr)

    wheel_disc = Image.fromarray(disc_arr, "RGBA")

    # 2. WHEEL HUB (centre cap with crown and cleat connectors)
    hub_arr = np.zeros_like(raw_arr)
    hub_circle_mask = dist_from_center <= 52
    conn_mask = (y >= 238) & (y <= 274) & (x >= 180) & (x <= 332) & (dist_from_center <= 85)
    hub_full_mask = hub_circle_mask | conn_mask
    hub_arr[hub_full_mask] = raw_arr[hub_full_mask]
    hub_alpha = np.where(dist_from_center <= 50, 255, 0).astype(np.uint8)
    hub_alpha[conn_mask] = 255
    hub_arr[:, :, 3] = hub_alpha
    wheel_hub = Image.fromarray(hub_arr, "RGBA")

    # 3. WHEEL BASE (outer gear ring with teeth, LED tiles and fixed rope cleats)
    base_arr = np.zeros_like(raw_arr)
    gear_mask = (dist_from_center >= 148) & (dist_from_center <= 245)
    stand_mask = (y >= 280) & (x >= 140) & (x <= 372) & (dist_from_center <= 255)
    base_full_mask = gear_mask | stand_mask
    base_arr[base_full_mask] = raw_arr[base_full_mask]

    outer_feather_base = np.clip((250 - dist_from_center) / 6.0, 0, 1)
    base_alpha = (base_full_mask.astype(float) * outer_feather_base * 255).astype(np.uint8)
    # The hub cavity must stay clear: the disc and hub layers are what belongs inside.
    # Without this the floor bracket rectangle reads as a black slab behind the disc.
    base_alpha[dist_from_center < 147] = 0
    base_arr[:, :, 3] = base_alpha
    base_arr = neutralize_colored_ring(base_arr)
    wheel_base = Image.fromarray(zero_hidden_rgb(base_arr), "RGBA")

    return wheel_base, wheel_disc, wheel_hub


print("Starting asset processing...")

# 1. Background
shutil.copyfile(os.path.join(ASSETS_SRC, "arena-background.webp"), os.path.join(DEST_DIR, "arena-background.webp"))
print("Copied arena-background.webp")

# 2. Sprite sheets + individual cleaned frames
for sheet, side in (("orange-pull-sheet.png", "orange"), ("cyan-pull-sheet.png", "cyan")):
    cleaned = clean_sheet(os.path.join(ASSETS_SRC, sheet), side)
    cleaned.save(os.path.join(DEST_DIR, sheet), "PNG")
    print(f"Cleaned and saved {sheet}")

    for i in range(8):
        frame = cleaned.crop((i * FRAME_W, 0, (i + 1) * FRAME_W, FRAME_H))
        frame.save(os.path.join(DEST_DIR, f"{side}_{i:02d}.png"), "PNG")
    print(f"Exported 8 cleaned {side} frames")

# 3. Concentric wheel layers
wb, wd, wh = build_concentric_wheel_layers(os.path.join(REF_SRC, "arena-neon-composition.png"))
wb.save(os.path.join(DEST_DIR, "wheel-base.png"), "PNG")
wd.save(os.path.join(DEST_DIR, "wheel-disc.png"), "PNG")
wh.save(os.path.join(DEST_DIR, "wheel-hub.png"), "PNG")
print("Generated concentric 512x512 wheel layers (base, disc, hub)")

# 4. HUD and FX assets
for name in ["arrow-orange.png", "arrow-cyan.png", "hud-crown.png", "hud-orange.png", "hud-cyan.png",
             "effect-sparks.png", "effect-smoke.png", "wheel-orange.png", "wheel-cyan.png"]:
    src = os.path.join(ASSETS_SRC, name)
    if os.path.exists(src):
        clean_hud_asset(src).save(os.path.join(DEST_DIR, name), "PNG")
        print(f"Cleaned and saved {name}")

# 5. Manifest
manifest_content = """{
  "name": "arena-pressure",
  "version": "1.0.0",
  "frameSize": {
    "width": 112,
    "height": 160
  },
  "frames": 8,
  "wheelSize": {
    "width": 512,
    "height": 512,
    "center": [256, 256],
    "ringRadius": 128,
    "ringWidth": 16
  },
  "colors": {
    "left": "#ff9100",
    "right": "#18d8d2",
    "background": "#09111f"
  },
  "sourceArtNotes": "AI generated source art carried a baked checkerboard; background removal is approximate. Feet are cropped at the 160px frame edge and masked by the floor shadow."
}
"""
with open(os.path.join(DEST_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    f.write(manifest_content)
print("Asset preparation completed successfully!")
