const VERTICAL_BAND_NAMES = ["surface", "high", "central", "deep", "bottom"];
/**
 * Returns the useful canvas area for the depth lanes. The canvas already
 * excludes the page header; the small proportional insets keep the first
 * and last lanes clear of the in-stage HUD on desktop and mobile.
 */
export function getUsefulOceanVerticalViewport(viewportHeight, viewportWidth = Number.POSITIVE_INFINITY) {
    const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
    const mobile = Number.isFinite(viewportWidth) && viewportWidth <= 700;
    const topInset = mobile
        ? Math.min(118, Math.max(28, height * 0.11))
        : Math.min(96, Math.max(20, height * 0.1));
    // Mobile territory cards move to the bottom of the stage. Reserve their
    // visual footprint so the lowest band remains visible above the HUD.
    const bottomInset = mobile
        ? Math.min(220, Math.max(120, height * 0.22))
        : Math.min(112, Math.max(28, height * 0.12));
    const top = Math.min(Math.max(0, height - 5), topInset);
    const bottom = Math.max(top + 5, height - bottomInset);
    return { top, bottom };
}
/** Splits the useful viewport into five equal, invisible horizontal bands. */
export function getWhaleOceanVerticalBands(viewportHeight, viewportWidth = Number.POSITIVE_INFINITY) {
    const viewport = getUsefulOceanVerticalViewport(viewportHeight, viewportWidth);
    const height = (viewport.bottom - viewport.top) / VERTICAL_BAND_NAMES.length;
    return VERTICAL_BAND_NAMES.map((name, index) => ({
        name,
        index,
        top: viewport.top + height * index,
        bottom: viewport.top + height * (index + 1),
        center: viewport.top + height * (index + 0.5)
    }));
}
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
 * Builds a complete entry-to-exit path inside one territory. Outer entries
 * start outside the viewport by the full sprite half-width; central entries
 * start with the visible body already contained in their own territory. The
 * exit places the leading visible body edge exactly on the territory boundary.
 */
export function getTransitPath(visible, territory, direction, spriteHalfWidth, bodyHalfWidth) {
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
export function getDirectionalTransitPath(visible, territory, direction, spriteHalfWidth, bodyExtents) {
    const teamLeft = territory === "left" ? visible.left : visible.center;
    const teamRight = territory === "left" ? visible.center : visible.right;
    const directionSign = direction === "buy" ? 1 : -1;
    const entryBoundary = directionSign > 0 ? teamLeft : teamRight;
    const exitBoundary = directionSign > 0 ? teamRight : teamLeft;
    const span = Math.abs(teamRight - teamLeft);
    const leadingExtent = Math.min(Math.max(0, directionSign > 0 ? bodyExtents.right : bodyExtents.left), span / 2);
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
export function positionOnTransitPath(path, progress) {
    const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    return path.fromX + (path.toX - path.fromX) * t;
}
/** Returns the same normalized progress after a camera/viewport resize. */
export function preserveTransitProgress(previousPath, currentX, nextPath) {
    const distance = previousPath.toX - previousPath.fromX;
    if (!Number.isFinite(distance) || Math.abs(distance) < Number.EPSILON)
        return 0;
    return Math.max(0, Math.min(1, (currentX - previousPath.fromX) / distance));
}
/** Converts CSS pixels to Babylon render pixels, preserving one screen space. */
export function cssPixelToRenderPixel(cssPixel, cssSize, renderSize) {
    if (cssSize <= 0 || renderSize <= 0)
        return 0;
    return cssPixel * renderSize / cssSize;
}
