import { expect, it } from 'vitest'
import { decimateTrailSamples } from '../src/scene/trail'
import { buildHeightWallFromTrail } from '../src/scene/heightWall'
import { buildTrailMeshData } from '../src/scene/trailMeshData'

it.each([false,true])('honors an explicit, sub-threshold discontinuity (full=%s)', full => {
  const seg = (start:number,boundary:boolean) => ({body:'Kerbin',kind:'flight' as const,radius:600000,boundary,
    samples:{length:2,t:Float64Array.of(start,start+1),lat:Float64Array.of(0,0),
      lon:Float64Array.of(0,0.00001),alt:Float64Array.of(10,10),agl:null}})
  const result=buildTrailMeshData([seg(0,false),seg(1.05,true)],'Kerbin',full)
  expect(Array.from(result.lineTimes)).toEqual([0,1,1.05,2.05])
  expect(Array.from(result.breaks)).toEqual([0,0,1,0])
  expect(result.wallPoints.filter(p=>p.breakBefore).map(p=>p.t)).toEqual([1.05])
})

it.each([false, true])('does not weave a pre-jump tail into a later overlapping trajectory (full=%s)', full => {
  const seg = (t: number[], boundary: boolean) => ({
    body: 'Kerbin', kind: 'flight' as const, boundary, radius: 600000,
    samples: { length: t.length, t: Float64Array.from(t), lat: new Float64Array(t.length),
      lon: Float64Array.from(t, n => n * 0.00001), alt: new Float64Array(t.length), agl: null },
  })
  const result = buildTrailMeshData([seg([0,1,1.5],false), seg([1.25,2.25],true)], 'Kerbin', full)
  expect(Array.from(result.lineTimes)).toEqual([0,1,1.25,2.25])
  expect(result.wallPoints.map(p => p.t)).toEqual([0,1,1.25,2.25])
})

it('reduces a long trail but preserves both edges of a teleport and the time window', () => {
  const samples = Array.from({ length: 10_000 }, (_, i) => ({
    t: i / 10, x: 700_000 + i + (i >= 5000 ? 50_000 : 0), y: 0, z: 0,
  }))
  const runs = decimateTrailSamples(samples, 2000)
  expect(runs.map(run => [run[0]?.t, run.at(-1)?.t])).toEqual([[0, 499.9], [500, 999.9]])
  expect(runs.flat()).toHaveLength(2000)
})

it('reduces unselected wall vertices without drawing through a flagged break', () => {
  const wall = buildHeightWallFromTrail([
    { t: 0, x: 601000, y: 0, z: 0 },
    { t: 1, x: 601000, y: 100, z: 0, breakBefore: true },
    { t: 2, x: 601000, y: 200, z: 0 },
  ], 600000, '#ffffff', 1)
  expect(wall.getAttribute('position').count).toBe(6)
  expect(Array.from(wall.index!.array)).toEqual([2, 3, 4, 3, 5, 4])
})
