// Body-fixed <-> world transforms, including body rotation over UT.

import type { CelestialBodyDef, QuatTuple, Replay } from '../format/types';
import {
  DEG,
  IDENTITY,
  add,
  quat,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
  scale,
  vec3,
  type Quat,
  type Vec3,
} from './math';

export interface BodyFrame {
  /** Rotation from the body-fixed frame to the session world frame. */
  quat: Quat;
  /** Body centre in the session world frame (metres). */
  position: Vec3;
}

export function bodyRotationAt(body: CelestialBodyDef, ut: number): Quat {
  const deltaSeconds = ut - body.rotation.epochUt;
  const angle = body.rotation.rateDegPerSec * deltaSeconds * DEG;
  const spin = quatFromAxisAngle(vec3(...body.rotation.axis), angle);
  // q0 places the body in its parent frame; the spin axis is body-local, so
  // the incremental rotation applies on the right.
  return quatMultiply(quatFromTuple(body.rotation.q0), spin);
}

function quatFromTuple(tuple: QuatTuple): Quat {
  return quat(tuple[0], tuple[1], tuple[2], tuple[3]);
}

/**
 * Resolve the world transform of a body. v1 only makes the root body's frame
 * authoritative; child bodies fall back to their parent's origin (allowed by
 * docs/format-v1.md §6.1) and are flagged so the UI can say so.
 */
export function bodyFrameAt(
  replay: Replay,
  bodyName: string,
  ut: number,
  onFallback?: (bodyName: string) => void,
): BodyFrame {
  const body = replay.bodies.get(bodyName);
  if (!body) return { quat: { ...IDENTITY }, position: vec3() };

  const rotation = bodyRotationAt(body, ut);
  if (body.parent === null) {
    return { quat: rotation, position: vec3() };
  }

  const parent = replay.bodies.get(body.parent);
  if (!parent) return { quat: rotation, position: vec3() };

  const parentFrame = bodyFrameAt(replay, parent.name, ut, onFallback);
  if (!body.orbit) {
    onFallback?.(body.name);
    return { quat: quatMultiply(parentFrame.quat, rotation), position: parentFrame.position };
  }

  // Orbital propagation is implemented in orbit.ts but is not wired into the
  // M1 scene; callers that need it opt in explicitly.
  onFallback?.(body.name);
  return { quat: quatMultiply(parentFrame.quat, rotation), position: parentFrame.position };
}

export function bfToWorld(frame: BodyFrame, bf: Vec3): Vec3 {
  return add(frame.position, quatRotate(frame.quat, bf));
}

export function worldToBF(frame: BodyFrame, world: Vec3): Vec3 {
  return quatRotate({ x: -frame.quat.x, y: -frame.quat.y, z: -frame.quat.z, w: frame.quat.w }, {
    x: world.x - frame.position.x,
    y: world.y - frame.position.y,
    z: world.z - frame.position.z,
  });
}

/** Direction of local "up" in world space at a body-fixed location. */
export function upAt(frame: BodyFrame, bf: Vec3): Vec3 {
  const len = Math.hypot(bf.x, bf.y, bf.z) || 1;
  return quatRotate(frame.quat, scale(bf, 1 / len));
}
