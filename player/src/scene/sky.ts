const ATMOSPHERE_TOP_M = 70_000

/**
 * 0 = blue sky at the surface, 1 = black space at or above the KSP
 * atmosphere boundary. A smoothstep avoids a visible colour jump when the
 * camera crosses 70 km.
 */
export function skyBlendForAltitude(altitude: number): number {
  if (!Number.isFinite(altitude) || altitude <= 0) return 0
  const raw = Math.min(1, Math.max(0, altitude / ATMOSPHERE_TOP_M))
  return raw * raw * (3 - 2 * raw)
}

/** The atmosphere shell becomes a thin rim once the camera is in space. */
export function atmosphereStrengthForAltitude(blend: number): number {
  const clamped = Math.min(1, Math.max(0, blend))
  return 0.14 + 0.26 * (1 - clamped)
}
