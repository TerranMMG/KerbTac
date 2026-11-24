export const DEFAULT_FRAME_RADIUS_M = 2_000

/**
 * Radius the external camera frames when an object is selected.
 *
 * Ground and low-orbit objects keep the close default. High-orbit objects
 * grow to a local region around the satellite rather than the whole orbit:
 * framing a 15,000 km orbit puts the camera tens of millions of metres away,
 * where the marker and trail are sub-pixel and the selected object disappears.
 */
export function frameRadiusForAltitude(altitude: number): number {
  if (!Number.isFinite(altitude) || altitude <= 50_000) return DEFAULT_FRAME_RADIUS_M
  return Math.min(500_000, Math.max(20_000, altitude * 0.1))
}
