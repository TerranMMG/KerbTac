import { describe, expect, it } from 'vitest'
import { smoothTrailPoints, type TrailPathPoint } from '../src/scene/trailPath'

function onCircle(degrees: number, time: number): TrailPathPoint {
  const radians = (degrees * Math.PI) / 180
  return { t: time, x: Math.cos(radians), y: 0, z: Math.sin(radians) }
}

describe('trail path smoothing', () => {
  it('preserves endpoints and monotonic sample times', () => {
    const points = [onCircle(0, 0), onCircle(10, 10), onCircle(20, 20)]
    const smoothed = smoothTrailPoints(points)
    expect(smoothed.length).toBeGreaterThan(points.length)
    expect(smoothed[0]).toEqual(points[0])
    expect(smoothed[smoothed.length - 1]).toEqual(points[points.length - 1])
    for (let index = 1; index < smoothed.length; index += 1) {
      expect(smoothed[index].t).toBeGreaterThan(smoothed[index - 1].t)
    }
  })

  it('follows the arc instead of cutting a chord between coarse samples', () => {
    const points = [onCircle(0, 0), onCircle(10, 10), onCircle(20, 20)]
    const smoothed = smoothTrailPoints(points, 0.03)
    const middle = smoothed.find((point) => Math.abs(point.t - 5) < 1e-6)
    expect(middle).toBeDefined()
    expect(Math.hypot(middle!.x, middle!.y, middle!.z)).toBeGreaterThan(0.9975)
    const angle = (Math.atan2(middle!.z, middle!.x) * 180) / Math.PI
    expect(angle).toBeGreaterThan(4.5)
    expect(angle).toBeLessThan(5.5)
  })

  it('does not densify samples that are already fine-grained', () => {
    const points = [onCircle(0, 0), onCircle(0.1, 0.1), onCircle(0.2, 0.2)]
    expect(smoothTrailPoints(points, 0.02)).toHaveLength(points.length)
  })

  it('leaves short trails untouched and tolerates invalid settings', () => {
    expect(smoothTrailPoints([])).toEqual([])
    expect(smoothTrailPoints([onCircle(0, 0)])).toHaveLength(1)
    expect(smoothTrailPoints([onCircle(0, 0), onCircle(10, 10), onCircle(20, 20)], Number.NaN).length).toBeGreaterThan(3)
  })
})
