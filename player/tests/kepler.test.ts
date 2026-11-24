import { describe, expect, it } from 'vitest'
import { solveEccentricAnomaly, orbitPositionInertial, orbitPositionBF, bfToLatLonAlt } from '../src/playback/kepler'
import type { CelestialBodyDef, OrbitElements } from '../src/format/types'

const MU = 3.5316e12

function orbit(overrides: Partial<OrbitElements> = {}): OrbitElements {
  return {
    epoch: 0,
    semiMajorAxis: 700000,
    eccentricity: 0,
    inclinationDeg: 0,
    lanDeg: 0,
    argPeDeg: 0,
    meanAnomalyDeg: 0,
    ...overrides,
  }
}

function body(rotation: Partial<CelestialBodyDef['rotation']> = {}): CelestialBodyDef {
  return {
    name: 'Kerbin',
    parent: null,
    radius: 600000,
    gravParameter: MU,
    atmosphereDepth: 70000,
    sphereOfInfluence: 84159286,
    rotation: { epochUt: 0, q0: [0, 0, 0, 1], axis: [0, 1, 0], rateDegPerSec: 0, ...rotation },
    orbit: null,
    style: null,
  }
}

const period = 2 * Math.PI * Math.sqrt(700000 ** 3 / MU)

describe('kepler', () => {
  it('solves the eccentric anomaly', () => {
    expect(solveEccentricAnomaly(0, 0)).toBeCloseTo(0)
    expect(solveEccentricAnomaly(Math.PI, 0.5)).toBeCloseTo(Math.PI)
    const E = solveEccentricAnomaly(1.2, 0.3)
    expect(E - 0.3 * Math.sin(E)).toBeCloseTo(1.2, 9)
  })

  it('returns to the same point after one period', () => {
    const a = orbitPositionInertial(orbit(), MU, 0)
    const b = orbitPositionInertial(orbit(), MU, period)
    expect(b.x).toBeCloseTo(a.x, 3)
    expect(b.y).toBeCloseTo(a.y, 3)
    expect(b.z).toBeCloseTo(a.z, 3)
  })

  it('places perigee and apogee at the expected radii', () => {
    const perigee = orbitPositionInertial(orbit({ eccentricity: 0.5 }), MU, 0)
    expect(Math.hypot(perigee.x, perigee.y, perigee.z)).toBeCloseTo(350000, 3)
    const apoTime = Math.PI * Math.sqrt(700000 ** 3 / MU)
    const apogee = orbitPositionInertial(orbit({ eccentricity: 0.5 }), MU, apoTime)
    expect(Math.hypot(apogee.x, apogee.y, apogee.z)).toBeCloseTo(1050000, 3)
  })

  it('rotates inertial positions into the body-fixed frame', () => {
    const inertial = orbitPositionInertial(orbit(), MU, 0)
    const bf = orbitPositionBF(orbit(), MU, body(), 0)!
    expect(Math.hypot(bf.x, bf.y, bf.z)).toBeCloseTo(Math.hypot(inertial.x, inertial.y, inertial.z), 3)

    const spun = orbitPositionBF(orbit(), MU, body({ rateDegPerSec: 0.5 }), 120)!
    const angle = (2 * Math.PI * 120 / period) + 0.5 * 120 * (Math.PI / 180)
    // The body rotated +angle about +Y, so an inertial-fixed point moves to
    // +z in the body-fixed frame.
    expect(Math.atan2(spun.z, spun.x)).toBeCloseTo(angle, 6)
  })

  it('places the quarter-period point of a polar orbit over the north pole', () => {
    const p = orbitPositionBF(orbit({inclinationDeg:90}), MU, body(), period / 4)!
    expect(bfToLatLonAlt(p, 600000).lat).toBeCloseTo(90)
  })

  it('converts body-fixed positions to latitude and longitude', () => {
    const geo = bfToLatLonAlt({ x: 700000, y: 0, z: 0 }, 600000)
    expect(geo.lat).toBeCloseTo(0)
    expect(geo.lon).toBeCloseTo(0)
    expect(geo.alt).toBeCloseTo(100000, 6)
  })
})
