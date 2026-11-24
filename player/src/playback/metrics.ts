import type { SampleTable, VesselTrack } from '../format/types';

export type HeightMetric = 'asl' | 'agl' | 'tas' | 'aoa' | 'g' | 'vs';

/** Metrics that can drive the height-wall opacity. */
export const HEIGHT_METRICS: readonly HeightMetric[] = [
  'asl',
  'agl',
  'tas',
  'aoa',
  'g',
  'vs',
];

function segmentTables(vessel: VesselTrack): SampleTable[] {
  return vessel.segments
    .map((segment) => segment.samples)
    .filter((table): table is SampleTable => table !== null && table.length > 0);
}

function speedAt(samples: SampleTable, index: number): number {
  if (samples.vx && samples.vy && samples.vz) {
    const speed = Math.hypot(samples.vx[index], samples.vy[index], samples.vz[index]);
    if (Number.isFinite(speed)) return speed;
  }
  return samples.srfSpeed?.[index] ?? NaN;
}

export function metricValueAt(samples: SampleTable, index: number, metric: HeightMetric): number {
  const alt = samples.alt[index];
  switch (metric) {
    case 'asl':
      return alt;
    case 'agl':
      return samples.agl?.[index] ?? NaN;
    case 'tas':
      return speedAt(samples, index);
    case 'aoa':
      return samples.aoa?.[index] ?? NaN;
    case 'g':
      return samples.gee?.[index] ?? NaN;
    case 'vs': {
      const recorded = samples.vs?.[index];
      if (recorded !== undefined && Number.isFinite(recorded)) return recorded;
      const prev = Math.max(0, index - 1);
      const next = Math.min(samples.length - 1, index + 1);
      const dt = samples.t[next] - samples.t[prev];
      return dt > 0 ? (samples.alt[next] - samples.alt[prev]) / dt : NaN;
    }
  }
}

export function metricValues(vessel: VesselTrack, metric: HeightMetric): Float32Array {
  const tables = segmentTables(vessel);
  if (tables.length === 0) return new Float32Array(0);
  if (tables.length === 1) {
    const table = tables[0];
    const result = new Float32Array(table.length);
    for (let i = 0; i < table.length; i += 1) result[i] = metricValueAt(table, i, metric);
    return result;
  }
  const values: number[] = [];
  for (const table of tables) {
    for (let i = 0; i < table.length; i += 1) values.push(metricValueAt(table, i, metric));
  }
  return Float32Array.from(values);
}

/** Min-max normalisation of a height value; a constant series stays at zero. */
export function normalizedValue(values: Float32Array): Float32Array {
  const result = new Float32Array(values.length);
  if (values.length === 0) return result;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min;
  if (!Number.isFinite(span) || span <= 1e-9) return result;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number.isFinite(values[i]) ? values[i] : min;
    result[i] = Math.max(0, Math.min(1, (value - min) / span));
  }
  return result;
}

/** Absolute per-sample change rate, normalised by its 90th percentile. */
export function normalizedRate(values: Float32Array, times: Float64Array): Float32Array {
  const count = Math.min(values.length, times.length);
  const result = new Float32Array(count);
  if (count === 0) return result;
  const rates = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const left = i > 0 ? i - 1 : i;
    const right = i < count - 1 ? i + 1 : i;
    const dt = times[right] - times[left];
    if (dt <= 0) continue;
    rates[i] = Math.abs((values[right] - values[left]) / dt);
  }
  const sorted = Array.from(rates).sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
  if (!Number.isFinite(p90) || p90 <= 1e-9) return result;
  for (let i = 0; i < count; i += 1) {
    result[i] = Math.max(0, Math.min(1, rates[i] / p90));
  }
  return result;
}

/** Stable parts sit at the baseline; violent changes approach but never reach opaque. */
export function alphaForRate(rate: number, baseline = 0.15, cap = 0.5): number {
  const clampedCap = Math.max(0, Math.min(1, cap));
  const clampedBaseline = Math.max(0, Math.min(clampedCap, baseline));
  const t = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
  const smooth = t * t * (3 - 2 * t);
  return clampedBaseline + (clampedCap - clampedBaseline) * smooth;
}
