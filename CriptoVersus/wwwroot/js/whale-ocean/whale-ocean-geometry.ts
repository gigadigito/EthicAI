export type WhaleOceanTerritory = "left" | "right";
export type WhaleOceanDirection = "buy" | "sell";

export interface WhaleOceanVisibleBounds {
    left: number;
    center: number;
    right: number;
}

export interface WhaleOceanTeamBounds extends WhaleOceanVisibleBounds {
    minX: number;
    maxX: number;
}

export interface WhaleOceanTransitPath {
    fromX: number;
    toX: number;
}

/**
 * Returns the world interval for one territory at the same depth as the
 * sprite. `bodyHalfWidth` is the visible alpha body half-width, not the
 * transparent atlas frame half-width.
 */
export function getTeamHorizontalBounds(
    visible: WhaleOceanVisibleBounds,
    territory: WhaleOceanTerritory,
    bodyHalfWidth: number
): WhaleOceanTeamBounds {
    const teamLeft = territory === "left" ? visible.left : visible.center;
    const teamRight = territory === "left" ? visible.center : visible.right;
    const span = Math.max(0, teamRight - teamLeft);
    const safePadding = Math.min(Math.max(0, bodyHalfWidth), span / 2);
    return {
        ...visible,
        minX: teamLeft + safePadding,
        maxX: teamRight - safePadding
    };
}

/**
 * Builds a complete entry-to-exit path inside one territory. The entry is
 * outside the visible edge by the full sprite half-width; the exit places the
 * visible body edge exactly on the territory boundary.
 */
export function getTransitPath(
    visible: WhaleOceanVisibleBounds,
    territory: WhaleOceanTerritory,
    direction: WhaleOceanDirection,
    spriteHalfWidth: number,
    bodyHalfWidth: number
): WhaleOceanTransitPath {
    const teamLeft = territory === "left" ? visible.left : visible.center;
    const teamRight = territory === "left" ? visible.center : visible.right;
    const directionSign = direction === "buy" ? 1 : -1;
    const entryBoundary = directionSign > 0 ? teamLeft : teamRight;
    const exitBoundary = directionSign > 0 ? teamRight : teamLeft;
    const safeBodyHalfWidth = Math.min(Math.max(0, bodyHalfWidth), Math.abs(teamRight - teamLeft) / 2);
    return {
        fromX: entryBoundary - directionSign * Math.max(0, spriteHalfWidth),
        toX: exitBoundary - directionSign * safeBodyHalfWidth
    };
}

/** Converts CSS pixels to Babylon render pixels, preserving one screen space. */
export function cssPixelToRenderPixel(cssPixel: number, cssSize: number, renderSize: number): number {
    if (cssSize <= 0 || renderSize <= 0) return 0;
    return cssPixel * renderSize / cssSize;
}
