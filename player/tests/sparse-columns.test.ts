import { expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { sampleVessel } from '../src/playback/track'
import { buildArchive, defaultTrack } from './helpers/archive'

function chunk(index: number, t: number[], columns: Record<string, unknown[]> = {}) {
  return {
    kind: 'flight', body: 'Kerbin', index, logicalIndex: 9, chunkIndex: index,
    startUt: Math.min(...t), endUt: Math.max(...t),
    samples: { t, lat: t.map(() => 0), lon: t.map(() => 0), alt: t.map(() => 100),
      q: t.flatMap(() => [0, 0, 0, 1]), ...columns },
  }
}

function read(chunks: ReturnType<typeof chunk>[]) {
  return parseArchive(buildArchive({ track: { ...defaultTrack(), segments: chunks } }))
}

it('keeps known rows across consecutive chunks missing both float and integer columns', () => {
  const replay = read([
    chunk(0, [100, 101], { pitch: [0, 0.25], stage: [0, 2] }),
    chunk(1, [102]), chunk(2, [103]),
    chunk(3, [104], { pitch: [-0.5], stage: [4] }),
  ])
  const samples = replay.vessels[0].segments[0].samples!
  expect(Array.from(samples.pitch!)).toEqual([0, 0.25, NaN, NaN, -0.5])
  expect(Array.from(samples.stage!)).toEqual([0, 2, NaN, NaN, 4])
})

it('keeps null aligned when sorting rows, and never interpolates telemetry across null', () => {
  const replay = read([chunk(0, [102, 100, 101], {
    health: [0.5, 0, null], stage: [1, 0, null],
    hdg: [180, 42, null], situation: ['FLYING', 'LANDED', null],
  })])
  const vessel = replay.vessels[0]
  const at = (ut: number) => sampleVessel(vessel, ut, replay.bodies)!
  expect(at(100)).toMatchObject({ health: 0, stage: 0, heading: 42, situation: 'LANDED' })
  expect(at(100.5).health).toBeNull()
  expect(at(101)).toMatchObject({ health: null, stage: null, situation: null })
  expect(at(102)).toMatchObject({ health: 0.5, stage: 1, heading: 180, situation: 'FLYING' })
})

it('discards older overlap rows even when they were the only known rows of a column', () => {
  const samples = read([
    chunk(0, [100, 101], { pitch: [null, 0.5] }),
    chunk(1, [101, 102]),
  ]).vessels[0].segments[0].samples!
  expect(Array.from(samples.t)).toEqual([100, 101, 102])
  expect(samples.pitch).toBeNull()
})

it('does not infer vertical speed from one static position, but keeps an explicit zero', () => {
  const at = (columns?: Record<string, unknown[]>) => {
    const replay = read([{ ...chunk(0, [100], columns), kind: 'static' }])
    return sampleVessel(replay.vessels[0], 100, replay.bodies)!.verticalSpeed
  }
  expect(at()).toBeNull()
  expect(at({ vs: [0] })).toBe(0)
})
