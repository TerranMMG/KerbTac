import { describe, expect, it } from 'vitest';
import type { ReplayEvent } from '../src/format/types';
import { bearingRange } from '../src/playback/geo';
import { eventsForSelection, eventVesselId } from '../src/playback/selection';

function event(overrides: Partial<ReplayEvent>): ReplayEvent {
  return {
    ut: 1,
    type: 'hit',
    vessel: null,
    target: null,
    body: 'Kerbin',
    lat: 0,
    lon: 0,
    alt: 0,
    source: null,
    weapon: null,
    outcome: null,
    range: null,
    aspect: null,
    damage: null,
    data: {},
    ...overrides,
  };
}

describe('eventsForSelection', () => {
  it('returns every event when nothing is selected', () => {
    const all = [event({ vessel: 'red-1' }), event({ vessel: 'blue-1' })];
    expect(eventsForSelection(all, null)).toEqual(all);
  });

  it('matches source and target as well as vessel', () => {
    const hit = event({ vessel: 'red-1', source: 'blue-1', target: 'red-1' });
    expect(eventsForSelection([hit], 'blue-1')).toHaveLength(1);
    expect(eventsForSelection([hit], 'red-1')).toHaveLength(1);
    expect(eventsForSelection([hit], 'other')).toHaveLength(0);
  });

  it('keeps events whose only owner is the vessel', () => {
    const note = event({ type: 'note', vessel: 'blue-1' });
    expect(eventsForSelection([note], 'blue-1')).toEqual([note]);
  });

  it('shows gunfire and weapon release only on the shooter', () => {
    const gunfire = event({ type: 'gunfire', vessel: 'blue-1', target: 'red-1' });
    const release = event({ type: 'weapon_release', vessel: 'blue-1', target: 'red-1' });
    expect(eventsForSelection([gunfire], 'blue-1')).toHaveLength(1);
    expect(eventsForSelection([gunfire], 'red-1')).toHaveLength(0);
    expect(eventsForSelection([release], 'blue-1')).toHaveLength(1);
    expect(eventsForSelection([release], 'red-1')).toHaveLength(0);
  });

  it('shows a miss on the shooter, not on the target', () => {
    const miss = event({ type: 'miss', vessel: 'red-1', source: 'blue-1', target: 'red-1' });
    expect(eventsForSelection([miss], 'blue-1')).toHaveLength(1);
    expect(eventsForSelection([miss], 'red-1')).toHaveLength(0);
  });

  it('returns an empty array for a transient actor with no events', () => {
    expect(eventsForSelection([event({ vessel: 'red-1' })], 'missile-1')).toEqual([]);
  });
});

describe('eventVesselId', () => {
  it('prefers the vessel that owns the event, then its source and target', () => {
    expect(eventVesselId(event({ vessel: 'red-1', source: 'blue-1', target: 'green-1' }))).toBe('red-1');
    expect(eventVesselId(event({ source: 'blue-1', target: 'green-1' }))).toBe('blue-1');
    expect(eventVesselId(event({ target: 'green-1' }))).toBe('green-1');
    expect(eventVesselId(event({}))).toBeNull();
    expect(
      eventVesselId(event({ type: 'miss', vessel: 'red-1', source: 'blue-1', target: 'red-1' })),
    ).toBe('blue-1');
  });
});

describe('bearingRange', () => {
  it('computes bearing and range on the equator', () => {
    const result = bearingRange({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, 600000);
    expect(result.rangeKm).toBeCloseTo(10.47, 1);
    expect(result.bearingDeg).toBeCloseTo(90, 1);
  });

  it('reports north as bearing zero', () => {
    const result = bearingRange({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, 600000);
    expect(result.rangeKm).toBeCloseTo(10.47, 1);
    expect(result.bearingDeg).toBeCloseTo(0, 3);
  });

  it('normalizes westbound bearings to 180..360', () => {
    const result = bearingRange({ lat: 0, lon: 1 }, { lat: 0, lon: 0 }, 600000);
    expect(result.bearingDeg).toBeCloseTo(270, 3);
  });
});
