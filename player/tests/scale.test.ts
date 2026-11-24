import { describe, expect, it } from 'vitest';
import { markerScale } from '../src/scene/scale';

describe('marker scale', () => {
  it('does not change when selection changes', () => {
    const base = { mode: 'external' as const, distance: 5_000, satelliteSpan: 500_000, modelScale: 1 };
    expect(markerScale({ ...base, transient: false })).toBe(
      markerScale({ ...base, transient: false }),
    );
  });

  it('uses a bounded satellite scale instead of the million-metre camera distance', () => {
    const aircraft = markerScale({
      mode: 'satellite',
      distance: 1_000_000,
      satelliteSpan: 500_000,
      transient: false,
      modelScale: 1,
    });
    const missile = markerScale({
      mode: 'satellite',
      distance: 1_000_000,
      satelliteSpan: 500_000,
      transient: true,
      modelScale: 1,
    });
    expect(aircraft).toBeLessThan(200);
    expect(missile).toBeLessThan(5_000);
    expect(aircraft).toBeGreaterThan(0);
  });

  it('uses the same scale rule for aircraft and missiles', () => {
    const base = { mode: 'external' as const, distance: 5_000, satelliteSpan: 500_000, modelScale: 1 };
    expect(markerScale({ ...base, transient: true })).toBe(
      markerScale({ ...base, transient: false }),
    );
  });

  it('applies the global model-scale multiplier', () => {
    const settings = {
      mode: 'external' as const,
      distance: 5_000,
      satelliteSpan: 500_000,
      transient: false,
      modelScale: 1,
    };
    expect(markerScale({ ...settings, modelScale: 2 })).toBe(markerScale(settings) * 2);
  });
});
