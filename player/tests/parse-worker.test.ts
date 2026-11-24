import { describe, expect, it } from 'vitest'
import InlineWorker from '../src/format/parseWorker?worker&inline'
import { parseArchiveAsync } from '../src/format/parseClient'
import { loadFixture } from './helpers/fixtures'

describe('archive worker protocol', () => {
  it('transfers the input and returns a replay with usable maps and sample columns', async () => {
    const input = await loadFixture('synthetic')
    const replay = await parseArchiveAsync(input, 'fixture.kerbtac')
    expect(input.byteLength).toBe(0)
    expect(replay.bodies.get('Kerbin')?.radius).toBe(600_000)
    const samples = replay.vessels.flatMap(vessel => vessel.segments).find(segment => segment.samples)?.samples
    expect(samples?.t).toBeInstanceOf(Float64Array)
    expect(samples?.t.length).toBeGreaterThan(0)
  })

  it('preserves typed format errors across the worker boundary', async () => {
    await expect(parseArchiveAsync(new ArrayBuffer(4), 'bad.kerbtac')).rejects.toMatchObject({
      name: 'FormatError', code: 'notZip', params: {},
    })
  })

  it('terminates a superseded worker without waiting for its reply', async () => {
    const input = await loadFixture('synthetic')
    const controller = new AbortController()
    const worker = new InlineWorker()
    let terminated = false
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => {
      terminated = true
      terminate()
    }
    try {
      const parsing = parseArchiveAsync(input, 'old.kerbtac', () => worker, controller.signal)
      controller.abort()
      expect(terminated).toBe(true)
      await expect(parsing).rejects.toMatchObject({ name: 'AbortError' })
      expect(input.byteLength).toBe(0)
    } finally {
      terminate()
    }
  })
})
