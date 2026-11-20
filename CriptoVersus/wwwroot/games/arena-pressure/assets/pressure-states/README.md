# Arena Pressure character states

Four visual pressure levels are available for each team. All 14 PNGs are 2400 × 1056 RGBA with transparent padding and a common bottom anchor. They are grouped character art, not individual animation frames. The existing arena, gauge, and pull animation assets are unchanged.

| Pressure split | Leading side | Trailing side |
| --- | --- | --- |
| 45–55% | `*_state_1_balanced.png` | `*_state_1_balanced.png` |
| 56–70% | `*_state_2_advantage.png` | `*_state_2_pressed.png` |
| 71–85% | `*_state_3_dominant.png` | `*_state_3_struggling.png` |
| 86–100% | `*_state_4_extreme.png` | `*_state_4_collapsed.png` |

Use `buy_` or `sell_` for the applicable side. The pressure bands describe the leading team's share; invert leader and trailer when the other team gains pressure. The Phaser runtime selects these states automatically from the existing pressure stream. It retains the original pull sprites as a fallback if any pressure texture fails to load.

The `runtime/` directory contains 1200 × 528 PNG derivatives used by Phaser. The 2400 × 1056 originals remain here for art iteration. The runtime set totals approximately 3.7 MB on disk and is loaded once per scene. The two teams crossfade over 200 ms; visual state changes require 300 ms of simulated scene time and a two percentage point threshold margin. An extreme reversal takes effect immediately. The DEV preview uses the same Phaser selector as the public game.

One exception: `sell_state_4_extreme.png` was regenerated at 1890 × 832 with tighter framing. Its `runtime/` derivative is not a plain downscale — the content is scaled to the family contract (65% texture height, shared bottom baseline) before saving. If that original is ever replaced with a family-framed 2400 × 1056 generation, rebuild the runtime derivative with the standard downscale and re-derive the `SECTIONS` constants in `wwwroot/js/arena-pressure/pressure-art.ts` (cuts = transparent gaps between the three members, centers = content bbox centers per cut section).

Generated with the built-in image generation tool using `orange_00.png` and `cyan_00.png` as character and style references. Prompt set: three copies of the reference character, pulling toward their respective side, progressing from balanced strain to confident traction for the leader and from slight slip to kneeling, dragging, and collapse for the trailer; polished arcade style, bold dark outlines, full body, transparent background, no rope, background, text, gauge, or UI.
