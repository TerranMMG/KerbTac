import { describe, expect, it } from 'vitest'
import { splitTrailRuns, type TrailPathPoint } from '../src/scene/trailPath'

function point(t: number): TrailPathPoint {
  return { t, x: Math.cos(t / 100), y: 0, z: Math.sin(t / 100) }
}

describe('trail run splitting', () => {
  it('breaks a path at a missing time window', () => {
    const points = [point(0), point(10), point(20), point(80), point(90)]
    const runs = splitTrailRuns(points)
    expect(runs.map((run) => run.length)).toEqual([3, 2])
    expect(runs[0][0].t).toBe(0)
    expect(runs[1][0].t).toBe(80)
  })

  it('keeps a dense track in one run across normal frame jitter', () => {
    const points = [point(0), point(0.1), point(0.25), point(0.35), point(0.5)]
    expect(splitTrailRuns(points)).toHaveLength(1)
  })

  it('keeps fast orbital samples connected at 2 Hz warp', () => {
    const points: TrailPathPoint[] = [
      { t: 0, x: 0, y: 0, z: 0 },
      { t: 0.5, x: 1100, y: 0, z: 0 },
      { t: 1, x: 2200, y: 0, z: 0 },
      { t: 1.5, x: 3300, y: 0, z: 0 },
    ]
    expect(splitTrailRuns(points)).toHaveLength(1)
  })

  it('bridges short segment-switch gaps', () => {
    const points = [point(0), point(0.1), point(0.9), point(1.0)]
    expect(splitTrailRuns(points)).toHaveLength(1)
  })

  it('keeps sparse ten second keyframes connected across chunk boundaries', () => {
    const points = Array.from({ length: 6 }, (_, index) => point(index * 10))
    expect(splitTrailRuns(points)).toHaveLength(1)
  })

  it('leaves empty and single point paths alone', () => {
    expect(splitTrailRuns([])).toEqual([])
    expect(splitTrailRuns([point(0)])).toEqual([[point(0)]])
  })

  it('breaks a path at an impossible position jump', () => {
    const points: TrailPathPoint[] = [
      { t: 0, x: 0, y: 0, z: 0 },
      { t: 0.1, x: 10, y: 0, z: 0 },
      { t: 0.2, x: 20, y: 1200, z: 0 },
      { t: 0.3, x: 30, y: 1200, z: 0 },
    ]
    const runs = splitTrailRuns(points)
    expect(runs.map((run) => run.length)).toEqual([2, 2])
    expect(runs[0][1].t).toBe(0.1)
    expect(runs[1][0].t).toBe(0.2)
  })
})
