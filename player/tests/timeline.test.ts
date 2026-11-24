import { describe, expect, it } from 'vitest';
import type { ReplayEvent } from '../src/format/types';
import { PlaybackClock, nextOutsideGap } from '../src/playback/clock';
import { eventsForSelection } from '../src/playback/selection';
import { eventAtX, formatTimelineOffset, laneForEvent, timeToX, timelineOffsets, visibleRange, xToTime } from '../src/ui/timeline';

function ev(type: string, vessel: string | null, target: string | null = null): ReplayEvent {
  return {
    ut: 10,
    type,
    vessel,
    target,
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
  };
}

describe('eventsForSelection', () => {
  it('filters timeline events to the selected vessel', () => {
    const events = [ev('hit', 'red-1', 'blue-1'), ev('weapon_release', 'blue-1', 'blue-1')];
    expect(eventsForSelection(events, 'blue-1')).toHaveLength(2);
    expect(eventsForSelection(events, 'red-1')).toHaveLength(1);
    expect(eventsForSelection(events, null)).toHaveLength(2);
  });
});

describe('timeline mapping', () => {
  it('maps time to pixels and back', () => {
    expect(timeToX(50, 0, 100, 1000)).toBeCloseTo(500, 5);
    expect(xToTime(500, 0, 100, 1000)).toBeCloseTo(50, 5);
  });

  it('clamps degenerate ranges', () => {
    expect(timeToX(5, 10, 10, 100)).toBe(0);
    expect(xToTime(5, 10, 10, 100)).toBe(10);
  });

  it('places event types in separate lanes', () => {
    expect(laneForEvent('weapon_release')).toBe(0);
    expect(laneForEvent('gunfire')).toBe(0);
    expect(laneForEvent('hit')).toBe(1);
    expect(laneForEvent('kill')).toBe(1);
    expect(laneForEvent('target_lock')).toBe(2);
    expect(laneForEvent('takeoff')).toBe(3);
    expect(laneForEvent('flight_start')).toBe(3);
    expect(laneForEvent('note')).toBe(4);
    expect(laneForEvent('unknown_type')).toBe(4);
  });

  it('zooms a viewport and keeps it inside the session', () => {
    expect(visibleRange(0, 100, 1, 50)).toEqual([0, 100]);
    expect(visibleRange(0, 100, 2, 50)).toEqual([25, 75]);
    expect(visibleRange(0, 100, 2, 0)).toEqual([0, 50]);
    expect(visibleRange(0, 100, 2, 100)).toEqual([50, 100]);
    expect(visibleRange(0, 100, 0.1, 50)).toEqual([0, 100]);
  });
});

describe('PlaybackClock gaps', () => {
  it('jumps over a gap instead of interpolating through it', () => {
    const clock = new PlaybackClock(0, 100, 9);
    clock.setGaps([{ startUt: 10, endUt: 20, reason: 'sample_gap' }]);
    clock.play();
    clock.tick(2);
    expect(clock.ut).toBeCloseTo(20, 6);
    expect(clock.playing).toBe(true);
  });

  it('finds the next time outside overlapping gaps', () => {
    const gaps = [
      { startUt: 10, endUt: 20 },
      { startUt: 18, endUt: 30 },
    ];
    expect(nextOutsideGap(gaps, 25)).toBe(30);
    expect(nextOutsideGap(gaps, 5)).toBe(5);
  });
});

describe('timeline readouts and event hit testing', () => {
  it('formats signed offsets from mission zero and time left to playback end', () => {
    expect(formatTimelineOffset(0)).toBe('00:00:00')
    expect(formatTimelineOffset(3661.9)).toBe('01:01:01')
    expect(formatTimelineOffset(90061)).toBe('25:01:01')
    expect(timelineOffsets(42, 10, 100)).toEqual({
      elapsed: '+00:00:32',
      remaining: '-00:00:58',
    })
    expect(timelineOffsets(5, 10, 100)).toEqual({
      elapsed: '-00:00:05',
      remaining: '-00:01:35',
    })
  })

  it('finds the event marker under the cursor', () => {
    const events = [
      { ...ev('hit', 'blue-1'), ut: 20 },
      { ...ev('note', 'blue-1'), ut: 60 },
    ]
    expect(eventAtX(events, 200, 0, 100, 1000, 6)?.ut).toBe(20)
    expect(eventAtX(events, 203, 0, 100, 1000, 6)?.ut).toBe(20)
    expect(eventAtX(events, 220, 0, 100, 1000, 6)).toBeNull()
    expect(eventAtX(events, 596, 0, 100, 1000, 6)?.ut).toBe(60)
  })
})
