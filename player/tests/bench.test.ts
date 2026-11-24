import { describe, expect, it } from 'vitest'
import { ReplayBenchmark } from '../src/dev/bench'

describe('ReplayBenchmark', () => {
  it('uses the slowest one percent of frame intervals and keeps long stalls in the average', () => {
    const bench = new ReplayBenchmark(1080)
    bench.parsed(20, 0)
    bench.frame(100, 105, true)
    for (let frame = 1; frame <= 99; frame++) {
      bench.frame(100 + frame * 10, 105 + frame * 10, true)
    }
    expect(bench.metrics(null)).toBeNull()
    bench.frame(1180, 1190, true)
    expect(bench.metrics(32 * 1024 ** 2)).toEqual({
      parseMs: 20, firstFrameMs: 105, avgFps: 100_000 / 1080,
      p1LowFps: 1000 / 90, seekMs: null, heapMB: 32, worstFrameMs: 90,
    })
  })

  it('excludes pauses and times the latest seek through the next rendered frame', () => {
    const bench = new ReplayBenchmark(20)
    bench.parsed(2, 10)
    bench.frame(20, 22, true)
    bench.frame(30, 32, true)
    bench.frame(40, 42, false)
    bench.seek(90)
    bench.seek(94)
    bench.frame(96, 100, false)
    bench.frame(110, 112, true)
    bench.frame(120, 122, true)
    expect(bench.metrics(null)).toEqual({
      parseMs: 2, firstFrameMs: 12, avgFps: 100, p1LowFps: 100,
      seekMs: 6, heapMB: null, worstFrameMs: 10,
    })
    bench.parsed(3, 200)
    expect(bench.metrics(null)).toBeNull()
  })

  it('does not count a hidden interval when the browser suspends all frame callbacks', () => {
    const bench = new ReplayBenchmark(20)
    bench.parsed(2, 0)
    bench.frame(10, 12, true)
    bench.resetFrameInterval()
    bench.frame(10_000, 10_002, true)
    bench.frame(10_010, 10_012, true)
    expect(bench.metrics(null)).toBeNull()
    bench.frame(10_020, 10_022, true)
    expect(bench.metrics(null)).toMatchObject({ avgFps: 100, p1LowFps: 100, worstFrameMs: 10 })
  })

  it('reports the start timestamp of the replay that actually applied, even out of order', () => {
    const bench = new ReplayBenchmark(10)
    const firstStarted = 10
    const secondStarted = 20
    bench.parsed(5, secondStarted)
    bench.frame(30, 32, true)
    bench.frame(40, 42, true)
    expect(bench.metrics(null)).toMatchObject({ firstFrameMs: 12, parseMs: 5 })
    bench.parsed(6, firstStarted)
    bench.frame(50, 52, true)
    bench.frame(60, 62, true)
    expect(bench.metrics(null)).toMatchObject({ firstFrameMs: 42, parseMs: 6 })
  })
})
