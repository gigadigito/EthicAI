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

export interface WhaleOceanBodyExtents {
    /** Distance from the sprite centre to the visible alpha body on each side. */
    left: number;
    right: number;
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
 * Builds a complete entry-to-exit path inside one territory. Outer entries
 * start outside the viewport by the full sprite half-width; central entries
 * start with the visible body already contained in their own territory. The
 * exit places the leading visible body edge exactly on the territory boundary.
 */
export function getTransitPath(
    visible: WhaleOceanVisibleBounds,
    territory: WhaleOceanTerritory,
    direction: WhaleOceanDirection,
    spriteHalfWidth: number,
    bodyHalfWidth: number
): WhaleOceanTransitPath {
    return getDirectionalTransitPath(visible, territory, direction, spriteHalfWidth, {
        left: Math.max(0, bodyHalfWidth),
        right: Math.max(0, bodyHalfWidth)
    });
}

/**
 * Builds a path using the measured alpha extents of the sprite. This keeps
 * the visible body, rather than its transparent atlas frame, on its side of
 * the divider. The same path is used for spawn, movement and despawn.
 */
export function getDirectionalTransitPath(
    visible: WhaleOceanVisibleBounds,
    territory: WhaleOceanTerritory,
    direction: WhaleOceanDirection,
    spriteHalfWidth: number,
    bodyExtents: WhaleOceanBodyExtents
): WhaleOceanTransitPath {
    const teamLeft = territory === "left" ? visible.left : visible.center;
    const teamRight = territory === "left" ? visible.center : visible.right;
    const directionSign = direction === "buy" ? 1 : -1;
    const entryBoundary = directionSign > 0 ? teamLeft : teamRight;
    const exitBoundary = directionSign > 0 ? teamRight : teamLeft;
    const span = Math.abs(teamRight - teamLeft);
    const leadingExtent = Math.min(
        Math.max(0, directionSign > 0 ? bodyExtents.right : bodyExtents.left),
        span / 2
    );
    const centralEntry = territory === "right" ? directionSign > 0 : directionSign < 0;
    const entryBodyInset = Math.max(0, directionSign > 0 ? bodyExtents.left : bodyExtents.right);
    const centralExit = territory === "left" ? directionSign > 0 : directionSign < 0;
    return {
        fromX: centralEntry
            ? entryBoundary + directionSign * Math.min(entryBodyInset, span / 2)
            : entryBoundary - directionSign * Math.max(0, spriteHalfWidth),
        toX: centralExit
            ? exitBoundary - directionSign * leadingExtent
            : exitBoundary + directionSign * Math.max(0, spriteHalfWidth)
    };
}

export function positionOnTransitPath(path: WhaleOceanTransitPath, progress: number): number {
    const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    return path.fromX + (path.toX - path.fromX) * t;
}

/** Returns the same normalized progress after a camera/viewport resize. */
export function preserveTransitProgress(
    previousPath: WhaleOceanTransitPath,
    currentX: number,
    nextPath: WhaleOceanTransitPath
): number {
    const distance = previousPath.toX - previousPath.fromX;
    if (!Number.isFinite(distance) || Math.abs(distance) < Number.EPSILON) return 0;
    return Math.max(0, Math.min(1, (currentX - previousPath.fromX) / distance));
}

/** Converts CSS pixels to Babylon render pixels, preserving one screen space. */
export function cssPixelToRenderPixel(cssPixel: number, cssSize: number, renderSize: number): number {
    if (cssSize <= 0 || renderSize <= 0) return 0;
    return cssPixel * renderSize / cssSize;
}
