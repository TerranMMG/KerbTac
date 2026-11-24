import { describe, expect, it } from 'vitest';
import { createSatelliteMarker } from '../src/scene/vessel';
import { Box3, Vector3 } from 'three';

describe('createSatelliteMarker', () => {
  it('builds a probe with solar panels', () => {
    const group = createSatelliteMarker(0xff8800, 'Probe');
    expect(group.userData.kind).toBe('satellite');
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });

  it('builds a larger station', () => {
    const probe = createSatelliteMarker(0x88aaff, 'Probe');
    const station = createSatelliteMarker(0x88aaff, 'Station');
    const span = (group: typeof station) => new Box3().setFromObject(group).getSize(new Vector3());
    expect(span(station).x).toBeGreaterThan(span(probe).x);
    expect(span(station).z).toBeGreaterThan(span(probe).z);
  });
});
