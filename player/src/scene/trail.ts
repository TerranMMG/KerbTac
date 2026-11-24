import type { SampleTable, TrackSegment } from '../format/types';

/** Selected and unselected traffic keep the same history length. */
export const SELECTED_TRAIL_SECONDS = 60;
export const UNSELECTED_TRAIL_SECONDS = 60;

export function trailWindowSeconds(
  _selected: boolean,
  selectedSeconds = SELECTED_TRAIL_SECONDS,
): number {
  // Selected and unselected traffic use the same history length; selection
  // only changes opacity, never how much of the past is visible.
  return selectedSeconds;
}

function lowerBound(times: Float64Array, value: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(times: Float64Array, value: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Number of samples in [currentUt - windowSec, currentUt]. */
export function visibleSampleCount(
  times: Float64Array,
  currentUt: number,
  windowSec: number,
): number {
  if (times.length === 0) return 0;
  const window = Math.max(0, windowSec);
  const start = lowerBound(times, currentUt - window);
  const end = upperBound(times, currentUt);
  return Math.max(0, end - start);
}

function concatFloat32(parts: Array<Float32Array | null>): Float32Array | null {
  if (parts.some((part) => part === null)) return null;
  const length = parts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function concatFloat64(parts: Array<Float64Array | null>): Float64Array | null {
  if (parts.some((part) => part === null)) return null;
  const length = parts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
  const result = new Float64Array(length);
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function concatStrings(parts: Array<Array<string | null> | null>): Array<string | null> | null {
  if (parts.some((part) => part === null)) return null;
  const result: Array<string | null> = [];
  for (const part of parts) {
    if (part) result.push(...part);
  }
  return result;
}

/**
 * Concatenate the logical segments of one vessel into a single sample table.
 * Chunk normalisation has already made segment order chronological.
 */
export function combineVesselSamples(
  segments: TrackSegment[],
  body: string,
): SampleTable | null {
  const tables = segments
    .filter((segment) => segment.body === body)
    .map((segment) => segment.samples)
    .filter((table): table is SampleTable => table !== null && table.length > 0);
  if (tables.length === 0) return null;
  const length = tables.reduce((sum, table) => sum + table.length, 0);
  const times = new Float64Array(length);
  const lat = new Float64Array(length);
  const lon = new Float64Array(length);
  const alt = new Float64Array(length);
  const q = new Float32Array(length * 4);
  let offset = 0;
  for (const table of tables) {
    times.set(table.t, offset);
    lat.set(table.lat, offset);
    lon.set(table.lon, offset);
    alt.set(table.alt, offset);
    q.set(table.q, offset * 4);
    offset += table.length;
  }

  return {
    length,
    t: times,
    lat,
    lon,
    alt,
    q,
    vx: concatFloat32(tables.map((table) => table.vx)),
    vy: concatFloat32(tables.map((table) => table.vy)),
    vz: concatFloat32(tables.map((table) => table.vz)),
    throttle: concatFloat32(tables.map((table) => table.throttle)),
    mass: concatFloat32(tables.map((table) => table.mass)),
    gee: concatFloat32(tables.map((table) => table.gee)),
    stage: concatFloat64(tables.map((table) => table.stage)),
    situation: concatStrings(tables.map((table) => table.situation)),
    hdg: concatFloat32(tables.map((table) => table.hdg)),
    vs: concatFloat32(tables.map((table) => table.vs)),
    lf: concatFloat32(tables.map((table) => table.lf)),
    ox: concatFloat32(tables.map((table) => table.ox)),
    ec: concatFloat32(tables.map((table) => table.ec)),
    mp: concatFloat32(tables.map((table) => table.mp)),
    srfSpeed: concatFloat32(tables.map((table) => table.srfSpeed)),
    ias: concatFloat32(tables.map((table) => table.ias)),
    mach: concatFloat32(tables.map((table) => table.mach)),
    aoa: concatFloat32(tables.map((table) => table.aoa)),
    aos: concatFloat32(tables.map((table) => table.aos)),
    agl: concatFloat32(tables.map((table) => table.agl)),
    dynPress: concatFloat32(tables.map((table) => table.dynPress)),
    pitch: concatFloat32(tables.map((table) => table.pitch)),
    roll: concatFloat32(tables.map((table) => table.roll)),
    yaw: concatFloat32(tables.map((table) => table.yaw)),
    gear: concatFloat32(tables.map((table) => table.gear)),
    flaps: concatFloat32(tables.map((table) => table.flaps)),
    brakes: concatFloat32(tables.map((table) => table.brakes)),
    health: concatFloat32(tables.map((table) => table.health)),
  };
}
import { splitTrailRuns, type TrailPathPoint } from './trailPath'

export function decimateTrailSamples(points: readonly TrailPathPoint[], targetPoints: number): TrailPathPoint[][] {
  const runs = splitTrailRuns(points)
  const ratio = Math.min(1, Math.max(0, targetPoints / points.length))
  return runs.map(run => {
    const count = Math.min(run.length, Math.max(2, Math.round(run.length * ratio)))
    if (count === run.length) return run
    return Array.from({ length: count }, (_, i) => run[Math.round(i * (run.length - 1) / (count - 1))]!)
  })
}
