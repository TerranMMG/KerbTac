export interface TrailVector {
  x: number
  y: number
  z: number
}

const FALLBACK: TrailVector = { x: 1, y: 0, z: 0 }

/**
 * Width direction for a trail ribbon at a point on a body surface.
 *
 * The vessel's recorded attitude is not a reliable "right" axis for unloaded
 * satellites: their body-fixed attitude points +Z north and +Y up, so a
 * satellite flying east has its local +X along the path. Using that axis
 * collapses the ribbon into a line. Derive the width from the path tangent
 * and the local radial instead: the cross product is perpendicular to the
 * path and tangent to the body, which keeps the ribbon flat and wide.
 */
export function trailRightVector(radial: TrailVector, tangent: TrailVector): TrailVector {
  const x = radial.y * tangent.z - radial.z * tangent.y
  const y = radial.z * tangent.x - radial.x * tangent.z
  const z = radial.x * tangent.y - radial.y * tangent.x
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || length < 1e-9) return { ...FALLBACK }
  return { x: x / length, y: y / length, z: z / length }
}

/**
 * Build ribbon width directions for a densified path.
 *
 * A one-sample tangent is noisy even when the centreline itself is smooth.
 * Averaging over a small local window removes that jitter before the normal
 * is taken, and a second smoothing pass keeps the ribbon edge from rippling
 * on medium and low orbits. The average is re-orthogonalised against the
 * local radial so the ribbon remains tangent to the surface.
 */
export function trailRibbonRights(
  points: ReadonlyArray<{ t: number; x: number; y: number; z: number }>,
): Float32Array {
  const count = points.length
  const rights = new Float32Array(count * 3)
  if (count === 0) return rights
  const window = Math.max(1, Math.min(8, Math.floor(count / 64)))
  const raw = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const before = Math.max(0, index - window)
    const after = Math.min(count - 1, index + window)
    const a = points[before]
    const b = points[after]
    const point = points[index]
    const right = trailRightVector(point, {
      x: b.x - a.x,
      y: b.y - a.y,
      z: b.z - a.z,
    })
    raw[index * 3] = right.x
    raw[index * 3 + 1] = right.y
    raw[index * 3 + 2] = right.z
  }
  const smoothWindow = Math.max(1, Math.min(3, Math.floor(count / 128)))
  for (let index = 0; index < count; index += 1) {
    const before = Math.max(0, index - smoothWindow)
    const after = Math.min(count - 1, index + smoothWindow)
    let x = 0
    let y = 0
    let z = 0
    for (let sample = before; sample <= after; sample += 1) {
      x += raw[sample * 3]
      y += raw[sample * 3 + 1]
      z += raw[sample * 3 + 2]
    }
    const point = points[index]
    const radialLength = Math.hypot(point.x, point.y, point.z)
    if (radialLength > 1e-9) {
      const nx = point.x / radialLength
      const ny = point.y / radialLength
      const nz = point.z / radialLength
      const dot = x * nx + y * ny + z * nz
      x -= nx * dot
      y -= ny * dot
      z -= nz * dot
    }
    const length = Math.hypot(x, y, z)
    if (!Number.isFinite(length) || length < 1e-9) {
      rights[index * 3] = FALLBACK.x
      rights[index * 3 + 1] = FALLBACK.y
      rights[index * 3 + 2] = FALLBACK.z
    } else {
      rights[index * 3] = x / length
      rights[index * 3 + 1] = y / length
      rights[index * 3 + 2] = z / length
    }
  }
  return rights
}
