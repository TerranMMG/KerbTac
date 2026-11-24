import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { VesselTrack } from '../src/format/types';
import type { VesselState } from '../src/playback/track';
import {
  MODEL_SCALES,
  computeVectors,
  snapModelScale,
} from '../src/scene/vectors';
import {
  labelLines,
  resolveLabelOverlaps,
  shouldShowLabel,
  type LabelBox,
} from '../src/scene/labels';

function vessel(overrides: Partial<VesselTrack> = {}): VesselTrack {
  return {
    id: 'v1',
    name: 'Traveller 1',
    type: 'plane',
    body: 'Kerbin',
    color: null,
    team: 'Blue',
    rootPart: null,
    partCount: 20,
    crewCount: 1,
    side: 'blue',
    callsign: 'Viper',
    kind: 'air',
    health: 1,
    loadout: [],
    transient: false,
    segments: [],
    ...overrides,
  };
}

function stateWith(forward: Vector3, up: Vector3, velocity: Vector3 | null): VesselState {
  // Build an orientation whose model +Z and +Y map to the requested vectors.
  const z = forward.clone().normalize();
  let x = new Vector3().crossVectors(up, z).normalize();
  if (x.lengthSq() < 1e-8) x = new Vector3(1, 0, 0);
  const y = new Vector3().crossVectors(z, x).normalize();
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
  return {
    ut: 100,
    body: 'Kerbin',
    segmentIndex: 0,
    segmentKind: 'flight',
    lat: 0,
    lon: 0,
    alt: 1000,
    bf: { x: 0, y: 0, z: 0 },
    q: { x: q.x, y: q.y, z: q.z, w: q.w },
    velocity: velocity
      ? { x: velocity.x, y: velocity.y, z: velocity.z }
      : null,
    speed: velocity ? velocity.length() : null,
    verticalSpeed: 0,
    heading: 0,
    throttle: 0.5,
    mass: 10,
    gee: 1,
    stage: 1,
    situation: 'flying',
    lf: 100,
    ox: 50,
    ec: 10,
    mp: 5,
    ias: 240,
    mach: 0.82,
    aoa: 3.5,
    agl: 800,
    clampedStart: false,
    clampedEnd: false,
  };
}

describe('vectors and model scale', () => {
  it('snaps model scale to the nearest step', () => {
    expect(snapModelScale(0)).toBe(0.5);
    expect(snapModelScale(2)).toBe(1);
    expect(snapModelScale(99)).toBe(10);
    expect(MODEL_SCALES).toEqual([0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10]);
  });

  it('projects heading onto the local horizontal plane', () => {
    const state = stateWith(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 100),
    );
    const vectors = computeVectors(state);
    expect(vectors.heading.y).toBeCloseTo(0, 5);
    expect(vectors.heading.z).toBeCloseTo(1, 5);
    expect(vectors.heading.length()).toBeCloseTo(1, 5);
  });

  it('uses normalized velocity for course and keeps lift perpendicular to it', () => {
    const velocity = new Vector3(30, 40, 0);
    const state = stateWith(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      velocity,
    );
    const vectors = computeVectors(state);
    expect(vectors.course.x).toBeCloseTo(0.6, 5);
    expect(vectors.course.y).toBeCloseTo(0.8, 5);
    expect(vectors.lift).not.toBeNull();
    expect(vectors.lift!.dot(velocity.clone().normalize())).toBeCloseTo(0, 5);
  });

  it('returns a null lift when velocity is parallel to local up', () => {
    const vectors = computeVectors(
      stateWith(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(0, 100, 0)),
    );
    expect(vectors.lift).toBeNull();
  });
});

describe('labels', () => {
  it('builds an identity line and a telemetry line from enabled fields', () => {
    const state = stateWith(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 0),
    );
    const lines = labelLines(vessel(), state, {
      fields: ['name', 'callsign', 'tas', 'mach', 'asl', 'aoa'],
      scale: 1,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Traveller 1 · Viper');
    expect(lines[1]).toContain('TAS 0 m/s');
    expect(lines[1]).toContain('M 0.82');
    expect(lines[1]).toContain('ASL 1,000 m');
    expect(lines[1]).toContain('AOA 3.5°');
  });

  it('honours the field list and label scale order', () => {
    const state = stateWith(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 0),
    );
    const lines = labelLines(vessel(), state, {
      fields: ['callsign', 'agl', 'gs'],
      scale: 0.75,
    });
    expect(lines).toEqual(['Viper', 'AGL 800 m · GS 0 m/s']);
  });

  it('formats altitude and speed units', () => {
    const state = stateWith(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 0),
    )
    const lines = labelLines(
      vessel(),
      state,
      { fields: ['name', 'tas', 'asl', 'vs'], scale: 1 },
      { altitude: 'ft', speedDistance: 'nautical' },
    );
    expect(lines[0]).toBe('Traveller 1');
    expect(lines[1]).toContain('TAS 0 kn');
    expect(lines[1]).toContain('ASL 3,281 ft');
    expect(lines[1]).toContain('VS +0 ft/min');
  });

  it('allows overlapping labels and always shows them', () => {
    const selected = { x: 0, y: 0, width: 100, height: 20, distance: 999 };
    const far = { x: 10, y: 0, width: 100, height: 20, distance: 500 };
    const near = { x: 10, y: 0, width: 100, height: 20, distance: 100 };

    expect(shouldShowLabel(selected, [near], true)).toBe(true);
    expect(shouldShowLabel(far, [near], false)).toBe(true);
    expect(shouldShowLabel(near, [far], false)).toBe(true);
    expect(
      shouldShowLabel({ ...near, x: 500 }, [far], false),
    ).toBe(true);
  });

  it('does not let an unselected label hide a selected one', () => {
    const selected: LabelBox = {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      distance: 999,
    };
    const unselected: LabelBox = {
      x: 10,
      y: 0,
      width: 100,
      height: 20,
      distance: 10,
    };
    expect(shouldShowLabel(selected, [unselected], true)).toBe(true);
  });

  it('separates overlapping labels across teams and neutral vessels', () => {
    const boxes: LabelBox[] = [
      { x: 100, y: 100, width: 130, height: 36, distance: 100, id: 'red', selected: false },
      { x: 100, y: 100, width: 130, height: 36, distance: 90, id: 'blue', selected: false },
      { x: 100, y: 100, width: 130, height: 36, distance: 80, id: 'neutral', selected: false },
    ];
    resolveLabelOverlaps(boxes, 800, 600);
    const ys = new Set(boxes.map((box) => box.y));
    expect(ys.size).toBe(3);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const separated =
          a.x + a.width + 4 <= b.x ||
          b.x + b.width + 4 <= a.x ||
          a.y + a.height + 4 <= b.y ||
          b.y + b.height + 4 <= a.y;
        expect(separated).toBe(true);
      }
    }
  });

  it('keeps the selected label at its natural position and stacks others', () => {
    const selected: LabelBox = {
      x: 100,
      y: 100,
      width: 130,
      height: 36,
      distance: 999,
      selected: true,
    };
    const other: LabelBox = {
      x: 100,
      y: 100,
      width: 130,
      height: 36,
      distance: 10,
    };
    resolveLabelOverlaps([other, selected], 800, 600);
    expect(selected.y).toBe(100);
    expect(other.y).not.toBe(100);
  });
});
