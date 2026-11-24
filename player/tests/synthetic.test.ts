import { describe, expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { sampleVessel } from '../src/playback/track'
import { loadFixture } from './helpers/fixtures'

const bytes = await loadFixture('synthetic')

describe('synthetic demo recording', () => {
  it('parses without errors and exposes the expected shape', () => {
    const replay = parseArchive(new Uint8Array(bytes), { fileName: 'synthetic.kerbtac' })
    expect(replay.manifest.format).toBe('kerbtac')
    expect(replay.manifest.formatVersion).toBe(1)
    expect(replay.vessels).toHaveLength(1)
    expect(replay.events.length).toBeGreaterThanOrEqual(8)
    expect(replay.warnings.filter((w) => w.code !== 'missingOptionalColumn')).toEqual([])

    const vessel = replay.vessels[0]
    expect(vessel.name).toBe('Synthetic Trainer')
    expect(vessel.segments).toHaveLength(1)
    expect(vessel.segments[0].samples?.length).toBe(1201)

    // 120 s at 10 Hz, generous tolerance for the exact endpoint.
    expect(replay.endUt - replay.startUt).toBeGreaterThan(119.5)
    expect(replay.endUt - replay.startUt).toBeLessThan(120.5)
  })

  it('contains the scripted flight events', () => {
    const replay = parseArchive(new Uint8Array(bytes))
    const types = new Set(replay.events.map((e) => e.type))
    for (const type of ['flight_start', 'takeoff', 'gear_up', 'stage', 'gear_down', 'touchdown', 'landing', 'flight_end']) {
      expect(types.has(type), `missing ${type}`).toBe(true)
    }
    const takeoff = replay.events.find((e) => e.type === 'takeoff')
    expect(takeoff?.ut).toBeGreaterThan(replay.startUt + 15)
  })

  it('replays a monotonic ground track that climbs and lands', () => {
    const replay = parseArchive(new Uint8Array(bytes))
    const vessel = replay.vessels[0]
    const bodies = replay.bodies

    const start = sampleVessel(vessel, replay.startUt, bodies)!
    const cruise = sampleVessel(vessel, replay.startUt + 70, bodies)!
    const end = sampleVessel(vessel, replay.startUt + 120, bodies)!

    expect(start.situation).toBe('LANDED')
    expect(start.alt).toBeLessThan(100)
    expect(cruise.situation).toBe('FLYING')
    expect(cruise.alt).toBeGreaterThan(800)
    expect(end.situation).toBe('LANDED')
    expect(end.speed ?? 0).toBeLessThan(2)

    // The circuit turns through more than a full circle of heading.
    let unwrapped = 0
    let previous = sampleVessel(vessel, replay.startUt + 40, bodies)?.heading ?? 0
    for (let t = 41; t <= 100; t += 1) {
      const heading = sampleVessel(vessel, replay.startUt + t, bodies)?.heading ?? 0
      let delta = heading - previous
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      unwrapped += delta
      previous = heading
    }
    expect(Math.abs(unwrapped)).toBeGreaterThan(300)

    // Moving forward, not sitting on the runway.
    const moved = sampleVessel(vessel, replay.startUt + 100, bodies)!
    expect(moved.lat).not.toBeCloseTo(start.lat, 4)
  })
})
