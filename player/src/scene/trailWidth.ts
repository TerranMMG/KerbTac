/**
 * Minimum on-screen half-width of a trail ribbon, in CSS pixels.
 * At high orbit a fixed metre width becomes sub-pixel and the ribbon
 * disappears while the height wall remains visible.
 */
const MIN_HALF_WIDTH_PIXELS = 1.2;

/**
 * Pick a ribbon half-width in world units. The physical width is kept when
 * the camera is close enough for it to span at least the minimum number of
 * pixels; otherwise the width grows with the world-units-per-pixel scale.
 */
export function trailHalfWidth(baseHalfWidth: number, worldUnitsPerPixel: number): number {
  if (!Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= 0) {
    return baseHalfWidth;
  }
  return Math.max(baseHalfWidth, worldUnitsPerPixel * MIN_HALF_WIDTH_PIXELS);
}
