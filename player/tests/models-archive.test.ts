import { describe, expect, it } from 'vitest'
import { type ModelBinding } from '../src/format/models'
import { readArchive } from '../src/format/parse'
import { parseArchive } from '../src/format/validate'
import { modelArchiveName, writeReplayWithModels } from '../src/format/writeModels'
import { buildArchive, VESSEL_ID } from './helpers/archive'

const encode = (text: string) => new TextEncoder().encode(text)
const mesh = encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
const digest = await crypto.subtle.digest('SHA-256', mesh)
const hashPath = `models/${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}.obj`
const binding: ModelBinding = { vesselId: VESSEL_ID, file: 'first.obj', scale: 2, rotation: [0, 5, 0], offset: [1, 2, 3] }

describe('writeReplayWithModels', () => {
  it('preserves the source entries and round-trips the binding and model bytes', async () => {
    const original = buildArchive({ extraEntries: {
      'vendor/data.bin': Uint8Array.of(1, 2, 3),
      'models/vendor.txt': encode('unrelated metadata'),
    } })
    const source = readArchive(original)
    const before = new Map(source.entries)
    const zipped = await writeReplayWithModels(source, { version: 1, models: [binding] }, new Map([[binding.file, mesh]]))
    const read = readArchive(zipped)
    for (const [name, data] of before) expect(read.entries.get(name)).toEqual(data)
    expect(source.entries).toEqual(before)
    const replay = parseArchive(zipped)
    expect(replay.models).toEqual([{ ...binding, file: hashPath }])
    expect(replay.modelFiles.get(hashPath)).toEqual(mesh)
  })

  it('stores a single entry for identical OBJ bytes selected under different names', async () => {
    const second = { ...binding, file: 'second.OBJ', vesselId: 'second-vessel' }
    const zipped = await writeReplayWithModels(readArchive(buildArchive()), { version: 1, models: [binding, second] },
      new Map([[binding.file, mesh], [second.file, Uint8Array.from(mesh)]]))
    expect([...readArchive(zipped).entries.keys()].filter(key => key.startsWith('models/'))).toEqual([hashPath])
  })

  it('removes stale extension entries when no replacements remain', async () => {
    const source = readArchive(buildArchive({ extraEntries: { 'models.json': encode('{}'), [hashPath]: mesh } }))
    const zipped = await writeReplayWithModels(source, { version: 1, models: [] }, new Map())
    expect([...readArchive(zipped).entries.keys()].filter(key => key === 'models.json' || key.startsWith('models/')))
      .toEqual([])
  })

  it('rejects an individual model over 50 MiB', async () => {
    const model = new Uint8Array(50 * 1024 * 1024 + 1)
    await expect(writeReplayWithModels(readArchive(buildArchive()), { version: 1, models: [binding] },
      new Map([[binding.file, model]]))).rejects.toThrow(/50 MiB/)
  })

  it('does not hide unknown model files behind a successful export', async () => {
    await expect(writeReplayWithModels(readArchive(buildArchive()), { version: 1, models: [binding] },
      new Map())).rejects.toThrow(/Missing model/)
  })

  it('adds the download suffix once and handles a case-insensitive source extension', () => {
    expect(modelArchiveName('flight.KERBTAC')).toBe('flight.with-models.kerbtac')
    expect(modelArchiveName('flight.with-models.kerbtac')).toBe('flight.with-models.kerbtac')
  })
})
