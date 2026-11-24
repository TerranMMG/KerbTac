import { zipSync, type Zippable } from 'fflate'
import { MAX_MODELS_BYTES, MAX_MODEL_BYTES, parseModelsFile, serializeModelsFile, type ModelsFile } from './models'
import { isModelEntryPath, MODELS_PATH, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES, type Archive } from './parse'

export async function writeReplayWithModels(
  archive: Archive,
  models: ModelsFile,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries: Zippable = Object.create(null)
  let total = 0
  let modelTotal = 0
  for (const [name, data] of archive.entries) {
    if (name === MODELS_PATH || isModelEntryPath(name)) continue
    entries[name] = data
    total += data.byteLength
  }

  const paths = new Map<string, string>()
  const bindings: ModelsFile['models'] = []
  for (const binding of models.models) {
    const extension = /\.(obj|stl)$/i.exec(binding.file)?.[1]?.toLowerCase()
    if (!extension) throw new Error('Expected an OBJ or STL model')
    let path = paths.get(binding.file)
    if (!path) {
      const data = files.get(binding.file)
      if (!data?.byteLength) throw new Error(`Missing model: ${binding.file}`)
      if (data.byteLength > MAX_MODEL_BYTES) throw new Error('Model exceeds 50 MiB')
      const digest = await crypto.subtle.digest('SHA-256',
        data.buffer instanceof ArrayBuffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Uint8Array.from(data))
      const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      path = `models/${hex}.${extension}`
      paths.set(binding.file, path)
      if (!(path in entries)) {
        modelTotal += data.byteLength
        if (modelTotal > MAX_MODELS_BYTES) throw new Error('Models exceed 300 MiB')
        entries[path] = [data, { level: extension === 'stl' ? 0 : 3 }]
      }
    }
    bindings.push({ ...binding, file: path })
  }

  if (bindings.length > 0) {
    const metadata = serializeModelsFile({ version: models.version, models: bindings })
    parseModelsFile(metadata)
    if (metadata.byteLength > MAX_ENTRY_BYTES) throw new Error('Model metadata exceeds archive entry size limit')
    entries[MODELS_PATH] = metadata
    total += metadata.byteLength + modelTotal
  }
  if (total > MAX_TOTAL_BYTES || Object.keys(entries).length > MAX_ENTRIES) {
    throw new Error('Result exceeds archive size or entry count limit')
  }
  return zipSync(entries, { level: 3 })
}

export function modelArchiveName(fileName: string): string {
  return `${fileName.replace(/(?:\.with-models)?\.kerbtac$/i, '')}.with-models.kerbtac`
}
