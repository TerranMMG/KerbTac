import { describe, expect, it } from 'vitest'
import { trailRibbonRights } from '../src/scene/trailRight'
import type { TrailPathPoint } from '../src/scene/trailPath'

function circle(degrees: number): TrailPathPoint {
  const radians = (degrees * Math.PI) / 180
  return { t: degrees, x: Math.cos(radians), y: 0, z: Math.sin(radians) }
}

function angleBetween(a: number, b: number, c: number, d: number, e: number, f: number): number {
  const dot = Math.max(-1, Math.min(1, a * d + b * e + c * f))
  return (Math.acos(dot) * 180) / Math.PI
}

describe('trail ribbon frames', () => {
  it('stays perpendicular to the surface and smooth along the orbit', () => {
    const points = Array.from({ length: 73 }, (_, index) => circle(index * 2.5))
    const rights = trailRibbonRights(points)
    let previous: [number, number, number] | null = null
    let largestStep = 0
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const length = Math.hypot(point.x, point.y, point.z)
      const rx = rights[index * 3]
      const ry = rights[index * 3 + 1]
      const rz = rights[index * 3 + 2]
      expect(Math.hypot(rx, ry, rz)).toBeCloseTo(1, 5)
      expect((point.x * rx + point.y * ry + point.z * rz) / length).toBeCloseTo(0, 5)
      if (previous) largestStep = Math.max(largestStep, angleBetween(...previous, rx, ry, rz))
      previous = [rx, ry, rz]
    }
    expect(largestStep).toBeLessThan(1.5)
  })

  it('returns an empty frame array for an empty path', () => {
    expect(trailRibbonRights([])).toHaveLength(0)
  })
})
