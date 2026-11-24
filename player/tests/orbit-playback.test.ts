import { describe, expect, it } from 'vitest'
import { sampleVessel } from '../src/playback/track'
import type { CelestialBodyDef, SampleTable, TrackSegment, VesselTrack } from '../src/format/types'

const MU = 3.5316e12
const R = 600000

function body(): CelestialBodyDef {
  return {
    name: 'Kerbin',
    parent: null,
    radius: R,
    gravParameter: MU,
    atmosphereDepth: 70000,
    sphereOfInfluence: 84159286,
    rotation: { epochUt: 0, q0: [0, 0, 0, 1], axis: [0, 1, 0], rateDegPerSec: 0 },
    orbit: null,
    style: null,
  }
}

function samples(times: number[]): SampleTable {
  const n = times.length
  return {
    length: n,
    t: Float64Array.from(times),
    lat: Float64Array.from(times.map(() => 0)),
    lon: Float64Array.from(times.map(() => 0)),
    alt: Float64Array.from(times.map(() => 100000)),
    q: Float32Array.from(times.flatMap(() => [0, 0, 0, 1])),
    vx: null, vy: null, vz: null,
    throttle: null, mass: null, gee: null, stage: null, situation: null,
    hdg: null, vs: null, lf: null, ox: null, ec: null, mp: null,
    srfSpeed: null, ias: null, mach: null, aoa: null, aos: null, agl: null,
    dynPress: null, pitch: null, roll: null, yaw: null, gear: null,
    flaps: null, brakes: null, health: null,
  }
}

function vessel(withOrbit: boolean): VesselTrack {
  const segments: TrackSegment[] = [
    {
      index: 0, logicalIndex: 0, chunkIndex: 0,
      kind: 'flight', body: 'Kerbin', startUt: 0, endUt: 60,
      source: 'active', boundary: false, orbit: null,
      samples: samples([0, 60]),
    },
  ]
  if (withOrbit) {
    segments.push({
      index: 1, logicalIndex: 1, chunkIndex: 0,
      kind: 'orbit', body: 'Kerbin', startUt: 0, endUt: 60,
      source: null, boundary: false, samples: null,
      orbit: {
        epoch: 0, semiMajorAxis: 700000, eccentricity: 0,
        inclinationDeg: 0, lanDeg: 0, argPeDeg: 0, meanAnomalyDeg: 0,
      },
    })
  }
  return {
    id: 'v', name: 'Rocket', type: 'Ship', body: 'Kerbin', color: null, team: null,
    rootPart: null, partCount: null, crewCount: null, side: 'neutral', callsign: null,
    kind: 'space/rocket', health: null, loadout: [], transient: false, segments,
  }
}

const bodies = new Map([['Kerbin', body()]])

describe('orbit playback', () => {
  it('propagates across a long sample gap when an orbit segment covers it', () => {
    const v = vessel(true)
    const period = 2 * Math.PI * Math.sqrt(700000 ** 3 / MU)
    v.segments[0].samples!.t[1] = period / 4
    v.segments[0].samples!.lon[1] = 90
    v.segments[0].endUt = v.segments[1].endUt = period / 4
    const state = sampleVessel(v, period / 8, bodies)
    expect(state).not.toBeNull()
    expect(state?.alt).toBeCloseTo(100000, 0)
    expect(state?.lat).toBeCloseTo(0)
    expect(state?.lon).toBeCloseTo(45)
    expect(Math.hypot(state!.bf.x,state!.bf.y,state!.bf.z)).toBeCloseTo(700000, 1)
  })

  it('keeps measured anchors and falls back between them for incompatible old elements', () => {
    const v = vessel(true)
    const s = v.segments[0].samples!
    s.lat.fill(42); s.lon.set([50,52])
    v.segments[1].orbit!.lanDeg = 11924
    expect(sampleVessel(v, 0, bodies)?.lat).toBe(42)
    expect(sampleVessel(v, 30, bodies)?.lon).toBeCloseTo(51)
    expect(sampleVessel(v, 60, bodies)?.lon).toBe(52)
  })

  it('keeps linear interpolation when the gap is short', () => {
    const v = vessel(true)
    const seg = v.segments[0] as TrackSegment
    seg.samples = samples([0, 1])
    seg.endUt = 1
    const state = sampleVessel(v, 0.5, bodies)
    expect(state?.lon).toBeCloseTo(0)
  })

  it('keeps linear interpolation without an orbit segment', () => {
    const state = sampleVessel(vessel(false), 30, bodies)
    expect(state?.lon).toBeCloseTo(0)
  })
})
