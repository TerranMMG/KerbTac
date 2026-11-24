// KSP's body-fixed frame is left-handed when read as (X, Y, Z) in Three.js:
// longitude increases eastward with z = r cos(lat) sin(lon), so looking at the
// globe from outside mirrors east and west. The format keeps that convention
// (docs/format-v1.md §4), but the renderer converts every position and
// attitude into a right-handed render frame by negating Z.
//
// For a reflection S = diag(1, 1, -1), a rotation R becomes S R S. In
// quaternion components that is (-x, -y, z, w).

import type { BodyFrame } from '../playback/body'
import { bfToWorld } from '../playback/body'
import type { Quat, Vec3 } from '../playback/math'

export function toRenderPosition(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: -v.z }
}

export function toRenderQuat(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: q.z, w: q.w }
}

export function toRenderFrame(frame: BodyFrame): BodyFrame {
  return {
    quat: toRenderQuat(frame.quat),
    position: toRenderPosition(frame.position),
  }
}

/** Body-fixed format position -> world position in the render frame. */
export function bfToRenderWorld(frame: BodyFrame, bf: Vec3): Vec3 {
  return bfToWorld(toRenderFrame(frame), toRenderPosition(bf))
}
