export interface TrailPathPoint {
  t: number
  breakBefore?: boolean
  x: number
  y: number
  z: number
}

const DEFAULT_MAX_STEP_RADIANS = 0.02
const MAX_SUBDIVISIONS = 32

/**
 * Split a recorded path where samples are missing for much longer than the
 * normal cadence. A ribbon must not bridge a data gap with a straight band:
 * that is what produced the long diagonal chords and sharp corners in long
 * recordings with warped time or vessel switches.
 */
export function splitTrailRuns(
  points: readonly TrailPathPoint[],
  minGapSeconds = 2.0,
  gapFactor = 2.5,
): TrailPathPoint[][] {
  if (points.length === 0) return []
  if (points.length === 1) return [points.slice()]
  const gaps: number[] = []
  for (let index = 1; index < points.length; index += 1) {
    const gap = points[index].t - points[index - 1].t
    if (gap > 0) gaps.push(gap)
  }
  gaps.sort((a, b) => a - b)
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0
  const limit = Math.max(minGapSeconds, median * gapFactor)
  const runs: TrailPathPoint[][] = [[points[0]]]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const point = points[index]
    const gap = point.t - previous.t
    const distance = Math.hypot(
      point.x - previous.x,
      point.y - previous.y,
      point.z - previous.z,
    )
    // VesselMover and active/loaded switches can teleport a vessel by a
    // kilometre in a fraction of a second. Do not draw a straight ribbon
    // through that discontinuity; the same guard also catches VesselMover
    // spawn/teleport frames.
    // Orbital speed is ~3 km/s; at 2 Hz warp a sample step is ~1.5 km, which
    // must stay connected. Only VesselMover-style jumps above 10 km/s split.
    const teleport = distance > 500 && gap > 0 && distance / gap > 10_000
    if (point.breakBefore || gap > limit || teleport) runs.push([])
    runs[runs.length - 1].push(point)
  }
  return runs
}

/**
 * Densify a coarse recorded path with a cubic Hermite curve.
 *
 * Position samples are often ten seconds apart. Joining them with straight
 * lines leaves visible corners on low orbits, especially when the camera is
 * close. The curve passes through every recorded sample and uses the
 * neighbouring samples for its tangents, so it follows the orbit instead of
 * cutting the chord. Dense 10 Hz tracks are left untouched.
 */
export function smoothTrailPoints(
  points: readonly TrailPathPoint[],
  maxStepRadians = DEFAULT_MAX_STEP_RADIANS,
): TrailPathPoint[] {
  if (points.length <= 2) return points.slice()
  const step =
    Number.isFinite(maxStepRadians) && maxStepRadians > 0
      ? maxStepRadians
      : DEFAULT_MAX_STEP_RADIANS
  const result: TrailPathPoint[] = [points[0]]
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const dt = end.t - start.t
    if (!(dt > 0)) {
      result.push(end)
      continue
    }
    const startLength = Math.hypot(start.x, start.y, start.z)
    const endLength = Math.hypot(end.x, end.y, end.z)
    let angle = 0
    if (startLength > 1e-9 && endLength > 1e-9) {
      const cosine = Math.min(
        1,
        Math.max(
          -1,
          (start.x * end.x + start.y * end.y + start.z * end.z) / (startLength * endLength),
        ),
      )
      angle = Math.acos(cosine)
    }
    const steps = Math.min(
      MAX_SUBDIVISIONS,
      Math.max(1, Math.ceil(angle / step)),
    )
    const previousDt = start.t - previous.t
    const nextDt = next.t - end.t
    const tangentStart = {
      x: previousDt > 0 ? (end.x - previous.x) / (end.t - previous.t) : (end.x - start.x) / dt,
      y: previousDt > 0 ? (end.y - previous.y) / (end.t - previous.t) : (end.y - start.y) / dt,
      z: previousDt > 0 ? (end.z - previous.z) / (end.t - previous.t) : (end.z - start.z) / dt,
    }
    const tangentEnd = {
      x: nextDt > 0 ? (next.x - start.x) / (next.t - start.t) : (end.x - start.x) / dt,
      y: nextDt > 0 ? (next.y - start.y) / (next.t - start.t) : (end.y - start.y) / dt,
      z: nextDt > 0 ? (next.z - start.z) / (next.t - start.t) : (end.z - start.z) / dt,
    }
    for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
      if (stepIndex === steps) {
        result.push(end)
        continue
      }
      const f = stepIndex / steps
      const f2 = f * f
      const f3 = f2 * f
      const h00 = 2 * f3 - 3 * f2 + 1
      const h10 = f3 - 2 * f2 + f
      const h01 = -2 * f3 + 3 * f2
      const h11 = f3 - f2
      result.push({
        t: start.t + dt * f,
        x: h00 * start.x + h10 * dt * tangentStart.x + h01 * end.x + h11 * dt * tangentEnd.x,
        y: h00 * start.y + h10 * dt * tangentStart.y + h01 * end.y + h11 * dt * tangentEnd.y,
        z: h00 * start.z + h10 * dt * tangentStart.z + h01 * end.z + h11 * dt * tangentEnd.z,
      })
    }
  }
  return result
}
