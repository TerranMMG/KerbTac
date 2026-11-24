import { describe, expect, it } from 'vitest';
import { trailHalfWidth } from '../src/scene/trailWidth';

describe('trail half width', () => {
  it('keeps the physical width when it is wider than the screen minimum', () => {
    expect(trailHalfWidth(24, 1)).toBe(24);
  });

  it('widens distant trails to a minimum screen size', () => {
    expect(trailHalfWidth(24, 1000)).toBe(1200);
  });

  it('does not collapse a sub-metre transient trail', () => {
    expect(trailHalfWidth(0.8, 0.1)).toBeCloseTo(0.8, 6);
  });

  it('falls back to the physical width for invalid input', () => {
    expect(trailHalfWidth(24, Number.NaN)).toBe(24);
    expect(trailHalfWidth(24, 0)).toBe(24);
  });
});
