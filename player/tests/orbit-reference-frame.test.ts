import { expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { sampleVessel } from '../src/playback/track'
import { buildArchive, defaultTrack } from './helpers/archive'

const A = 700000
const R = 600000
const frame = { kind: 'ksp-zup-spin-v1', epochUt: 92, angleDeg: 17, rateDegPerSec: 0.25 }
const orbit = {
  epoch: 85, semiMajorAxis: A, eccentricity: 0,
  inclinationDeg: 0, lanDeg: 30, argPeDeg: 0, meanAnomalyDeg: 10,
}

function readReplay(t: number[], lon: number[], elements: object, options: {
  lat?: number[], alt?: number[], rotation?: object, window?: [number, number],
  gravParameter?: number, indices?: [number, number],
} = {}) {
  const [startUt, endUt] = options.window ?? [t[0], t[t.length - 1]]
  const [flightIndex, orbitIndex] = options.indices ?? [0, 1]
  return parseArchive(buildArchive({
    bodies: {
      Kerbin: {
        name: 'Kerbin', parent: null, radius: R,
        gravParameter: options.gravParameter ?? (Math.PI / 180) ** 2 * A ** 3,
        rotation: options.rotation ?? { epochUt: 9000, q0: [0, 1, 0, 0], axis: [0, 1, 0], rateDegPerSec: 7 },
      },
    },
    track: {
      ...defaultTrack(),
      segments: [
        {
          index: flightIndex, kind: 'flight', body: 'Kerbin', startUt: t[0], endUt: t[t.length - 1],
          samples: {
            t, lon, lat: options.lat ?? t.map(() => 0), alt: options.alt ?? t.map(() => A - R),
            q: t.flatMap(() => [0, 0, 0, 1]),
          },
        },
        { index: orbitIndex, kind: 'orbit', body: 'Kerbin', startUt, endUt, orbit: elements },
      ],
    },
  }))
}

it.each([
  { rate: 0.25, endpoints: [36, 66], middle: 51 },
  { rate: -0.25, endpoints: [40, 90], middle: 65 },
])('uses the marked absolute spin ($rate °/s) instead of session q0', ({ rate, endpoints, middle }) => {
  // Circular inertial azimuth at UT 100/120/140 = 55/75/95°. Absolute
  // prime-meridian angle is 17 + rate * (UT - 92). Circle radius is 700 km.
  const bfRotation = { ...frame, rateDegPerSec: rate }
  const replay = readReplay([100, 140], endpoints, { ...orbit, bfRotation })
  const v = replay.vessels[0]
  expect(v.segments.find(s => s.kind === 'orbit')?.orbit).toMatchObject({ bfRotation })
  const s = sampleVessel(v, 120, replay.bodies)!
  expect(s.lat).toBeCloseTo(0, 10)
  expect(s.lon).toBeCloseTo(middle, 9)
  expect(Math.hypot(s.bf.x, s.bf.y, s.bf.z)).toBeCloseTo(A, 5) // not a chord
  expect(sampleVessel(v, 100, replay.bodies)?.lon).toBeCloseTo(endpoints[0], 10)
  expect(sampleVessel(v, 140, replay.bodies)?.lon).toBeCloseTo(endpoints[1], 10)
})

it('uses Z-up north on a polar orbit with independent nonzero phase and phase epoch', () => {
  // At UT 100/160: true anomalies 30/90° in a polar plane; the midpoint
  // is at latitude 60°, and away from the pole its inertial azimuth is 30°.
  const elements = { ...orbit, epoch: 80, meanAnomalyDeg: 10, inclinationDeg: 90, bfRotation: frame }
  const replay = readReplay([100, 160], [11, 0], elements, { lat: [30, 90] })
  const s = sampleVessel(replay.vessels[0], 130, replay.bodies)!
  expect(s.lat).toBeCloseTo(60, 9)
  expect(s.lon).toBeCloseTo(3.5, 9)
  expect(s.alt).toBeCloseTo(A - R, 5)
})

it.each([
  { label: 'unknown marker', metadata: { ...frame, kind: 'future-frame' } },
  { label: 'missing rate', metadata: { ...frame, rateDegPerSec: undefined } },
  { label: 'non-numeric phase', metadata: { ...frame, angleDeg: '17' } },
  { label: 'non-finite epoch', metadata: { ...frame, epochUt: Infinity } },
  { label: 'explicit null', metadata: null },
])('falls back for $label without treating the metadata as legacy', ({ metadata }) => {
  // The legacy scene rotation is deliberately self-consistent with the
  // samples. Invalid *present* metadata must not enter that legacy path.
  const rotation = { epochUt: 0, q0: [0, 0, 0, 1], axis: [0, 1, 0], rateDegPerSec: 0 }
  const replay = readReplay([100, 140], [55, 95], { ...orbit, bfRotation: metadata }, { rotation })
  const v = replay.vessels[0]
  expect(v.segments.find(s => s.kind === 'orbit')?.orbit).toMatchObject({ bfRotation: null })
  const s = sampleVessel(v, 120, replay.bodies)!
  expect(s.lon).toBeCloseTo(75, 9)
  expect(Math.hypot(s.bf.x, s.bf.y, s.bf.z)).toBeCloseTo(A * Math.cos(20 * Math.PI / 180), 5)
})

it.each([
  { label: 'left anchor disagrees', lon: [37, 66], window: [100, 140] },
  { label: 'right anchor disagrees', lon: [36, 67], window: [100, 140] },
  { label: 'span covers only the query, not both anchors', lon: [36, 66], window: [105, 135] },
])('falls back when $label', ({ lon, window }) => {
  const replay = readReplay([100, 140], lon, { ...orbit, bfRotation: frame },
    { window: window as [number, number] })
  const s = sampleVessel(replay.vessels[0], 120, replay.bodies)!
  expect(s.lon).toBeCloseTo((lon[0] + lon[1]) / 2, 9)
  expect(Math.hypot(s.bf.x, s.bf.y, s.bf.z)).toBeLessThan(A - 20000)
})

it('replays an unmarked historical Kerbal 1-6 excerpt without replacing the anchors', () => {
  // ZIP SHA256 c604e1e08ead35bd5e58cc129d8e66eebcbb9d6ce0601d132ea2d6778706a1b0,
  // flight 95 rows 354..356, orbit 101. Transport is a test ZIP of those
  // historical numbers, not a newly recorded KSP flight.
  const t = [2985025.8225994115, 2985035.8225994115, 2985045.8225994115]
  const lon = [52.1042534, 53.3320711, 55.1778346]
  const lat = [0.0009967, 0.0009771, 0.0009564]
  const alt = [98579.72, 98610.79, 98643.34]
  const historicalOrbit = {
    epoch: 2984857.406862107, semiMajorAxis: 700034.3230179867, eccentricity: 0.0024765441843981064,
    inclinationDeg: 0.06648548488435685, lanDeg: 11924.314953177876,
    argPeDeg: 5028.275561180342, meanAnomalyDeg: 1.9239418168301665,
  }
  for (const scale of [1, Math.PI / 180]) {
    const replay = readReplay(t, lon, {
      ...historicalOrbit, inclinationDeg: historicalOrbit.inclinationDeg * scale,
      lanDeg: historicalOrbit.lanDeg * scale, argPeDeg: historicalOrbit.argPeDeg * scale,
    }, {
      lat, alt, indices: [95, 101], window: [2984857.4268621067, 2992696.422570123],
      gravParameter: 3531599999999.9995,
      rotation: {
        epochUt: 2984127.2450552098, q0: [0, -0.99965876340866089, 0, -0.026122558861970901],
        axis: [0, 1, 0], rateDegPerSec: 0.016705782030905291,
      },
    })
    const sample = (ut: number) => sampleVessel(replay.vessels[0], ut, replay.bodies)!
    for (let i = 0; i < t.length; i++) {
      expect(sample(t[i])).toMatchObject({ lat: lat[i], alt: alt[i], segmentIndex: 95 })
      expect(sample(t[i]).lon).toBeCloseTo(lon[i], 10)
    }
    expect(sample(t[0] + 5).lon).toBeCloseTo(52.71816225, 10)
    expect(sample(t[0] + 5).alt).toBeCloseTo(98595.255, 6)
  }
})
