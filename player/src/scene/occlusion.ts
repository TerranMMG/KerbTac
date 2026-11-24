import type { Vec3 } from '../playback/math'

/**
 * True when the segment camera -> point intersects the sphere before reaching
 * the point. Used to hide DOM labels for satellites behind the horizon; the
 * mesh itself is already depth-tested by the planet.
 */
export function isOccludedBySphere(
  camera: Vec3,
  point: Vec3,
  center: Vec3,
  radius: number,
): boolean {
  const dx = point.x - camera.x
  const dy = point.y - camera.y
  const dz = point.z - camera.z
  const a = dx * dx + dy * dy + dz * dz
  if (a < 1e-6) return false

  const ox = camera.x - center.x
  const oy = camera.y - center.y
  const oz = camera.z - center.z
  const b = 2 * (ox * dx + oy * dy + oz * dz)
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return false

  const t = (-b - Math.sqrt(discriminant)) / (2 * a)
  return t > 0.001 && t < 0.999
}
