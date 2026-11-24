import { describe, expect, it } from 'vitest';
import { frameRadiusForAltitude } from '../src/scene/frame';

describe('high orbit framing', () => {
  it('keeps the close default for ground and low orbit', () => {
    expect(frameRadiusForAltitude(0)).toBe(2_000);
    expect(frameRadiusForAltitude(10_000)).toBe(2_000);
  });

  it('grows with altitude but caps at a local high-orbit view', () => {
    expect(frameRadiusForAltitude(100_000)).toBe(20_000);
    expect(frameRadiusForAltitude(2_000_000)).toBe(200_000);
    expect(frameRadiusForAltitude(15_000_000)).toBe(500_000);
  });

  it('falls back to the default for invalid altitudes', () => {
    expect(frameRadiusForAltitude(Number.NaN)).toBe(2_000);
    expect(frameRadiusForAltitude(Number.POSITIVE_INFINITY)).toBe(2_000);
  });
});
