import InlineWorker from './parseWorker?worker&inline'
import { FormatError } from './parse'
import type { ParseRequest, ParseResponse } from './parseWorkerProtocol'
import type { Replay } from './types'

export interface ParseWorkerPort {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(request: ParseRequest, transfer: ArrayBuffer[]): void
  terminate(): void
}

/** Transfer ownership of the archive to a short-lived inline worker. */
export function parseArchiveAsync(bytes: ArrayBuffer, fileName?: string,
  makeWorker: () => ParseWorkerPort = () => new InlineWorker(), signal?: AbortSignal): Promise<Replay> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const worker = makeWorker()
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const fail = (error: unknown) => {
      cleanup()
      reject(error)
    }
    const abort = () => fail(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<ParseResponse>) => {
      cleanup()
      if ('replay' in data) resolve(data.replay)
      else if ('error' in data) reject(new FormatError(data.error.code, data.error.params))
      else reject(new Error(data.failure))
    }
    worker.onerror = (event) => fail(new Error(event.message || 'Replay worker failed'))
    worker.onmessageerror = () => fail(new Error('Unreadable replay worker response'))
    try {
      worker.postMessage({ bytes, fileName }, [bytes])
    } catch (error) {
      fail(error)
    }
  })
}
