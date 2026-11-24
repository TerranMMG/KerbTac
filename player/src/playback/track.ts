// Sampling a vessel track at an arbitrary UT, with interpolation between
// recorded samples. Pure functions; the renderer consumes VesselState.

import type { CelestialBodyDef, ReplayEvent, SampleTable, TrackSegment, VesselTrack } from '../format/types';
import {
  headingOf,
  latLonAltToBF,
  lerp,
  lerpLongitude,
  normalizeQuat,
  quatFromArray,
  quatRotate,
  slerp,
  vec3,
  type Quat,
  type Vec3,
} from './math';
import { bfToLatLonAlt, orbitPositionBF } from './kepler';
import { segmentBoundaryWindows } from './segmentBoundaries';

/** Gaps longer than this may be bridged by a Kepler orbit segment. */
const ORBIT_GAP_SECONDS = 2;

export interface VesselState {
  ut: number;
  body: string;
  segmentIndex: number;
  segmentKind: TrackSegment['kind'];
  segmentSource?: TrackSegment['source'];
  lat: number;
  lon: number;
  alt: number;
  /** Body-fixed position, metres. */
  bf: Vec3;
  /** Model space (+Z forward, +Y up) -> body-fixed. */
  q: Quat;
  velocity: Vec3 | null;
  speed: number | null;
  verticalSpeed: number | null;
  heading: number | null;
  throttle: number | null;
  mass: number | null;
  gee: number | null;
  stage: number | null;
  situation: string | null;
  lf: number | null;
  ox: number | null;
  ec: number | null;
  mp: number | null;
  /** Optional v1.1 combat/flight telemetry. */
  ias?: number | null;
  mach?: number | null;
  aoa?: number | null;
  aos?: number | null;
  agl?: number | null;
  dynPress?: number | null;
  surfaceSpeed?: number | null;
  gear?: number | null;
  flaps?: number | null;
  brakes?: number | null;
  health?: number | null;
  /** True when playback time is at or before the first sample. */
  clampedStart: boolean;
  /** True when playback time is at or after the last sample. */
  clampedEnd: boolean;
}

interface SegmentPick {
  segment: TrackSegment;
  samples: SampleTable;
  i: number;
  j: number;
  /** Interpolation fraction, already clamped to [0, 1]. */
  fraction: number;
  atStart: boolean;
  atEnd: boolean;
}

function firstTime(samples: SampleTable): number {
  return samples.t[0] as number;
}

function lastTime(samples: SampleTable): number {
  return samples.t[samples.length - 1] as number;
}

/** Index of the last sample with t <= ut (clamped to the array bounds). */
export function lowerBound(t: Float64Array, ut: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (ut <= (t[0] as number)) return 0;
  if (ut >= (t[hi] as number)) return hi;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) <= ut) lo = mid;
    else hi = mid;
  }
  return lo;
}

function upperBoundExclusive(t: Float64Array, value: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type SampledSegment = TrackSegment & { samples: SampleTable };
interface CachedTrack {
  usable: {
    segment: SampledSegment; first: number; last: number;
    firstIndex: number; lastIndex: number; start: number; end: number;
  }[];
  orbits: TrackSegment[];
  first: number;
  last: number;
}

const trackCache = new WeakMap<VesselTrack, CachedTrack>();

function cachedTrack(vessel: VesselTrack): CachedTrack {
  const existing = trackCache.get(vessel);
  if (existing) return existing;
  const cached: CachedTrack = { usable: [], orbits: [], first: Infinity, last: -Infinity };
  let lastStart = -Infinity;
  let lastIsStatic = false;
  const segments = vessel.segments;
  const windows = segmentBoundaryWindows(segments);
  for (const [position, segment] of segments.entries()) {
    if (segment.kind === 'orbit' && segment.orbit) cached.orbits.push(segment);
    if (!segment.samples?.length) continue;
    const first = firstTime(segment.samples);
    const last = lastTime(segment.samples);
    cached.first = Math.min(cached.first, first);
    cached.last = Math.max(cached.last, last);
    if (first >= lastStart) {
      lastStart = first;
      lastIsStatic = segment.kind === 'static';
    }
    const { start, end } = windows[position];
    const times = segment.samples.t;
    let firstIndex = start > first ? lowerBound(times, start) : 0;
    if (times[firstIndex] < start) firstIndex++;
    const lastIndex = end < last ? upperBoundExclusive(times, end) - 1 : times.length - 1;
    if (start < end && firstIndex <= lastIndex && times[firstIndex] < end) {
      cached.usable.push({
        segment: segment as SampledSegment, first: times[firstIndex], last: times[lastIndex],
        firstIndex, lastIndex, start, end,
      });
    }
  }
  if (lastIsStatic) cached.last = Infinity;
  trackCache.set(vessel, cached);
  return cached;
}

function pickSegment(vessel: VesselTrack, ut: number): SegmentPick | null {
  const { usable } = cachedTrack(vessel);
  if (usable.length === 0) return null;

  let chosen: (typeof usable)[number] | undefined;
  let nearest: (typeof usable)[number] | undefined;
  let nearestDistance = Infinity;
  let bestDensity = -1;
  let chosenExact = false;
  for (const entry of usable) {
    // Treat the generations as half-open for position selection. An old
    // sample exactly at the cut can still end the trail on the old side.
    if (ut < entry.start || ut >= entry.end) continue;
    const { segment, last } = entry;
    if (ut < entry.first || ut > last) {
      const distance = Math.max(entry.first - ut, ut - last);
      if (distance <= nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
      continue;
    }
    // Warp transitions can leave a dense active segment and a sparse loaded
    // segment covering the same instant. Keep the denser one instead of
    // jumping to the newer segment's first sample.
    const lo = Math.max(entry.firstIndex, lowerBound(segment.samples.t, ut - 0.5));
    const hi = Math.min(entry.lastIndex + 1, upperBoundExclusive(segment.samples.t, ut + 0.5));
    const density = hi - lo;
    const exact = segment.samples.t[lowerBound(segment.samples.t, ut)] === ut;
    if (!chosen || (exact && !chosenExact) || (exact === chosenExact && density >= bestDensity)) {
      bestDensity = density;
      chosenExact = exact;
      chosen = entry;
    }
  }

  // If the time falls in a gap between segments, snap to the closer edge.
  if (!chosen) {
    if (!nearest) return null;
    const atStart = ut < nearest.first;
    const i = atStart ? nearest.firstIndex : nearest.lastIndex;
    return { segment: nearest.segment, samples: nearest.segment.samples,
      i, j: i,
      fraction: atStart ? 0 : 1, atStart, atEnd: !atStart };
  }
  const { segment } = chosen;
  const samples = segment.samples;
  const i = lowerBound(samples.t, ut);
  const j = Math.min(i + 1, chosen.lastIndex);
  const t0 = samples.t[i] as number;
  const t1 = samples.t[j] as number;
  const span = t1 - t0;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (ut - t0) / span)) : 1;
  return {
    segment,
    samples,
    i,
    j,
    fraction,
    atStart: ut === chosen.first,
    atEnd: i >= chosen.lastIndex,
  };
}

function findOrbitSegment(vessel: VesselTrack, body: string, start: number, end: number): TrackSegment | null {
  for (const segment of cachedTrack(vessel).orbits) {
    if (segment.body === body && start >= segment.startUt - 1e-6 && end <= segment.endUt + 1e-6) return segment;
  }
  return null;
}

function columnAt(column: Float32Array | Float64Array | null, index: number): number | null {
  const value = column?.[index];
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function pairAt(column: Float32Array | null, index: number, next: number, fraction: number): number | null {
  const a = columnAt(column, index);
  if (fraction <= 0 || index === next) return a;
  const b = columnAt(column, next);
  if (fraction >= 1) return b;
  if (a === null || b === null) return null;
  return a + (b - a) * fraction;
}

function stepStringAt(column: (string | null)[] | null, index: number): string | null {
  if (!column) return null;
  return column[Math.min(index, column.length - 1)] ?? null;
}


/** Transient actors (missiles, shells) exist only inside their recorded window. */
export function vesselActiveAt(vessel: VesselTrack, ut: number): boolean {
  // A recording only proves a vessel exists between its first and last sample.
  // That covers damage/debris, missiles before launch and objects that are
  // destroyed during the session; sampleVessel still clamps for static HUDs.
  const { first, last } = cachedTrack(vessel);
  // A recording can start a fraction of a second before the first sample.
  // Give persistent tracks a small pad so "back to start" is never empty;
  // launched actors still appear/disappear tightly around their own samples.
  const pad = vessel.transient ? 0.05 : 0.75;
  return first - pad <= ut && ut <= last + pad;
}

/**
 * Latest event that ends the object's visible life: an actor impact/miss, or
 * a vessel kill/destruction/crash. Null means the object has no terminal event.
 */
export function vesselTerminalUt(vessel: VesselTrack, events: ReplayEvent[]): number | null {
  let terminal: number | null = null
  for (const event of events) {
    if (vessel.transient) {
      if (event.type !== 'impact' && event.type !== 'proximity_detonation' && event.type !== 'miss') {
        continue
      }
      if (event.data?.actorId !== vessel.id) continue
    } else {
      if (event.type !== 'kill' && event.type !== 'destroyed' && event.type !== 'crash') continue
      if (event.vessel !== vessel.id && event.target !== vessel.id) continue
    }
    if (terminal === null || event.ut > terminal) terminal = event.ut
  }
  return terminal
}

export function vesselFirstUt(vessel: VesselTrack): number | null {
  let first: number | null = null
  for (const segment of vessel.segments) {
    if (segment.samples === null || segment.samples.length === 0) continue
    const start = segment.samples.t[0] as number
    if (first === null || start < first) first = start
  }
  return first
}

export function vesselLastUt(vessel: VesselTrack): number | null {
  let last: number | null = null
  let lastStart = Number.NEGATIVE_INFINITY
  let lastIsStatic = false
  for (const segment of vessel.segments) {
    if (segment.samples === null || segment.samples.length === 0) continue
    const start = segment.samples.t[0] as number
    const end = segment.samples.t[segment.samples.length - 1] as number
    if (last === null || end > last) last = end
    if (start >= lastStart) {
      lastStart = start
      lastIsStatic = segment.kind === 'static'
    }
  }
  if (lastIsStatic) return Number.POSITIVE_INFINITY
  return last
}

/** Last real sample time, ignoring the "static means forever" rule. */
export function vesselLastSampleUt(vessel: VesselTrack): number | null {
  let last: number | null = null
  for (const segment of vessel.segments) {
    if (segment.samples === null || segment.samples.length === 0) continue
    const end = segment.samples.t[segment.samples.length - 1] as number
    if (last === null || end > last) last = end
  }
  return last
}

export function sampleVessel(
  vessel: VesselTrack,
  ut: number,
  bodies: Map<string, CelestialBodyDef>,
): VesselState | null {
  const pick = pickSegment(vessel, ut);
  if (!pick) return null;

  const { samples, fraction, segment, i, j } = pick;

  const latA = samples.lat[i] as number;
  const latB = samples.lat[j] as number;
  const lonA = samples.lon[i] as number;
  const lonB = samples.lon[j] as number;
  const altA = samples.alt[i] as number;
  const altB = samples.alt[j] as number;

  let lat = latA + (latB - latA) * fraction;
  let lon = lerpLongitude(lonA, lonB, fraction);
  let alt = altA + (altB - altA) * fraction;

  const bodyRadius = bodies.get(segment.body)?.radius ?? 0;
  // Cartesian interpolation between adjacent samples avoids chord/meridian
  // artefacts; with 5-20 Hz data the sagitta is sub-millimetre.
  let bf = lerp(
    latLonAltToBF(latA, lonA, altA, bodyRadius),
    latLonAltToBF(latB, lonB, altB, bodyRadius),
    fraction,
  );

  // Warp/packed segments only have sparse keyframes. A sample-less orbit
  // segment written by Space mode lets Kepler bridge those gaps; short gaps
  // always use the recorded samples.
  const sampleSpan = (samples.t[j] as number) - (samples.t[i] as number);
  if (ut > samples.t[i] && ut < samples.t[j] && sampleSpan > ORBIT_GAP_SECONDS) {
    const orbitSegment = findOrbitSegment(vessel, segment.body, samples.t[i], samples.t[j]);
    const orbitBody = orbitSegment ? bodies.get(orbitSegment.body) : null;
    if (orbitSegment?.orbit && orbitBody) {
      const orbit = orbitSegment.orbit;
      const predict = (t: number) => orbitPositionBF(orbit, orbitBody.gravParameter, orbitBody, t);
      const fits = (k: number) => {
        const p = predict(samples.t[k]);
        if (!p) return false;
        const actual = latLonAltToBF(samples.lat[k], samples.lon[k], samples.alt[k], orbitBody.radius);
        // Both comparisons use the original orbit and actual samples; never
        // calibrate a phase from the samples being used to check it.
        return Math.hypot(p.x - actual.x, p.y - actual.y, p.z - actual.z) <= 250;
      };
      if (fits(i) && fits(j)) {
        const predicted = predict(ut);
        if (predicted && Number.isFinite(Math.hypot(predicted.x, predicted.y, predicted.z))) {
          bf = predicted;
          const geo = bfToLatLonAlt(bf, orbitBody.radius);
          lat = geo.lat;
          lon = geo.lon;
          alt = geo.alt;
        }
      }
    }
  }

  const q0 = quatFromArray(samples.q, i * 4);
  const q1 = quatFromArray(samples.q, j * 4);
  const q: Quat = fraction <= 0 ? q0 : fraction >= 1 ? q1 : normalizeQuat(slerp(q0, q1, fraction));

  const vx = pairAt(samples.vx, i, j, fraction);
  const vy = pairAt(samples.vy, i, j, fraction);
  const vz = pairAt(samples.vz, i, j, fraction);
  const velocity = vx !== null && vy !== null && vz !== null ? vec3(vx, vy, vz) : null;

  const providedSpeed = pairAt(samples.srfSpeed, i, j, fraction);
  const speed = velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : providedSpeed;

  let verticalSpeed = pairAt(samples.vs, i, j, fraction);
  if (verticalSpeed === null) {
    const dt = (samples.t[j] as number) - (samples.t[i] as number);
    if (dt > 0) verticalSpeed = (altB - altA) / dt;
  }

  const forward = quatRotate(q, vec3(0, 0, 1));
  const ha = columnAt(samples.hdg, i), hb = columnAt(samples.hdg, j);
  const recordedHeading = fraction <= 0 ? ha : fraction >= 1 ? hb
    : ha !== null && hb !== null ? lerpLongitude(ha, hb, fraction) : null;
  const heading = recordedHeading === null ? headingOf(forward, lat, lon)
    : ((recordedHeading % 360) + 360) % 360;

  return {
    ut,
    body: segment.body,
    segmentIndex: segment.index,
    segmentKind: segment.kind,
    segmentSource: segment.source,
    lat,
    lon,
    alt,
    bf,
    q,
    velocity,
    speed,
    verticalSpeed,
    heading,
    throttle: pairAt(samples.throttle, i, j, fraction),
    mass: pairAt(samples.mass, i, j, fraction),
    gee: pairAt(samples.gee, i, j, fraction),
    stage: columnAt(samples.stage, fraction >= 1 ? j : i),
    situation: stepStringAt(samples.situation, fraction >= 1 ? j : i),
    lf: pairAt(samples.lf, i, j, fraction),
    ox: pairAt(samples.ox, i, j, fraction),
    ec: pairAt(samples.ec, i, j, fraction),
    mp: pairAt(samples.mp, i, j, fraction),
    ias: pairAt(samples.ias, i, j, fraction),
    mach: pairAt(samples.mach, i, j, fraction),
    aoa: pairAt(samples.aoa, i, j, fraction),
    aos: pairAt(samples.aos, i, j, fraction),
    agl: pairAt(samples.agl, i, j, fraction),
    dynPress: pairAt(samples.dynPress, i, j, fraction),
    surfaceSpeed: pairAt(samples.srfSpeed, i, j, fraction),
    gear: pairAt(samples.gear, i, j, fraction),
    flaps: pairAt(samples.flaps, i, j, fraction),
    brakes: pairAt(samples.brakes, i, j, fraction),
    health: pairAt(samples.health, i, j, fraction),
    clampedStart: pick.atStart,
    clampedEnd: pick.atEnd,
  };
}

/** Oldest and newest sample times across all non-empty segments. */
export function vesselBounds(vessel: VesselTrack): { startUt: number; endUt: number } | null {
  let startUt = Number.POSITIVE_INFINITY;
  let endUt = Number.NEGATIVE_INFINITY;
  for (const segment of vessel.segments) {
    if (!segment.samples || segment.samples.length === 0) continue;
    startUt = Math.min(startUt, firstTime(segment.samples));
    endUt = Math.max(endUt, lastTime(segment.samples));
  }
  return Number.isFinite(startUt) ? { startUt, endUt } : null;
}

export function columnAtState(state: VesselState, column: 'throttle' | 'mass' | 'gee' | 'lf' | 'ox' | 'ec' | 'mp'): number | null {
  return state[column];
}

export { columnAt };
