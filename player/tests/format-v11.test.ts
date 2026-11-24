import { describe, expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import {
  VESSEL_ID,
  buildArchive,
  defaultBodies,
  defaultEvents,
  defaultManifest,
  defaultTrack,
  sampleColumns,
} from './helpers/archive'

function v11Manifest(): Record<string, unknown> {
  const manifest = defaultManifest()
  const session = manifest['session'] as Record<string, unknown>
  return {
    ...manifest,
    formatRevision: 2,
    mission: {
      title: 'BVR 2v2',
      category: 'combat',
      briefing: 'Two flights meet over the mountains.',
      debriefing: null,
      theater: 'Kerbin',
      author: 'MNCS',
      tags: ['bvr', 'training'],
      notes: null,
    },
    session: {
      ...session,
      ut0: 99,
      gaps: [{ startUt: 100.02, endUt: 100.05, reason: 'pause' }],
      chapters: [{ id: 'ch1', name: 'Merge', startUt: 100, endUt: 100.1, reason: 'manual' }],
    },
    actors: 'actors.json',
    effects: 'effects.json',
    locks: 'locks.json',
    vessels: [
      {
        ...((manifest['vessels'] as unknown[])[0] as Record<string, unknown>),
        side: 'blue',
        callsign: 'Falcon 1',
        kind: 'fixedwing',
        health: 0.8,
        loadout: ['AIM-120'],
      },
    ],
  }
}

function v11Archive(): Uint8Array {
  const actorSamples = sampleColumns([100, 100.1])
  return buildArchive({
    manifest: v11Manifest(),
    events: [
      {
        ut: 100,
        type: 'weapon_release',
        vessel: VESSEL_ID,
        target: 'red-1',
        source: VESSEL_ID,
        weapon: 'AIM-120',
        outcome: 'launched',
        range: 12000,
        aspect: 35,
        damage: 0,
        body: 'Kerbin',
        lat: 0,
        lon: 0,
        alt: 70,
        data: {},
      },
      ...defaultEvents(),
    ],
    extraEntries: {
      'actors.json': new TextEncoder().encode(
        JSON.stringify({
          actors: [
            {
              id: 'a-1',
              name: 'AIM-120',
              kind: 'missile',
              side: 'blue',
              parent: VESSEL_ID,
              target: 'red-1',
              weapon: 'AIM-120',
              body: 'Kerbin',
              startUt: 100,
              endUt: 100.1,
              samples: actorSamples,
            },
          ],
        }),
      ),
      'effects.json': new TextEncoder().encode(
        JSON.stringify({
          effects: [
            { ut: 100.05, kind: 'chaff', body: 'Kerbin', lat: 0, lon: 0.01, alt: 70, count: 12, seed: 42, life: 2 },
          ],
        }),
      ),
      'locks.json': new TextEncoder().encode(
        JSON.stringify({
          locks: [
            { source: VESSEL_ID, target: 'red-1', sensor: 'radar', mode: 'stt', startUt: 100, endUt: 100.1 },
          ],
        }),
      ),
    },
  })
}

describe('format v1.1', () => {
  it('still parses a v1 archive with no v1.1 fields', () => {
    const replay = parseArchive(buildArchive())
    expect(replay.mission).toBeNull()
    expect(replay.gaps).toEqual([])
    expect(replay.chapters).toEqual([])
    expect(replay.actors).toEqual([])
    expect(replay.effects).toEqual([])
    expect(replay.locks).toEqual([])
    expect(replay.vessels[0]!.side).toBe('neutral')
    expect(replay.vessels[0]!.kind).toBe('unknown')
    expect(replay.vessels[0]!.transient).toBe(false)
  })

  it('parses v1.1 mission, gaps, actors, effects and events', () => {
    const replay = parseArchive(v11Archive())
    expect(replay.mission?.title).toBe('BVR 2v2')
    expect(replay.manifest.formatRevision).toBe(2)
    expect(replay.gaps).toHaveLength(1)
    expect(replay.chapters).toHaveLength(1)
    expect(replay.vessels).toHaveLength(2)
    expect(replay.vessels.filter((v) => v.transient)).toHaveLength(1)
    expect(replay.actors).toHaveLength(1)
    expect(replay.actors[0]!.parent).toBe(VESSEL_ID)
    expect(replay.effects).toHaveLength(1)
    expect(replay.effects[0]!.kind).toBe('chaff')
    expect(replay.locks).toHaveLength(1)
    expect(replay.locks[0]!.sensor).toBe('radar')
    const release = replay.events.find((event) => event.type === 'weapon_release')
    expect(release?.source).toBe(VESSEL_ID)
    expect(release?.target).toBe('red-1')
    expect(release?.weapon).toBe('AIM-120')
    expect(release?.outcome).toBe('launched')
    expect(release?.range).toBe(12000)
    expect(release?.aspect).toBe(35)
    expect(replay.vessels[0]!.side).toBe('blue')
    expect(replay.vessels[0]!.kind).toBe('fixedwing')
    expect(replay.vessels[0]!.health).toBeCloseTo(0.8, 6)
    expect(replay.vessels[0]!.loadout).toEqual(['AIM-120'])
  })

  it('parses optional combat sample columns without inventing zeroes', () => {
    const times = [100, 100.1]
    const track = defaultTrack()
    const segments = track['segments'] as Record<string, unknown>[]
    const samples = segments[0]!['samples'] as Record<string, unknown>
    segments[0]!['samples'] = {
      ...samples,
      ias: [100, 110],
      mach: [0.3, 0.4],
      aoa: [1, 2],
      aos: [0, 1],
      agl: [50, 60],
      dynPress: [12, 14],
      pitch: [0.1, 0.2],
      roll: [0, 0.1],
      yaw: [0, -0.1],
      gear: [1, 0],
      flaps: [0, 0.5],
      brakes: [0, 1],
      health: [1, 0.7],
    }
    const replay = parseArchive(buildArchive({ track, bodies: defaultBodies() }))
    const parsed = replay.vessels[0]!.segments[0]!.samples!
    expect(parsed.ias?.[1]).toBeCloseTo(110, 6)
    expect(parsed.mach?.[1]).toBeCloseTo(0.4, 6)
    expect(parsed.agl?.[1]).toBeCloseTo(60, 6)
    expect(parsed.health?.[1]).toBeCloseTo(0.7, 6)
    expect(times).toHaveLength(2)
  })

  it('accepts actor samples without an attitude quaternion', () => {
    const samples = sampleColumns([100, 100.1])
    delete samples['q']
    const archive = buildArchive({
      manifest: v11Manifest(),
      events: defaultEvents(),
      extraEntries: {
        'actors.json': new TextEncoder().encode(
          JSON.stringify({
            actors: [
              {
                id: 'a-1',
                name: 'AIM-120',
                kind: 'weapon/missile',
                body: 'Kerbin',
                samples,
              },
            ],
          }),
        ),
      },
    })
    const replay = parseArchive(archive)
    expect(replay.actors).toHaveLength(1)
    expect(Array.from(replay.actors[0]!.samples.q.slice(0, 4))).toEqual([0, 0, 0, 1])
  })

  it('skips a malformed optional actor without rejecting the archive', () => {
    const archive = v11Archive()
    // Replace actors.json with one valid and one malformed entry.
    const bad = buildArchive({
      manifest: v11Manifest(),
      events: defaultEvents(),
      extraEntries: {
        'actors.json': new TextEncoder().encode(
          JSON.stringify({
            actors: [
              { id: 'a-1', body: 'Kerbin', samples: sampleColumns([100, 100.1]) },
              { id: 'bad', body: 'Kerbin' },
            ],
          }),
        ),
      },
    })
    expect(archive.length).toBeGreaterThan(0)
    const replay = parseArchive(bad)
    expect(replay.actors).toHaveLength(1)
    expect(replay.warnings.some((warning) => warning.code === 'optionalSection')).toBe(true)
  })
})
