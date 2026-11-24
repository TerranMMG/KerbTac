import { FormatError } from './parse'
import type { ErrorCode, Replay } from './types'
import { parseArchive } from './validate'

export interface ParseRequest { bytes: ArrayBuffer; fileName?: string }
export type ParseResponse =
  | { replay: Replay }
  | { error: { code: ErrorCode; params: FormatError['params'] } }
  | { failure: string }

export function processParseRequest({ bytes, fileName }: ParseRequest): {
  response: ParseResponse
  transfer: ArrayBuffer[]
} {
  try {
    const replay = parseArchive(new Uint8Array(bytes), { fileName })
    const buffers = new Set<ArrayBuffer>()
    for (const vessel of [...replay.vessels, ...replay.actors]) {
      const tables = 'segments' in vessel ? vessel.segments.map(segment => segment.samples) : [vessel.samples]
      for (const table of tables) {
        if (!table) continue
        for (const column of Object.values(table)) {
          if (ArrayBuffer.isView(column) && column.buffer instanceof ArrayBuffer) buffers.add(column.buffer)
        }
      }
    }
    for (const file of replay.modelFiles.values()) {
      if (file.buffer instanceof ArrayBuffer) buffers.add(file.buffer)
    }
    return { response: { replay }, transfer: [...buffers] }
  } catch (error) {
    const response = error instanceof FormatError
      ? { error: { code: error.code, params: error.params } }
      : { failure: error instanceof Error ? error.message : String(error) }
    return { response, transfer: [] }
  }
}
