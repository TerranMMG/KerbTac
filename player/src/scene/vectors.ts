import * as THREE from 'three';
import type { VesselState } from '../playback/track';

/** User-facing discrete model-size steps. There is no continuous slider. */
export const MODEL_SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10] as const;

export type ModelScale = (typeof MODEL_SCALES)[number];

/** Snap a step index to the closest valid model scale. */
export function snapModelScale(index: number): number {
  if (!Number.isFinite(index)) return MODEL_SCALES[0];
  const i = Math.round(index);
  const clamped = Math.max(0, Math.min(MODEL_SCALES.length - 1, i));
  return MODEL_SCALES[clamped] as number;
}

export interface VesselVectors {
  /** Body-forward projected on the local horizontal plane. */
  heading: THREE.Vector3;
  /** Normalized velocity vector. Zero when velocity is unavailable. */
  course: THREE.Vector3;
  /** Local up with the velocity component removed, or null when near zero. */
  lift: THREE.Vector3 | null;
}

function vector(value: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

/**
 * Compute the three tactical vectors in the body-fixed frame.
 * The state quaternion maps model axes (+Z forward, +Y up) into that frame.
 */
export function computeVectors(state: VesselState): VesselVectors {
  const q = new THREE.Quaternion(state.q.x, state.q.y, state.q.z, state.q.w);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

  const heading = forward
    .clone()
    .addScaledVector(up, -forward.dot(up));
  if (heading.lengthSq() < 1e-10) heading.copy(forward);
  heading.normalize();

  const course = state.velocity ? vector(state.velocity) : new THREE.Vector3();
  if (course.lengthSq() > 1e-10) course.normalize();
  else course.set(0, 0, 0);

  let lift: THREE.Vector3 | null = null;
  if (course.lengthSq() > 1e-10) {
    const projected = up.clone().addScaledVector(course, -up.dot(course));
    if (projected.lengthSq() > 1e-8) lift = projected.normalize();
  }

  return { heading, course, lift };
}

/**
 * Plain tactical rays for one vessel. Directions are body-fixed; the caller
 * positions/orients the group with the current body frame each frame.
 */
export class VectorArrows {
  readonly group = new THREE.Group();
  private readonly heading: VectorRay;
  private readonly course: VectorRay;
  private readonly lift: VectorRay;

  constructor() {
    this.group.name = 'vessel-vectors';
    this.heading = makeRay('#ff9f43');
    this.course = makeRay('#4da3ff');
    this.lift = makeRay('#55d68b');
    this.group.add(this.heading.line, this.course.line, this.lift.line);
    this.group.visible = false;
  }

  update(state: VesselState, visible: boolean, length: number): void {
    this.group.visible = visible;
    if (!visible) return;
    const vectors = computeVectors(state);
    // The state vectors are body-fixed (left-handed in Three.js); the group
    // carries the body-frame rotation, so only the format's Z reflection is
    // applied here.
    const speed = Math.max(state.speed ?? 0, state.surfaceSpeed ?? 0, 0);
    // Tacview: heading/course dominate; the lift ray is intentionally short.
    const speedScale = THREE.MathUtils.clamp(speed / 160, 0.35, 2.5);
    const geeScale = THREE.MathUtils.clamp((state.gee ?? 1) / 12, 0.05, 0.6);
    this.heading.set(vectors.heading, length * speedScale);
    this.course.set(vectors.course, length * speedScale);
    if (vectors.lift) this.lift.set(vectors.lift, length * geeScale);
    else this.lift.hide();
  }

  /** Exposed for tests and for future HUD readouts. */
  rayLengths(): [number, number, number] {
    return [this.heading.length, this.course.length, this.lift.length];
  }

  dispose(): void {
    for (const ray of [this.heading, this.course, this.lift]) {
      ray.line.geometry.dispose();
      ;(ray.line.material as THREE.Material).dispose();
      this.group.remove(ray.line);
    }
  }
}

class VectorRay {
  readonly line: THREE.Line;
  length = 0;

  constructor(color: string) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 }),
    );
    this.line.name = 'vessel-vector';
    this.line.frustumCulled = false;
  }

  set(direction: THREE.Vector3, length: number): void {
    this.length = length;
    this.line.visible = true;
    const attribute = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.setXYZ(0, 0, 0, 0);
    attribute.setXYZ(1, direction.x * length, direction.y * length, -direction.z * length);
    attribute.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  hide(): void {
    this.length = 0;
    this.line.visible = false;
  }
}

function makeRay(color: string): VectorRay {
  return new VectorRay(color);
}
