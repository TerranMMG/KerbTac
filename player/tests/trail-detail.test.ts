import { expect, it } from 'vitest'
import { buildTrailDetail } from '../src/scene/trailDetail'
import { trailDrawRange } from '../src/scene/trailMeshData'

it('builds full detail for a dense track without copying telemetry into the mesh result', () => {
  const count = 4000
  const t = Float64Array.from({ length: count }, (_, i) => i / 10)
  const result = buildTrailDetail({
    body: 'Kerbin', radius: 600_000, color: 0xff00ff, wall: false,
    segments: [{ body: 'Kerbin', kind: 'flight', radius: 600_000,
      samples: { length: count, t, lat: new Float64Array(count),
        lon: Float64Array.from(t, time => time / 100), alt: new Float64Array(count), agl: null } }],
  })
  expect(result.times).toEqual(t)
  expect(result.ribbon.attributes.position?.array).toHaveLength(count * 6)
  expect(result.line.attributes.position?.array).toHaveLength((count - 1) * 6)
  expect(result.wall).toBeNull()
})

it('submits only complete primitives touching the visible time window', () => {
  const times = [0, 1, 1, 2, 4, 5]
  expect(trailDrawRange(i => times[i]!, 3, 2, 1.5, 4)).toEqual({ start: 2, count: 4 })
  expect(trailDrawRange(i => times[i]!, 3, 2, 6, 7)).toEqual({ start: 6, count: 0 })
})
