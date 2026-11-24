import { unzipSync, strFromU8 } from 'fflate'
import { expect, it } from 'vitest'
import { parseArchiveAsync } from '../src/format/parseClient'
import { processParseRequest } from '../src/format/parseWorkerProtocol'
import { sampleVessel } from '../src/playback/track'

async function fetchArchive(name: 'writer' | 'aeroequus') {
  const response = await fetch(`/__kerbtac-test__/${name}.kerbtac`)
  if (response.status === 404 && name === 'aeroequus') return null
  if (!response.ok) throw new Error(`${name}: ${await response.text()}`)
  return response.arrayBuffer()
}

function rawTrack(input: ArrayBuffer, name: string) {
  const files = unzipSync(new Uint8Array(input))
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  const path = manifest.vessels.find((v: { name: string }) => v.name === name).track
  return JSON.parse(strFromU8(files[path]))
}

it('replays sparse rev 4 chunks emitted at test time by the C# archive writer', async () => {
  const input = (await fetchArchive('writer'))!
  const track = rawTrack(input, 'Falcon 1')
  expect(track.segments.map((s: { chunkIndex: number }) => s.chunkIndex)).toEqual([0, 1, 2, 3])
  expect(track.segments[0].samples.brakes).toEqual([0, null])
  expect(track.segments[1].samples).not.toHaveProperty('pitch')
  expect(track.segments[2].samples).not.toHaveProperty('pitch')
  expect(track.segments[3].samples).not.toHaveProperty('ox')

  const replay = await parseArchiveAsync(input, 'writer.kerbtac')
  expect(input.byteLength).toBe(0)
  expect(replay.manifest.formatRevision).toBe(4)
  const vessel = replay.vessels.find(v => v.name === 'Falcon 1')!
  const samples = vessel.segments[0].samples!
  expect(samples.length).toBe(601)
  expect(Array.from(samples.pitch!.slice(0, 6))).toEqual([0, 0.25, NaN, NaN, NaN, NaN])
  expect(samples.pitch![6]).toBe(-0.5)
  expect(Array.from(samples.stage!.slice(0, 7))).toEqual([0, 2, NaN, NaN, NaN, NaN, 4])
  expect(Array.from(samples.lf!.slice(0, 7))).toEqual([0, NaN, NaN, NaN, NaN, NaN, 100])
  expect(samples.ox).toBeNull()
  const at = (i: number) => sampleVessel(vessel, samples.t[i], replay.bodies)
  expect(at(0)).toMatchObject({ stage: 0, health: 0, lf: 0, brakes: 0 })
  expect(at(2)).toMatchObject({ stage: null, health: null, lf: null, brakes: null })
  expect(at(6)).toMatchObject({ stage: 4, health: 0.75, lf: 100 })
}, 60_000)

const aeroequus = await fetchArchive('aeroequus')
it.skipIf(!aeroequus)('preserves AeroEquus logical segment 9 recorded pitch and transfers its missing rows', async () => {
  const input = aeroequus!
  const track = rawTrack(input, 'AeroEquus')
  const chunks = track.segments.filter((s: { logicalIndex: number }) => s.logicalIndex === 9)
  const recordedPitch: number[] = chunks[0].samples.pitch
  expect(recordedPitch).toHaveLength(600)
  expect(recordedPitch).toContain(0)
  expect(recordedPitch.some(v => v !== 0)).toBe(true)
  expect(chunks.slice(1).every((s: { samples: Record<string, unknown> }) => !('pitch' in s.samples))).toBe(true)

  const { response, transfer } = processParseRequest({ bytes: input })
  if (!('replay' in response)) throw new Error(JSON.stringify(response))
  const table = response.replay.vessels.find(v => v.name === 'AeroEquus')!.segments.find(s => s.logicalIndex === 9)!.samples!
  expect(transfer).toContain(table.pitch?.buffer)
  expect(transfer).toContain(table.stage?.buffer)

  const replay = await parseArchiveAsync(input, 'AeroEquus.kerbtac')
  expect(input.byteLength).toBe(0)
  const vessel = replay.vessels.find(v => v.name === 'AeroEquus')!
  const samples = vessel.segments.find(s => s.logicalIndex === 9)!.samples!
  expect(samples.length).toBe(3144)
  expect(samples.pitch!.slice(0, 600)).toEqual(Float32Array.from(recordedPitch))
  expect(samples.pitch!.slice(600).every(Number.isNaN)).toBe(true)
  const state = sampleVessel(vessel, samples.t[0], replay.bodies)
  expect(state?.body).toBe('Kerbin')
  expect(state?.alt).toBeCloseTo(samples.alt[0], 5)
})
