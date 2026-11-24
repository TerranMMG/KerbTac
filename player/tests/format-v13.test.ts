import { describe, expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import {
  VESSEL_ID,
  buildArchive,
  defaultManifest,
  defaultTrack,
} from './helpers/archive'

function v13Manifest(): Record<string, unknown> {
  const manifest = defaultManifest()
  const session = manifest['session'] as Record<string, unknown>
  const vessel = (manifest['vessels'] as unknown[])[0] as Record<string, unknown>
  return {
    ...manifest,
    formatRevision: 4,
    session: { ...session, recordingMode: 'space' },
    vessels: [
      {
        ...vessel,
        role: 'stage.booster',
        parentId: 'mother-1',
        stageIndex: 2,
        separatedUt: 100.05,
        modelRole: 'space.stage',
        threat: { missileRangeM: 12000, radarRangeM: 40000, threatRadiusM: 12000 },
      },
    ],
  }
}

function v13Track(): Record<string, unknown> {
  const track = defaultTrack()
  const segments = (track['segments'] as unknown[]).slice()
  segments.push({
    index: 1,
    logicalIndex: 1,
    chunkIndex: 0,
    kind: 'orbit',
    body: 'Kerbin',
    startUt: 100.2,
    endUt: 200,
    orbit: {
      epoch: 100.2,
      semiMajorAxis: 700000,
      eccentricity: 0.01,
      inclinationDeg: 28.5,
      lanDeg: 120,
      argPeDeg: 30,
      meanAnomalyDeg: 10,
    },
  })
  return { ...track, segments }
}

describe('format v1.3', () => {
  it('parses recording mode, lineage, model role and threat ranges', () => {
    const replay = parseArchive(buildArchive({ manifest: v13Manifest() }))
    expect(replay.manifest.formatRevision).toBe(4)
    expect(replay.manifest.session.recordingMode).toBe('space')

    const vessel = replay.vessels.find((v) => v.id === VESSEL_ID)
    expect(vessel).toBeDefined()
    expect(vessel?.role).toBe('stage.booster')
    expect(vessel?.parentId).toBe('mother-1')
    expect(vessel?.stageIndex).toBe(2)
    expect(vessel?.separatedUt).toBeCloseTo(100.05)
    expect(vessel?.modelRole).toBe('space.stage')
    expect(vessel?.threat?.threatRadiusM).toBe(12000)
  })

  it('parses sample-less orbit segments', () => {
    const replay = parseArchive(buildArchive({ manifest: v13Manifest(), track: v13Track() }))
    const vessel = replay.vessels.find((v) => v.id === VESSEL_ID)
    const orbit = vessel?.segments.find((segment) => segment.kind === 'orbit')
    expect(orbit).toBeDefined()
    expect(orbit?.samples).toBeNull()
    expect(orbit?.startUt).toBeCloseTo(100.2)
    expect(orbit?.endUt).toBeCloseTo(200)
    expect(orbit?.orbit?.semiMajorAxis).toBe(700000)
  })

  it('does not warn about overlap between a flight segment and its orbit span', () => {
    const track = defaultTrack()
    const flight = (track['segments'] as Record<string, unknown>[])[0] as Record<string, unknown>
    flight['endUt'] = 200
    flight['samples'] = {
      ...(flight['samples'] as Record<string, unknown>),
      t: [100, 200],
      lat: [0, 0],
      lon: [0, 0],
      alt: [70, 70],
      q: [0, 0, 0, 1, 0, 0, 0, 1],
    }
    ;(track['segments'] as unknown[]).push({
      index: 1,
      logicalIndex: -2,
      chunkIndex: 0,
      kind: 'orbit',
      body: 'Kerbin',
      startUt: 100,
      endUt: 200,
      orbit: {
        epoch: 100,
        semiMajorAxis: 700000,
        eccentricity: 0,
        inclinationDeg: 0,
        lanDeg: 0,
        argPeDeg: 0,
        meanAnomalyDeg: 0,
      },
    })
    const replay = parseArchive(buildArchive({ manifest: v13Manifest(), track }))
    expect(replay.warnings.filter((warning) => warning.code === 'timeOutOfRange')).toHaveLength(0)
  })

  it('defaults old recordings to combat and no lineage', () => {
    const replay = parseArchive(buildArchive())
    expect(replay.manifest.session.recordingMode).toBeNull()
    const vessel = replay.vessels.find((v) => v.id === VESSEL_ID)
    expect(vessel?.role).toBeNull()
    expect(vessel?.parentId).toBeNull()
    expect(vessel?.stageIndex).toBeNull()
    expect(vessel?.modelRole).toBeNull()
    expect(vessel?.threat).toBeNull()
  })
})
