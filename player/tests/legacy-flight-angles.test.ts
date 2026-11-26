import { expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { buildArchive, defaultManifest, sampleColumns } from './helpers/archive'

function angles(version: string) {
  const samples = {
    ...sampleColumns([100, 100.1]),
    q: [0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, 0, 0, 1],
    vx: [100, null], vy: [-10, -10], vz: [-5, 100],
    aoa: [-116.57, -5.71], aos: [92.86, null],
  }
  return parseArchive(buildArchive({
    manifest: { ...defaultManifest(), generator: { name: 'KerbTac Recorder', version } },
    track: { segments: [{ index: 0, kind: 'flight', body: 'Kerbin', startUt: 100, endUt: 100.1, samples }] },
  })).vessels[0].segments[0].samples!
}

it('reconstructs v0.1.0 angles in the recorded vessel frame and drops unrecoverable angles', () => {
  const samples = angles('0.1.0')
  expect(samples.aoa![0]).toBeCloseTo(5.7106)
  expect(samples.aos![0]).toBeCloseTo(2.8624)
  expect(samples.aoa![1]).toBeNaN()
  expect(samples.aos![1]).toBeNaN()
})

it('preserves the angle columns of newer recordings', () => {
  const samples = angles('0.1.1')
  expect(samples.aoa![0]).toBeCloseTo(-116.57)
  expect(samples.aos![0]).toBeCloseTo(92.86)
  expect(samples.aoa![1]).toBeCloseTo(-5.71)
  expect(samples.aos![1]).toBeNaN()
})
