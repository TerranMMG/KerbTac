import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import type { SampleTable, VesselTrack } from '../src/format/types';
import { buildHeightWall, createHeightWallMaterial, shouldShowHeightWall } from '../src/scene/heightWall';
import { visibleSampleCount } from '../src/scene/trail';
import {
  alphaForRate,
  metricValues,
  normalizedRate,
  normalizedValue,
  type HeightMetric,
} from '../src/playback/metrics';

function table(values: {
  alt?: number[];
  agl?: number[] | null;
  t?: number[];
  lat?: number[];
  lon?: number[];
}): SampleTable {
  const inferred = Math.max(
    1,
    values.t?.length ?? 0,
    values.alt?.length ?? 0,
    values.agl?.length ?? 0,
  );
  const t = Float64Array.from(values.t ?? Array.from({ length: inferred }, (_, i) => i));
  const length = t.length;
  return {
    length,
    t,
    lat: Float64Array.from(values.lat ?? Array.from({ length }, () => 90)),
    lon: Float64Array.from(values.lon ?? Array.from({ length }, () => 0)),
    alt: Float64Array.from(values.alt ?? Array.from({ length }, () => 1000)),
    q: new Float32Array(length * 4),
    vx: null,
    vy: null,
    vz: null,
    throttle: null,
    mass: null,
    gee: null,
    stage: null,
    situation: null,
    hdg: null,
    vs: null,
    lf: null,
    ox: null,
    ec: null,
    mp: null,
    srfSpeed: null,
    ias: null,
    mach: null,
    aoa: null,
    aos: null,
    agl: values.agl === undefined || values.agl === null ? null : Float32Array.from(values.agl),
    dynPress: null,
    pitch: null,
    roll: null,
    yaw: null,
    gear: null,
    flaps: null,
    brakes: null,
    health: null,
  };
}

function vessel(samples: SampleTable): VesselTrack {
  return {
    id: 'v1',
    name: 'Test',
    type: 'plane',
    body: 'Kerbin',
    color: null,
    team: null,
    rootPart: null,
    partCount: null,
    crewCount: null,
    side: 'blue',
    callsign: null,
    kind: 'air',
    health: 1,
    loadout: [],
    transient: false,
    segments: [
      {
        index: 0,
        logicalIndex: 0,
        chunkIndex: 0,
        kind: 'flight',
        body: 'Kerbin',
        source: 'active',
        boundary: false,
        orbit: null,
        startUt: samples.t[0],
        endUt: samples.t[samples.length - 1],
        samples,
      },
    ],
  };
}

describe('height wall', () => {
  it('stable metric keeps baseline and spikes cap below opaque', () => {
    expect(alphaForRate(0)).toBeCloseTo(0.15, 3);
    expect(alphaForRate(1)).toBeCloseTo(0.5, 3);
    expect(alphaForRate(2)).toBeCloseTo(0.5, 3);
  });

  it('wall uses AGL above the rendered sea-level sphere', () => {
    const geometry = buildHeightWall(table({ alt: [1000], agl: [200] }), 600000, '#4da3ff');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new Box3();
    expect(box.min.y).toBeCloseTo(600000, 0);
    expect(box.max.y).toBeCloseTo(600200, 0);
  });

  it('falls back to sea level when a file has no agl column', () => {
    const geometry = buildHeightWall(table({ alt: [1000], agl: null }), 600000, '#4da3ff');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new Box3();
    expect(box.min.y).toBeCloseTo(600000, 0);
    expect(box.max.y).toBeCloseTo(601000, 0);
  });

  it('omits the wall bridge across a teleport', () => {
    const geometry = buildHeightWall(
      table({ t: [0, 0.1], lat: [0, 0.1], lon: [0, 0] }),
      600000,
      '#4da3ff',
    );
    expect(geometry.getIndex()?.count ?? 0).toBe(0);
  });

  it('uses logarithmic-depth chunks to match the renderer', () => {
    const material = createHeightWallMaterial(0x4da3ff);
    expect(material.vertexShader).toContain('logdepthbuf_vertex');
    expect(material.fragmentShader).toContain('logdepthbuf_fragment');
  });

  it('hides the wall in satellite view', () => {
    expect(shouldShowHeightWall('satellite', 'selected')).toBe(false);
    expect(shouldShowHeightWall('external', 'selected')).toBe(true);
    expect(shouldShowHeightWall('free', 'all')).toBe(true);
    expect(shouldShowHeightWall('external', 'disabled')).toBe(false);
  });
});

function metricWith(samples: SampleTable, metric: HeightMetric): number[] {
  return Array.from(metricValues(vessel(samples), metric));
}

describe('height metrics', () => {
  it('does not replace missing AGL metric rows with ASL', () => {
    expect(metricWith(table({ agl: [100, 200] }), 'agl')).toEqual([100, 200]);
    expect(metricWith(table({ agl: null, alt: [1000] }), 'agl')).toEqual([NaN]);
    expect(metricWith(table({ agl: [0, NaN, 200] }), 'agl')).toEqual([0, NaN, 200]);
  });

  it('normalizes a spike against the p90 rate', () => {
    const values = Float32Array.from([0, 0, 0, 0, 0, 100]);
    const times = Float64Array.from([0, 1, 2, 3, 4, 5]);
    const rates = Array.from(normalizedRate(values, times));
    expect(rates[0]).toBe(0);
    expect(Math.max(...rates)).toBeCloseTo(1, 3);
  });

  it('treats a constant series as rate zero', () => {
    const rates = normalizedRate(Float32Array.from([5, 5, 5]), Float64Array.from([0, 1, 2]));
    expect(Array.from(rates)).toEqual([0, 0, 0]);
  });

  it('normalizes absolute height values across the wall', () => {
    expect(Array.from(normalizedValue(Float32Array.from([100, 200, 300])))).toEqual([
      0, 0.5, 1,
    ]);
    expect(Array.from(normalizedValue(Float32Array.from([5, 5])))).toEqual([0, 0]);
  });
});

describe('trail window', () => {
  it('counts only samples inside the time window', () => {
    const times = Float64Array.from([0, 10, 20, 30, 40, 50, 60]);
    expect(visibleSampleCount(times, 60, 30)).toBe(4);
    expect(visibleSampleCount(times, 20, 60)).toBe(3);
    expect(visibleSampleCount(new Float64Array(0), 60, 30)).toBe(0);
  });
});
