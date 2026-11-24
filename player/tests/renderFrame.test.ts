import { describe, expect, it } from 'vitest';
import { quatFromAxisAngle, quatRotate, vec3 } from '../src/playback/math';
import { bfToRenderWorld, toRenderPosition, toRenderQuat } from '../src/scene/renderFrame';

describe('render frame conversion', () => {
  it('mirrors the format Z axis into the right-handed render frame', () => {
    expect(toRenderPosition(vec3(1, 2, 3))).toEqual({ x: 1, y: 2, z: -3 });
  });

  it('conjugates a rotation by the Z reflection', () => {
    const q = quatFromAxisAngle(vec3(1, 0, 0), Math.PI / 2);
    const v = vec3(0, 1, 0);
    const direct = quatRotate(q, v);
    const rendered = quatRotate(toRenderQuat(q), toRenderPosition(v));
    expect(rendered.x).toBeCloseTo(toRenderPosition(direct).x, 12);
    expect(rendered.y).toBeCloseTo(toRenderPosition(direct).y, 12);
    expect(rendered.z).toBeCloseTo(toRenderPosition(direct).z, 12);
  });

  it('mirrors body-fixed world positions when the body frame is identity', () => {
    const world = bfToRenderWorld(
      { quat: { x: 0, y: 0, z: 0, w: 1 }, position: vec3(0, 0, 0) },
      vec3(1, 2, 3),
    );
    expect(world).toEqual({ x: 1, y: 2, z: -3 });
  });
});
