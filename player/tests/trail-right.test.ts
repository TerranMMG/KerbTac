import { describe, expect, it } from 'vitest';
import { trailRightVector } from '../src/scene/trailRight';

function length(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe('trail right vector', () => {
  it('is perpendicular to both the radial and the path tangent', () => {
    const right = trailRightVector({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.y).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(0, 6);
    expect(length(right)).toBeCloseTo(1, 6);
  });

  it('stays in the local tangent plane for an inclined path', () => {
    const radial = { x: 0, y: 1, z: 0 };
    const tangent = { x: 1, y: 0, z: 1 };
    const right = trailRightVector(radial, tangent);
    expect(right.y).toBeCloseTo(0, 6);
    expect(right.x * tangent.x + right.y * tangent.y + right.z * tangent.z).toBeCloseTo(0, 6);
    expect(right.x * radial.x + right.y * radial.y + right.z * radial.z).toBeCloseTo(0, 6);
  });

  it('falls back to a stable axis when the inputs are degenerate', () => {
    expect(trailRightVector({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(trailRightVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
});
