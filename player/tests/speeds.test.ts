import { describe, expect, it } from 'vitest';
import { PlaybackClock, SPEEDS } from '../src/playback/clock';

describe('playback speeds', () => {
  it('offers slow motion through 1000x', () => {
    expect(SPEEDS).toEqual([0.25, 0.5, 1, 2, 4, 10, 20, 60, 120, 1000]);
  });

  it('clamps to 1000x without dropping below slow motion', () => {
    const clock = new PlaybackClock(0, 100);
    clock.setSpeed(1000);
    expect(clock.speed).toBe(1000);
    clock.setSpeed(5000);
    expect(clock.speed).toBe(1000);
    clock.setSpeed(0);
    expect(clock.speed).toBe(0.05);
    clock.setSpeed(0.25);
    expect(clock.speed).toBe(0.25);
  });
});
