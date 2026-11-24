import { describe, expect, it } from 'vitest';
import { BufferGeometry, Line, Mesh } from 'three';
import type { SampleTable, VesselTrack } from '../src/format/types';
import type { VesselState } from '../src/playback/track';
import { displayColorHex, isDebrisVessel } from '../src/format/types';
import { createTrailRibbon, updateTrailStyle } from '../src/scene/vessel';
import { VectorArrows } from '../src/scene/vectors';
import {
  DEFAULT_DISPLAY_SETTINGS,
  TRAIL_SIZE_STEPS,
  clampTrailSeconds,
  formatTrailDuration,
  normalizeLabelVisibility,
  setLabelsVisible,
  snapTrailSeconds,
} from '../src/playback/displaySettings';

function vessel(partial: Partial<VesselTrack>): VesselTrack {
  const samples: SampleTable = {
    length: 2,
    t: Float64Array.from([0, 1]),
    lat: Float64Array.from([0, 0]),
    lon: Float64Array.from([0, 1]),
    alt: Float64Array.from([1000, 1000]),
    q: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1]),
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
    kind: 'air/fixedwing',
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
        startUt: 0,
        endUt: 1,
        samples,
      },
    ],
    ...partial,
  };
}

describe('vessel presentation', () => {
  it('uses team side colours for blue and red aircraft', () => {
    expect(displayColorHex(vessel({ side: 'blue' }), 0)).toBe('#4da3ff');
    expect(displayColorHex(vessel({ side: 'red' }), 0)).toBe('#ff5f6d');
  });

  it('keeps palette colours for neutral objects', () => {
    expect(displayColorHex(vessel({ side: 'neutral' }), 0)).toBe('#4fc3f7');
  });

  it('recognises KSP debris that must not be drawn as a vessel', () => {
    expect(isDebrisVessel(vessel({ type: 'Debris' }))).toBe(true);
    expect(isDebrisVessel(vessel({ type: 'Plane' }))).toBe(false);
  });
});

describe('trail ribbon', () => {
  it('creates two sides per sample with time and right-vector attributes', () => {
    const centres = new Float32Array(6 * 3);
    const rights = new Float32Array(6 * 3);
    const times = Float64Array.from([0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 6; i += 1) {
      centres[i * 3] = i;
      rights[i * 3] = 1;
    }
    const ribbon = createTrailRibbon(centres, rights, times, 0xff5f6d);
    const geometry = ribbon.geometry as BufferGeometry;
    const index = geometry.getIndex();
    expect(ribbon).toBeInstanceOf(Mesh);
    expect(geometry.getAttribute('position').count).toBe(12);
    expect(geometry.getAttribute('aRight').count).toBe(12);
    expect(geometry.getAttribute('aTime').count).toBe(12);
    expect(index?.count).toBe(30);
  });

  it('exposes camera-relative width and tail-fade uniforms', () => {
    const ribbon = createTrailRibbon(
      new Float32Array(3),
      new Float32Array(3),
      Float64Array.from([0]),
      0x4da3ff,
    );
    updateTrailStyle(ribbon, {
      halfWidth: 12,
      now: 8,
      window: 30,
      tailFade: 9,
      headFade: 4,
      opacity: 0.4,
    });
    const material = ribbon.material as unknown as { uniforms: Record<string, { value: number }> };
    expect(material.uniforms.uHalfWidth.value).toBe(12);
    expect(material.uniforms.uNow.value).toBe(8);
    expect(material.uniforms.uWindow.value).toBe(30);
    expect(material.uniforms.uTailFade.value).toBe(9);
    expect(material.uniforms.uHeadFade.value).toBe(4);
    expect(material.uniforms.uOpacity.value).toBe(0.4);
  });
});

describe('tactical vectors', () => {
  function state(speed: number, gee: number): VesselState {
    return {
      ut: 0,
      body: 'Kerbin',
      segmentIndex: 0,
      segmentKind: 'flight',
      lat: 0,
      lon: 0,
      alt: 1000,
      bf: { x: 0, y: 600000, z: 0 },
      q: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 1, y: 0, z: 0 },
      speed,
      surfaceSpeed: speed,
      verticalSpeed: 0,
      heading: 0,
      throttle: null,
      mass: null,
      gee,
      stage: null,
      situation: 'FLYING',
      lf: null,
      ox: null,
      ec: null,
      mp: null,
      clampedStart: false,
      clampedEnd: false,
    };
  }

  it('draws plain rays without arrow heads', () => {
    const arrows = new VectorArrows();
    arrows.update(state(250, 3), true, 100);
    expect(arrows.group.children.length).toBe(3);
    expect(arrows.group.children.every((child) => child instanceof Line)).toBe(true);
  });

  it('scales ray length with speed and load factor', () => {
    const slow = new VectorArrows();
    slow.update(state(100, 1), true, 100);
    const fast = new VectorArrows();
    fast.update(state(800, 9), true, 100);
    const slowLengths = slow.rayLengths();
    const fastLengths = fast.rayLengths();
    expect(fastLengths[0]).toBeGreaterThan(slowLengths[0]);
    expect(fastLengths[2]).toBeGreaterThan(slowLengths[2]);
  });
});

describe('trail display controls', () => {
  it('formats trail duration as mm:ss', () => {
    expect(formatTrailDuration(60)).toBe('01:00');
    expect(formatTrailDuration(120)).toBe('02:00');
    expect(formatTrailDuration(5)).toBe('00:05');
    expect(formatTrailDuration(3600)).toBe('1:00:00');
    expect(formatTrailDuration(86400)).toBe('24:00:00');
  });

  it('snaps trail sizes to visible slider steps', () => {
    expect(TRAIL_SIZE_STEPS).toContain(60);
    expect(TRAIL_SIZE_STEPS).toContain(3600);
    expect(TRAIL_SIZE_STEPS).toContain(86400);
    expect(snapTrailSeconds(47)).toBe(50);
    expect(snapTrailSeconds(83)).toBe(80);
    expect(snapTrailSeconds(3400)).toBe(3600);
    expect(snapTrailSeconds(80000)).toBe(86400);
    expect(clampTrailSeconds(99999)).toBe(86400);
  });

  it('turns labels off when no contents remain selected', () => {
    const empty = {
      ...DEFAULT_DISPLAY_SETTINGS,
      showLabels: true,
      selectedLabel: { ...DEFAULT_DISPLAY_SETTINGS.selectedLabel, fields: [] },
      unselectedLabel: { ...DEFAULT_DISPLAY_SETTINGS.unselectedLabel, fields: [] },
    };
    const normalized = normalizeLabelVisibility(empty);
    expect(normalized.showLabels).toBe(false);
  });

  it('restores the default label fields when labels are switched back on', () => {
    const empty = {
      ...DEFAULT_DISPLAY_SETTINGS,
      showLabels: false,
      selectedLabel: { ...DEFAULT_DISPLAY_SETTINGS.selectedLabel, fields: [] },
      unselectedLabel: { ...DEFAULT_DISPLAY_SETTINGS.unselectedLabel, fields: [] },
    };
    const enabled = setLabelsVisible(empty, true);
    expect(enabled.showLabels).toBe(true);
    expect(enabled.selectedLabel.fields.length).toBeGreaterThan(0);
    expect(enabled.unselectedLabel.fields.length).toBeGreaterThan(0);
  });
});
