import { describe, expect, it } from 'vitest';
import { vesselActiveAt, vesselFirstUt, vesselLastUt } from '../src/playback/track';
import type { SampleTable, TrackSegment, VesselTrack } from '../src/format/types';

function samples(times: number[]): SampleTable {
  return {
    length: times.length,
    t: Float64Array.from(times),
    lat: new Float64Array(times.length),
    lon: new Float64Array(times.length),
    alt: new Float64Array(times.length),
    q: new Float32Array(times.flatMap(() => [0, 0, 0, 1])),
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
    agl: null,
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

function segment(overrides: Partial<TrackSegment> & { samples: SampleTable }): TrackSegment {
  const { samples: table, ...rest } = overrides;
  const t = table.t;
  return {
    index: 0,
    logicalIndex: 0,
    chunkIndex: 0,
    kind: 'flight',
    body: 'Kerbin',
    startUt: t[0] as number,
    endUt: t[t.length - 1] as number,
    source: 'active',
    boundary: false,
    samples: table,
    orbit: null,
    ...rest,
  };
}

function vessel(segments: TrackSegment[]): VesselTrack {
  return {
    id: 'test',
    name: 'Test',
    type: 'Ship',
    body: 'Kerbin',
    color: null,
    team: null,
    rootPart: null,
    partCount: null,
    crewCount: null,
    side: 'neutral',
    callsign: null,
    kind: 'ship',
    health: null,
    loadout: [],
    transient: false,
    segments,
  };
}

describe('vesselActiveAt with a static segment', () => {
  it('keeps a one-sample ground station visible for the rest of the replay', () => {
    const track = vessel([
      segment({ kind: 'static', source: 'loaded', samples: samples([100]) }),
    ]);
    expect(vesselActiveAt(track, 100)).toBe(true);
    expect(vesselActiveAt(track, 500)).toBe(true);
    expect(vesselActiveAt(track, 99)).toBe(false);
  });

  it('still hides a normal flight track after its last sample', () => {
    const track = vessel([segment({ samples: samples([0, 10]) })]);
    expect(vesselActiveAt(track, 10)).toBe(true);
    expect(vesselActiveAt(track, 20)).toBe(false);
  });

  it('does not keep an earlier static segment alive past a later flight', () => {
    const track = vessel([
      segment({ kind: 'static', source: 'loaded', samples: samples([0]) }),
      segment({ samples: samples([100, 200]) }),
    ]);
    expect(vesselActiveAt(track, 50)).toBe(true);
    expect(vesselActiveAt(track, 150)).toBe(true);
    expect(vesselActiveAt(track, 300)).toBe(false);
  });

  it('keeps a final static segment visible after the last flight', () => {
    const track = vessel([
      segment({ samples: samples([100, 200]) }),
      segment({ kind: 'static', source: 'loaded', samples: samples([300]) }),
    ]);
    expect(vesselActiveAt(track, 250)).toBe(true);
    expect(vesselActiveAt(track, 500)).toBe(true);
  });

  it('shows a transient actor only around its own sample window', () => {
    const track = { ...vessel([segment({ samples: samples([100, 110]) })]), transient: true };
    expect(vesselActiveAt(track, 99.9)).toBe(false);
    expect(vesselActiveAt(track, 100)).toBe(true);
    expect(vesselActiveAt(track, 110)).toBe(true);
    expect(vesselActiveAt(track, 111)).toBe(false);
    expect(vesselFirstUt(track)).toBe(100);
    expect(vesselLastUt(track)).toBe(110);
  });
});
