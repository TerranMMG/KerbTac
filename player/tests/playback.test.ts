import { describe, expect, it } from 'vitest';
import { parseArchive } from '../src/format/validate';
import { PlaybackClock, formatDuration, formatKspTime, formatMissionTime } from '../src/playback/clock';
import { bodyFrameAt, bodyRotationAt } from '../src/playback/body';
import { headingOf, latLonAltToBF, bfToLatLon, quatFromAxisAngle, quatRotate, renderAltitude, slerp, vec3 } from '../src/playback/math';
import { lowerBound, sampleVessel, vesselActiveAt, vesselBounds } from '../src/playback/track';
import { buildTrailMeshData } from '../src/scene/trailMeshData';
import type { CelestialBodyDef, Replay, SampleTable, TrackSegment, VesselTrack } from '../src/format/types';
import { buildArchive, defaultBodies, sampleColumns } from './helpers/archive';

const KERBIN = defaultBodies()['Kerbin'] as unknown as CelestialBodyDef;
const BODIES = new Map<string, CelestialBodyDef>([['Kerbin', KERBIN]]);

function table(values: Partial<Omit<SampleTable, 't'>> & { t: number[] }): SampleTable {
  const n = values.t.length;
  return {
    length: n,
    t: Float64Array.from(values.t),
    lat: Float64Array.from(values.lat ?? values.t.map(() => 0)),
    lon: Float64Array.from(values.lon ?? values.t.map(() => 0)),
    alt: Float64Array.from(values.alt ?? values.t.map(() => 70)),
    q: values.q ?? new Float32Array(values.t.flatMap(() => [0, 0, 0, 1])),
    vx: values.vx ?? null,
    vy: values.vy ?? null,
    vz: values.vz ?? null,
    throttle: values.throttle ?? null,
    mass: values.mass ?? null,
    gee: values.gee ?? null,
    stage: values.stage ?? null,
    situation: values.situation ?? null,
    hdg: values.hdg ?? null,
    vs: values.vs ?? null,
    lf: values.lf ?? null,
    ox: values.ox ?? null,
    ec: values.ec ?? null,
    mp: values.mp ?? null,
    srfSpeed: values.srfSpeed ?? null,
    ias: values.ias ?? null,
    mach: values.mach ?? null,
    aoa: values.aoa ?? null,
    aos: values.aos ?? null,
    agl: values.agl ?? null,
    dynPress: values.dynPress ?? null,
    pitch: values.pitch ?? null,
    roll: values.roll ?? null,
    yaw: values.yaw ?? null,
    gear: values.gear ?? null,
    flaps: values.flaps ?? null,
    brakes: values.brakes ?? null,
    health: values.health ?? null,
  };
}

function segment(samples: SampleTable): TrackSegment {
  return {
    index: 0,
    logicalIndex: 0,
    chunkIndex: 0,
    kind: 'flight',
    body: 'Kerbin',
    startUt: samples.t[0]!,
    endUt: samples.t[samples.length - 1]!,
    source: 'active',
    boundary: false,
    samples,
    orbit: null,
  };
}

function vessel(samples: SampleTable): VesselTrack {
  return {
    id: 'v1',
    name: 'Test',
    type: 'Plane',
    body: 'Kerbin',
    color: '#4fc3f7',
    team: null,
    rootPart: null,
    partCount: null,
    crewCount: null,
    side: 'neutral',
    callsign: null,
    kind: 'unknown',
    health: null,
    loadout: [],
    transient: false,
    segments: [segment(samples)],
  };
}

describe('math', () => {
  it('converts lat/lon/alt to body-fixed and back', () => {
    const bf = latLonAltToBF(0, 90, 1000, 600000);
    expect(bf.x).toBeCloseTo(0, 6);
    expect(bf.y).toBeCloseTo(0, 6);
    expect(bf.z).toBeCloseTo(601000, 6);
    const back = bfToLatLon(bf, 600000);
    expect(back.lat).toBeCloseTo(0, 9);
    expect(back.lon).toBeCloseTo(90, 9);
    expect(back.alt).toBeCloseTo(1000, 6);
  });

  it('uses AGL for placement and falls back to ASL for old files', () => {
    expect(renderAltitude(1000, 200)).toBe(200);
    expect(renderAltitude(1000, 0)).toBe(0);
    expect(renderAltitude(1000, null)).toBe(1000);
    expect(renderAltitude(1000, undefined)).toBe(1000);
  });

  it('computes true heading relative to local north/east', () => {
    expect(headingOf(vec3(0, 1, 0), 0, 0)).toBeCloseTo(0, 6);
    expect(headingOf(vec3(0, 0, 1), 0, 0)).toBeCloseTo(90, 6);
    expect(headingOf(vec3(0, 0, -1), 0, 0)).toBeCloseTo(270, 6);
  });

  it('slerps along the shortest arc', () => {
    const a = quatFromAxisAngle(vec3(0, 1, 0), 0);
    const b = quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const mid = slerp(a, b, 0.5);
    const v = quatRotate(mid, vec3(0, 0, 1));
    // +Z rotated by +45 deg about +Y -> (sin45, 0, cos45)
    expect(v.x).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(v.z).toBeCloseTo(Math.cos(Math.PI / 4), 6);
  });

  it('picks the antipodal path when quaternions have opposite signs', () => {
    const a = quatFromAxisAngle(vec3(0, 1, 0), 0.1);
    const b = { x: -a.x, y: -a.y, z: -a.z, w: -a.w };
    const mid = slerp(a, b, 0.5);
    expect(mid.x).toBeCloseTo(a.x, 6);
    expect(mid.w).toBeCloseTo(a.w, 6);
  });

  it('rotates the body frame over time', () => {
    const q0 = bodyRotationAt(KERBIN, 0);
    expect(q0.w).toBeCloseTo(1, 6);
    const q1 = bodyRotationAt(KERBIN, 600);
    expect(Math.abs(q1.w)).toBeLessThan(1);
  });

  it('applies spin in the body-local frame, not the parent frame', () => {
    const tilted = {
      ...KERBIN,
      rotation: {
        epochUt: 0,
        q0: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)],
        axis: [0, 1, 0],
        rateDegPerSec: 90,
      },
    } as CelestialBodyDef;
    const q = bodyRotationAt(tilted, 1);
    const v = quatRotate(q, vec3(1, 0, 0));
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('places the root body at the origin', () => {
    const replay = { bodies: BODIES } as unknown as Replay;
    const frame = bodyFrameAt(replay, 'Kerbin', 1000);
    expect(frame.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('sampleVessel', () => {
  const samples = table({
    t: [100, 101],
    lat: Float64Array.from([0, 0.002]),
    lon: Float64Array.from([0, 0.004]),
    alt: Float64Array.from([70, 170]),
    q: new Float32Array([0, 0, 0, 1, 0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]),
    throttle: new Float32Array([0, 1]),
    mass: new Float32Array([12000, 11000]),
    stage: Float64Array.from([3, 2]),
    situation: ['LANDED', 'FLYING'],
    vs: new Float32Array([0, 100]),
    srfSpeed: new Float32Array([0, 200]),
  });
  const v = vessel(samples);

  it('interpolates position, altitude and continuous columns', () => {
    const state = sampleVessel(v, 100.5, BODIES)!;
    expect(state.alt).toBeCloseTo(120, 3);
    expect(state.lat).toBeCloseTo(0.001, 9);
    expect(state.lon).toBeCloseTo(0.002, 9);
    expect(state.throttle).toBeCloseTo(0.5, 6);
    expect(state.mass).toBeCloseTo(11500, 3);
    expect(state.verticalSpeed).toBeCloseTo(50, 4);
    expect(state.speed).toBeCloseTo(100, 4);
  });

  it('prefers the denser segment when warp segments overlap', () => {
    const dense = table({ t: [100, 100.1, 100.2, 100.3], lat: Float64Array.from([0, 0, 0, 0]) });
    const sparse = table({ t: [100.15, 100.65], lat: Float64Array.from([0.01, 0.01]) });
    const overlapping: VesselTrack = {
      ...vessel(dense),
      segments: [segment(dense), segment(sparse)],
    };
    expect(sampleVessel(overlapping, 100.25, BODIES)!.lat).toBeCloseTo(0, 9);
  });

  it('holds discrete columns (stage, situation)', () => {
    const state = sampleVessel(v, 100.5, BODIES)!;
    expect(state.stage).toBe(3);
    expect(state.situation).toBe('LANDED');
    expect(sampleVessel(v, 101, BODIES)!.stage).toBe(2);
  });

  it('resumes a covering track after an overlapping shorter track ends', () => {
    const a = table({t:[0,6],lat:Float64Array.of(1,1)});
    const b = table({t:[2,2.5],lat:Float64Array.of(8,8)});
    const v = {...vessel(a), segments:[segment(a),segment(b)]};
    expect(sampleVessel(v,4,BODIES)!.lat).toBe(1);
  });

  it('prefers an exact recorded point to interpolation in a denser overlapping track', () => {
    const a = table({ t: [0, 3, 6], lat: Float64Array.of(1, 1, 1) });
    const b = table({ t: [2.7, 2.9, 3.1, 3.3], lat: Float64Array.of(8, 8, 8, 8) });
    expect(sampleVessel({ ...vessel(a), segments: [segment(a), segment(b)] }, 3, BODIES)!.lat).toBe(1);
  });

  it('switches the model at the same jump as the rendered trail, even over an exact old anchor', () => {
    const a = table({ t: [0, 0.8, 1, 1.5], lat: Float64Array.of(1, 1, 1, 1) });
    const b = table({ t: [1, 2.25], lat: Float64Array.of(8, 8) });
    const segments = [segment(a), { ...segment(b), index: 1, boundary: true, startUt: 0.9 }];
    const v = { ...vessel(a), segments };
    const at = (ut: number) => sampleVessel(v, ut, BODIES)!;
    expect(at(0.95).segmentIndex).toBe(0); // actual first sample, not declared startUt
    for (const ut of [1, 1.1, 1.5, 2.25]) {
      expect(at(ut)).toMatchObject({ lat: 8, segmentIndex: 1 });
    }
    const trail = buildTrailMeshData(segments.map(s => ({ ...s, samples: s.samples!, radius: KERBIN.radius })), 'Kerbin', true);
    expect(trail.wallPoints.filter(p => p.breakBefore).map(p => p.t)).toEqual([1]);
    expect(trail.wallPoints.map(p => p.t)).toEqual([0, 0.8, 1, 1, 2.25]);
  });

  it('ignores stale tails in both clamps across multiple same-body jumps', () => {
    const make = (index: number, t: number[], lat: number[], boundary = false) =>
      ({ ...segment(table({ t, lat: Float64Array.from(lat) })), index, boundary });
    const segments = [
      make(0, [0, 0.8, 2.5, 6], [1, 1, 60, 60]),
      make(1, [1, 1.6, 5], [8, 8, 70], true),
      make(2, [3, 3.5], [12, 12], true),
    ];
    const v = { ...vessel(segments[0].samples!), segments };
    const at = (ut: number) => sampleVessel(v, ut, BODIES)!;
    expect(at(0.95)).toMatchObject({ lat: 1, segmentIndex: 0, clampedEnd: true });
    expect(at(2.95)).toMatchObject({ lat: 8, segmentIndex: 1, clampedEnd: true });
    expect(at(3)).toMatchObject({ lat: 12, segmentIndex: 2 });
    expect(at(5)).toMatchObject({ lat: 12, segmentIndex: 2, clampedEnd: true });
    expect(at(7)).toMatchObject({ lat: 12, segmentIndex: 2, clampedEnd: true });
  });

  it('does not let another body’s discontinuity erase a covering exact sample', () => {
    const a = table({ t: [0, 2, 4], lat: Float64Array.of(1, 1, 1) });
    const b = table({ t: [1, 3], lat: Float64Array.of(8, 8) });
    const v = { ...vessel(a), segments: [segment(a),
      { ...segment(b), index: 1, body: 'Mun', boundary: true }] };
    expect(sampleVessel(v, 2, BODIES)).toMatchObject({ body: 'Kerbin', lat: 1 });
  });

  it('still clamps before the first sample when the recording starts with a boundary', () => {
    const a = table({ t: [1, 2.25], lat: Float64Array.of(8, 8) });
    const v = { ...vessel(a), segments: [{ ...segment(a), boundary: true }] };
    expect(sampleVessel(v, 0.5, BODIES)).toMatchObject({ lat: 8, clampedStart: true });
  });

  it.each([[359,1],[1,359]])('interpolates heading across north: %s to %s', (a,b) => {
    const s = table({t:[0,1],hdg:Float32Array.of(a,b)});
    expect(sampleVessel(vessel(s),0.5,BODIES)!.heading).toBeCloseTo(0);
  });

  it('slerps attitude', () => {
    const state = sampleVessel(v, 100.5, BODIES)!;
    const forward = quatRotate(state.q, vec3(0, 0, 1));
    expect(forward.x).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it('clamps outside the recorded range', () => {
    const before = sampleVessel(v, 50, BODIES)!;
    expect(before.clampedStart).toBe(true);
    expect(before.alt).toBeCloseTo(70, 6);
    const after = sampleVessel(v, 2000, BODIES)!;
    expect(after.clampedEnd).toBe(true);
    expect(after.alt).toBeCloseTo(170, 6);
  });

  it('reports vessel bounds', () => {
    expect(vesselBounds(v)).toEqual({ startUt: 100, endUt: 101 });
  });

  it('marks a persistent vessel active only between its samples', () => {
    expect(vesselActiveAt(v, 99)).toBe(false);
    expect(vesselActiveAt(v, 100)).toBe(true);
    expect(vesselActiveAt(v, 101)).toBe(true);
    expect(vesselActiveAt(v, 102)).toBe(false);
  });

  it('binary searches sample times', () => {
    const t = Float64Array.from([0, 1, 2, 3, 4]);
    expect(lowerBound(t, -1)).toBe(0);
    expect(lowerBound(t, 0)).toBe(0);
    expect(lowerBound(t, 2.5)).toBe(2);
    expect(lowerBound(t, 4)).toBe(4);
    expect(lowerBound(t, 99)).toBe(4);
  });
});

describe('PlaybackClock', () => {
  it('advances at the configured speed and stops at the end', () => {
    const clock = new PlaybackClock(100, 110);
    clock.play();
    clock.setSpeed(2);
    expect(clock.tick(1)).toBe(true);
    expect(clock.ut).toBeCloseTo(102, 6);
    clock.tick(10);
    expect(clock.ut).toBe(110);
    expect(clock.playing).toBe(false);
  });

  it('restarts from the beginning when play is pressed at the end', () => {
    const clock = new PlaybackClock(100, 110, 110);
    clock.play();
    expect(clock.ut).toBe(100);
    expect(clock.playing).toBe(true);
  });

  it('seeks and clamps', () => {
    const clock = new PlaybackClock(100, 110);
    clock.seek(1000);
    expect(clock.ut).toBe(110);
    clock.seekProgress(0.25);
    expect(clock.ut).toBeCloseTo(102.5, 6);
    clock.seekRelative(-1);
    expect(clock.ut).toBeCloseTo(101.5, 6);
  });

  it('loops when enabled', () => {
    const clock = new PlaybackClock(0, 10);
    clock.loop = true;
    clock.setSpeed(1);
    clock.play();
    clock.tick(12);
    expect(clock.ut).toBeCloseTo(2, 6);
    expect(clock.playing).toBe(true);
  });

  it('does not advance while paused', () => {
    const clock = new PlaybackClock(0, 10, 5);
    expect(clock.tick(1)).toBe(false);
    expect(clock.ut).toBe(5);
  });
});

describe('time formatting', () => {
  it('formats mission time', () => {
    expect(formatMissionTime(3723, 3600)).toBe('T+ 00:02:03');
    expect(formatMissionTime(3599, 7200)).toBe('T- 01:00:01');
  });

  it('formats durations', () => {
    expect(formatDuration(83.4)).toBe('1:23.4');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('formats KSP calendar time', () => {
    expect(formatKspTime(0)).toBe('Y1 D000 00:00:00');
    expect(formatKspTime(86400)).toBe('Y1 D001 00:00:00');
  });
});

describe('chunk normalization', () => {
  function chunk(index: number, logicalIndex: number, chunkIndex: number, times: number[], alt: number[]): Record<string, unknown> {
    return {
      index,
      logicalIndex,
      chunkIndex,
      kind: 'flight',
      body: 'Kerbin',
      startUt: times[0],
      endUt: times[times.length - 1],
      source: 'active',
      boundary: false,
      samples: { ...sampleColumns(times), alt },
    };
  }

  it('groups chunks by logical index, sorts them and concatenates samples', () => {
    const track = {
      segments: [
        chunk(1, 0, 1, [102, 103], [70, 70]),
        chunk(0, 0, 0, [100, 101], [70, 70]),
      ],
    };
    const replay = parseArchive(buildArchive({ track }));
    const segments = replay.vessels[0]!.segments;
    expect(segments).toHaveLength(1);
    expect(Array.from(segments[0]!.samples!.t)).toEqual([100, 101, 102, 103]);
    expect(segments[0]!.logicalIndex).toBe(0);
    expect(segments[0]!.chunkIndex).toBe(0);
  });

  it('keeps the later chunk where times overlap and warns', () => {
    const track = {
      segments: [
        chunk(0, 0, 0, [100, 101], [70, 70]),
        chunk(1, 0, 1, [101, 102], [170, 170]),
      ],
    };
    const replay = parseArchive(buildArchive({ track }));
    const samples = replay.vessels[0]!.segments[0]!.samples!;
    expect(Array.from(samples.t)).toEqual([100, 101, 102]);
    expect(Array.from(samples.alt)).toEqual([70, 170, 170]);
    expect(replay.warnings.some((warning) => warning.code === 'chunkOverlap')).toBe(true);
  });

  it('treats segments without indices as independent logical segments', () => {
    const a = chunk(0, 0, 0, [100, 101], [70, 70]);
    const b = chunk(1, 0, 1, [102, 103], [70, 70]);
    delete a['logicalIndex'];
    delete a['chunkIndex'];
    delete b['logicalIndex'];
    delete b['chunkIndex'];
    const replay = parseArchive(buildArchive({ track: { segments: [a, b] } }));
    expect(replay.vessels[0]!.segments).toHaveLength(2);
  });
});
