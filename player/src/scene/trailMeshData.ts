import type { SampleTable, TrackSegment } from '../format/types'
import { latLonAltToBF, renderAltitude } from '../playback/math'
import { segmentBoundaryWindows } from '../playback/segmentBoundaries'
import { decimateTrailSamples } from './trail'
import { smoothTrailPoints, splitTrailRuns, type TrailPathPoint } from './trailPath'
import { trailRibbonRights } from './trailRight'
import { toRenderPosition } from './renderFrame'

export interface TrailSegmentInput {
  body: string
  boundary?: boolean
  kind: TrackSegment['kind']
  radius: number
  samples: Pick<SampleTable, 'length' | 't' | 'lat' | 'lon' | 'alt' | 'agl'>
}

export function buildTrailMeshData(segments: readonly TrailSegmentInput[], body: string, fullDetail: boolean) {
  interface Point extends TrailPathPoint {
    body: string
    staticSample: boolean
    segmentIndex: number
    sampleIndex: number
    segmentSamples: number
  }
  const all: Point[] = []
  // A jump starts a new trajectory for this body. Points still arriving
  // from an older overlapping segment belong to the pre-jump trajectory.
  const windows = segmentBoundaryWindows(segments)
  for (const [segmentIndex, segment] of segments.entries()) {
    const { samples, radius } = segment
    const { start, end } = windows[segmentIndex]
    for (let i = 0; i < samples.length; i++) {
      if (samples.t[i] > end) break
      if (samples.t[i] < start) continue
      const render = toRenderPosition(latLonAltToBF(samples.lat[i], samples.lon[i],
        renderAltitude(samples.alt[i], samples.agl?.[i] ?? null), radius))
      all.push({
        t: samples.t[i], x: render.x, y: render.y, z: render.z,
        body: segment.body, staticSample: segment.kind === 'static',
        segmentIndex, sampleIndex: i, segmentSamples: samples.length, breakBefore: i === 0 && segment.boundary,
      })
    }
  }
  all.sort((a, b) => a.t - b.t)
  // Legacy warp segments can overlap. Keep the moving or denser sample
  // before identifying discontinuities; LOD must not change those decisions.
  const merged: Point[] = []
  for (const point of all) {
    const last = merged[merged.length - 1]
    if (!last || point.breakBefore || last.body !== point.body) merged.push(point)
    else if (last && Math.abs(point.t - last.t) < 1e-6) {
      if (last.breakBefore) continue
      if (last.staticSample && !point.staticSample) merged[merged.length - 1] = point
    } else if (!last.breakBefore && point.segmentIndex !== last.segmentIndex && Math.abs(point.t - last.t) < 0.12) {
      if (point.segmentSamples > last.segmentSamples) merged[merged.length - 1] = point
    } else merged.push(point)
  }
  const byBody = new Map<string, Point[]>()
  for (const point of merged) {
    const group = byBody.get(point.body)
    if (group) group.push(point)
    else byBody.set(point.body, [point])
  }
  const times: number[] = [], centres: number[] = [], rights: number[] = [], breaks: number[] = []
  const lineTimes: number[] = [], lineCentres: number[] = []
  const wallPoints: (TrailPathPoint & { breakBefore: boolean })[] = []
  const wallSources: number[] = []
  for (const [name, group] of byBody) {
    // Both split and decimation retain the original Point objects.
    const runs = (fullDetail ? splitTrailRuns(group) : decimateTrailSamples(group, 2000)) as Point[][]
    for (const run of runs) {
      if (name === body) {
        for (const [i, point] of run.entries()) {
          wallPoints.push({ t: point.t, x: point.x, y: point.y, z: point.z,
            breakBefore: i === 0 && wallPoints.length > 0 })
          wallSources.push(point.segmentIndex, point.sampleIndex)
        }
      }
      const smooth = smoothTrailPoints(run)
      const vectors = trailRibbonRights(smooth)
      for (const [i, point] of smooth.entries()) {
        times.push(point.t)
        centres.push(point.x, point.y, point.z)
        rights.push(vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2])
        breaks.push(i === 0 && times.length > 1 ? 1 : 0)
        const next = smooth[i + 1]
        if (!next) continue
        lineTimes.push(point.t, next.t)
        lineCentres.push(point.x, point.y, point.z, next.x, next.y, next.z)
      }
    }
  }
  return {
    times: Float64Array.from(times), centres: Float32Array.from(centres),
    rights: Float32Array.from(rights), breaks: Uint8Array.from(breaks),
    lineTimes: Float64Array.from(lineTimes), lineCentres: Float32Array.from(lineCentres),
    wallPoints, wallSources: Uint32Array.from(wallSources), body,
  }
}

/** Each record is a complete line or quad, ordered by sample time. */
export function trailDrawRange(timeAt: (element: number) => number, records: number,
  stride: number, from: number, to: number): { start: number; count: number } {
  const bound = (skip: (record: number) => boolean) => {
    let lo = 0
    let hi = records
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (skip(mid)) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const start = bound(i => timeAt((i + 1) * stride - 1) < from)
  const end = bound(i => timeAt(i * stride) <= to)
  return { start: start * stride, count: Math.max(0, end - start) * stride }
}
