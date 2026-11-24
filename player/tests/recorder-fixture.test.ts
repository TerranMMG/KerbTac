import { describe, expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { sampleVessel } from '../src/playback/track'
import { loadFixture } from './helpers/fixtures'

const bytes = await loadFixture('recorder')

describe('C# recorder fixture', () => {
  const replay = parseArchive(new Uint8Array(bytes), { fileName: 'recorder.kerbtac' })

  it('parses the archive written by the C# writer', () => {
    expect(replay.manifest.formatRevision).toBe(2)
    expect(replay.vessels).toHaveLength(3)
    expect(replay.vessels.filter((v) => v.transient)).toHaveLength(1)
    expect(replay.events).toHaveLength(11)
    expect(replay.manifest.generator.name).toBe('KerbTac Recorder')
    expect(replay.manifest.game.kspVersion).toBe('1.12.5.3190')
    expect(replay.startUt).toBeCloseTo(1000, 6)
    expect(replay.endUt).toBeCloseTo(1060, 6)
  })

  it('parses the v1.1 combat sections', () => {
    expect(replay.mission?.title).toBe('BVR 2v2')
    expect(replay.gaps).toHaveLength(1)
    expect(replay.chapters).toHaveLength(1)
    expect(replay.actors).toHaveLength(1)
    expect(replay.effects).toHaveLength(1)
    expect(replay.effects[0]?.kind).toBe('chaff')
    expect(replay.locks).toHaveLength(1)
    expect(replay.locks[0]?.sensor).toBe('radar')
    const release = replay.events.find((event) => event.type === 'weapon_release')
    expect(release?.source).toBe('6f1d9a3c-2b4e-4c8a-9d10-7e5f3a2b1c00')
    expect(release?.target).toBe('2a4c6e80-1b3d-4f5a-8c9e-0d1f2a3b4c5d')
  })

  it('acceptance recording exposes two aircraft and one missile', () => {
    expect(replay.vessels.filter((vessel) => vessel.kind === 'air/fixedwing')).toHaveLength(2)
    expect(
      replay.vessels.filter((vessel) => vessel.transient && vessel.kind === 'weapon/missile').length,
    ).toBeGreaterThanOrEqual(1)
    expect(replay.locks.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps every sample column', () => {
    const samples = replay.vessels[0].segments[0].samples
    expect(samples).not.toBeNull()
    expect(samples!.length).toBe(601)
    expect(samples!.t[0]).toBeCloseTo(1000, 6)
    expect(samples!.t[600]).toBeCloseTo(1060, 6)
    expect(samples!.hdg).not.toBeNull()
    expect(samples!.vs).not.toBeNull()
    expect(samples!.srfSpeed).not.toBeNull()
    expect(samples!.lf).not.toBeNull()
    expect(samples!.ox).not.toBeNull()
    expect(samples!.ec).not.toBeNull()
    expect(samples!.mp).not.toBeNull()
    expect(samples!.situation?.[0]).toBe('FLYING')
  })

  it('replays position and heading consistently', () => {
    const vessel = replay.vessels[0]
    const start = sampleVessel(vessel, 1000, replay.bodies)
    const end = sampleVessel(vessel, 1060, replay.bodies)
    expect(start).not.toBeNull()
    expect(end).not.toBeNull()
    expect(start?.alt).toBeCloseTo(300, 3)
    expect(start?.speed).toBeCloseTo(150, 2)
    const startHeading = start!.heading!
    expect(Math.min(startHeading, 360 - startHeading)).toBeLessThan(0.5)
    expect(end!.heading!).toBeGreaterThan(340)
    expect(end!.heading!).toBeLessThan(348)
    expect(start?.lat).toBeCloseTo(-0.0972, 4)

    const bearing = Math.atan2(end!.lon - start!.lon, end!.lat - start!.lat)
    expect(bearing).toBeGreaterThan(0)
    expect(end!.lon).not.toBeCloseTo(start!.lon, 6)
  })

  it('carries the scripted events', () => {
    const types = replay.events.map((event) => event.type)
    expect(types).toContain('takeoff')
    expect(types).toContain('gear_up')
    expect(types).toContain('stage')
    expect(types).toContain('gear_down')
    expect(types).toContain('touchdown')
    expect(types).toContain('landing')
    const takeoff = replay.events.find((event) => event.type === 'takeoff')
    expect(takeoff?.ut).toBeCloseTo(1005, 6)
  })
})
