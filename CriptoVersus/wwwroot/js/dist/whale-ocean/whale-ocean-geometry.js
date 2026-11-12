/**
 * Returns the world interval for one territory at the same depth as the
 * sprite. `bodyHalfWidth` is the visible alpha body half-width, not the
 * transparent atlas frame half-width.
 */
export function getTeamHorizontalBounds(visible, territory, bodyHalfWidth) {
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
export function getTransitPath(visible, territory, direction, spriteHalfWidth, bodyHalfWidth) {
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
export function cssPixelToRenderPixel(cssPixel, cssSize, renderSize) {
    if (cssSize <= 0 || renderSize <= 0)
        return 0;
    return cssPixel * renderSize / cssSize;
}
