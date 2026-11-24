interface BoundarySegment {
  body: string
  boundary?: boolean
  samples: { length: number; t: Float64Array } | null
}

/** Per-body trajectory generations, in segment order, cut at actual samples. */
export function segmentBoundaryWindows(segments: readonly BoundarySegment[]) {
  const starts = new Map<string, number>()
  const windows = segments.map(segment => {
    if (segment.samples?.length) {
      // There is no earlier generation to protect at the first sample.
      if (!starts.has(segment.body)) starts.set(segment.body, -Infinity)
      else if (segment.boundary) starts.set(segment.body, segment.samples.t[0])
    }
    return { start: starts.get(segment.body) ?? -Infinity, end: Infinity }
  })
  const ends = new Map<string, number>()
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    const end = ends.get(segment.body) ?? Infinity
    windows[i].end = end
    if (segment.boundary && segment.samples?.length) {
      ends.set(segment.body, Math.min(end, segment.samples.t[0]))
    }
  }
  return windows
}
