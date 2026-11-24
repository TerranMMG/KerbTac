export interface BenchmarkMetrics {
  parseMs: number
  firstFrameMs: number
  avgFps: number
  p1LowFps: number
  seekMs: number | null
  heapMB: number | null
  worstFrameMs: number
}

export class ReplayBenchmark {
  private loadStarted = 0
  private parseMs: number | null = null
  private firstFrameMs: number | null = null
  private frameTimes: number[] = []
  private elapsed = 0
  private previousFrame: number | null = null
  private seekStarted: number | null = null
  private seekMs: number | null = null
  private frameStats: Pick<BenchmarkMetrics, 'avgFps' | 'p1LowFps' | 'worstFrameMs'> | null = null

  constructor(private readonly durationMs = 60_000) {}

  parsed(durationMs: number, loadStarted: number): void {
    this.loadStarted = loadStarted
    this.parseMs = durationMs
    this.firstFrameMs = this.previousFrame = this.seekStarted = this.seekMs = null
    this.frameStats = null
    this.frameTimes = []
    this.elapsed = 0
  }

  resetFrameInterval(): void {
    this.previousFrame = null
  }

  seek(now: number): void {
    this.seekStarted = now
  }

  /** Return true when a new completed report is available. */
  frame(now: number, renderedAt: number, playing: boolean): boolean {
    if (this.parseMs === null) return false
    this.firstFrameMs ??= renderedAt - this.loadStarted

    const sought = this.seekStarted !== null
    if (this.seekStarted !== null) {
      this.seekMs = renderedAt - this.seekStarted
      this.seekStarted = null
    }
    if (this.frameStats) return sought

    const previous = this.previousFrame
    this.previousFrame = playing ? now : null
    if (!playing || previous === null || now <= previous) return false

    const interval = now - previous
    this.elapsed += interval
    this.frameTimes.push(interval)
    if (this.elapsed < this.durationMs) return false

    this.frameTimes.sort((a, b) => b - a)
    const count = this.frameTimes.length
    const slowCount = Math.ceil(count / 100)
    const slowSum = this.frameTimes.slice(0, slowCount).reduce((sum, ms) => sum + ms, 0)
    this.frameStats = {
      avgFps: 1000 * count / this.elapsed,
      p1LowFps: 1000 * slowCount / slowSum,
      worstFrameMs: this.frameTimes[0],
    }
    this.frameTimes = []
    return true
  }

  metrics(heapBytes: number | null): BenchmarkMetrics | null {
    if (this.parseMs === null || this.firstFrameMs === null || !this.frameStats) return null
    return {
      parseMs: this.parseMs,
      firstFrameMs: this.firstFrameMs,
      ...this.frameStats,
      seekMs: this.seekMs,
      heapMB: heapBytes === null ? null : heapBytes / 1024 ** 2,
    }
  }
}
