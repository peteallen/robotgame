// Shared minimap geometry. The room collision model imports this small,
// dependency-free module so actors and floor targets cannot disappear beneath
// the opaque HUD card that Minimap draws.
export const MINIMAP_BOUNDS = Object.freeze({ x: 1342, y: 868, w: 314, h: 158 });
export const MINIMAP_SAFE_BOTTOM_PX = 24;

export function minimapVerticalOffset(scale, offY, viewportHeight) {
  if (!(scale > 0) || !Number.isFinite(offY) || !(viewportHeight > 0)) return 0;
  const screenBottom = offY + (MINIMAP_BOUNDS.y + MINIMAP_BOUNDS.h) * scale;
  const shortfall = MINIMAP_SAFE_BOTTOM_PX - (viewportHeight - screenBottom);
  return shortfall > 0 ? -shortfall / scale : 0;
}

export function gameViewportHeight(game) {
  return game?.canvas?.clientHeight
    || (game?.canvas?.height && game?.dpr ? game.canvas.height / game.dpr : 0)
    || (typeof window !== 'undefined' ? window.innerHeight : 0);
}

export function minimapVerticalOffsetForGame(game) {
  return minimapVerticalOffset(game?.scale, game?.offY, gameViewportHeight(game));
}

export function minimapPlayfieldBounds(game) {
  return {
    ...MINIMAP_BOUNDS,
    y: MINIMAP_BOUNDS.y + minimapVerticalOffsetForGame(game),
  };
}
