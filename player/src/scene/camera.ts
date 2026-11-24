// Tacview-style analysis camera. External orbits a focus point around the
// local up vector; Satellite is an orthographic north-up top view; Free is a
// pointer-locked fly camera. Camera roll is never inherited from the target.

import * as THREE from 'three';

export type CameraMode = 'external' | 'satellite' | 'free';

const MIN_DISTANCE = 60;
const MAX_DISTANCE = 500_000_000;
export const MIN_PITCH_DEG = -89;
export const MAX_PITCH_DEG = 89;
/** External orbit stops just short of straight down (0 = overhead). */
const MIN_EXTERNAL_PITCH_DEG = 1;
/** 90 = horizon, >90 = camera below the focus looking up. */
export const MAX_EXTERNAL_PITCH_DEG = 170;
const DEFAULT_YAW_DEG = 35;
const DEFAULT_PITCH_DEG = 25;
const DEFAULT_DISTANCE = 120_000;
const DEFAULT_SATELLITE_SPAN = 500_000;
const MIN_SATELLITE_SPAN = 100;
const MAX_SATELLITE_SPAN = 100_000_000;
const SATELLITE_HEIGHT = 1_000_000;
const FREE_SPEED = 1_000;
const FREE_BOOST = 5;
const FOCUS_TRANSITION_SECONDS = 0.15;

const DEG = Math.PI / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function localUp(position: THREE.Vector3): THREE.Vector3 {
  return position.lengthSq() > 1e-6
    ? position.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
}

/** Up direction of the body surface under a render-space position. */
export function radialCameraUp(position: THREE.Vector3): THREE.Vector3 {
  return localUp(position);
}

function twoTangents(up: THREE.Vector3): { north: THREE.Vector3; east: THREE.Vector3 } {
  // Pick the world-Y tangent as north. At the poles any tangent is valid, so
  // fall back to world Z/X to keep the frame well defined.
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
  if (north.lengthSq() < 1e-8) north.set(0, 0, 1).addScaledVector(up, -up.z);
  if (north.lengthSq() < 1e-8) north.set(1, 0, 0).addScaledVector(up, -up.x);
  north.normalize();
  const east = new THREE.Vector3().crossVectors(up, north).normalize();
  return { north, east };
}

export class CameraRig {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  mode: CameraMode = 'external';

  private aspect: number;
  private yaw = DEFAULT_YAW_DEG * DEG;
  private pitch = DEFAULT_PITCH_DEG * DEG;
  private orbitDistance = DEFAULT_DISTANCE;
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly focusCurrent = new THREE.Vector3();
  private readonly focusTarget = new THREE.Vector3();
  private readonly transitionStart = new THREE.Vector3();
  private transitionElapsed = FOCUS_TRANSITION_SECONDS;
  private hasFocus = false;

  private readonly externalCamera: THREE.PerspectiveCamera;
  private readonly satelliteCamera: THREE.OrthographicCamera;
  private readonly freeCamera: THREE.PerspectiveCamera;
  private satelliteSpan = DEFAULT_SATELLITE_SPAN;
  private readonly freePosition = new THREE.Vector3();
  private readonly freeUp = new THREE.Vector3(0, 1, 0);
  private freeYaw = 0;
  private freePitch = 0;
  /** Called after the user manually pans the satellite map. */
  onSatellitePan: (() => void) | null = null;

  private dragging = false;
  private pointerId: number | null = null;
  private attachedElement: HTMLElement | null = null;
  private readonly listeners = new AbortController();
  private lastX = 0;
  private lastY = 0;
  private manualSatelliteFocus = false;

  constructor(element: HTMLElement | null = null, aspect = 1) {
    this.aspect = Math.max(1e-6, aspect);
    this.externalCamera = new THREE.PerspectiveCamera(50, this.aspect, 1, 3e7);
    this.externalCamera.position.set(60_000, 50_000, 90_000);
    this.externalCamera.up.set(0, 1, 0);
    this.satelliteCamera = new THREE.OrthographicCamera(
      -this.satelliteSpan * this.aspect * 0.5,
      this.satelliteSpan * this.aspect * 0.5,
      this.satelliteSpan * 0.5,
      -this.satelliteSpan * 0.5,
      1,
      3e6,
    );
    this.freeCamera = new THREE.PerspectiveCamera(60, this.aspect, 0.5, 3e7);
    this.freeCamera.up.set(0, 1, 0);
    this.camera = this.externalCamera;
    this.applyActive();
    if (element) {
      this.attachedElement = element;
      this.attach(element);
    }
  }

  setAspect(aspect: number): void {
    this.aspect = Math.max(1e-6, aspect);
    this.externalCamera.aspect = this.aspect;
    this.freeCamera.aspect = this.aspect;
    this.satelliteCamera.left = -this.satelliteSpan * this.aspect * 0.5;
    this.satelliteCamera.right = this.satelliteSpan * this.aspect * 0.5;
    this.externalCamera.updateProjectionMatrix();
    this.freeCamera.updateProjectionMatrix();
    this.satelliteCamera.updateProjectionMatrix();
  }

  get yawDeg(): number {
    const degrees = ((this.mode === 'free' ? this.freeYaw : this.yaw) / DEG) % 360;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  get pitchDeg(): number {
    return (this.mode === 'free' ? this.freePitch : this.pitch) / DEG;
  }

  /**
   * Compass heading of the view axis in the local tangent basis. External
   * yaw is the camera's orbit azimuth (the opposite of its look direction);
   * Free yaw is already the look direction.
   */
  get viewHeadingDeg(): number {
    if (this.mode === 'free') return this.yawDeg;
    return (this.yawDeg + 180) % 360;
  }

  get distance(): number {
    return this.orbitDistance;
  }

  /** Satellite view height in world metres (vertical extent of the screen). */
  get zoom(): number {
    return this.satelliteSpan;
  }

  set zoom(metres: number) {
    this.satelliteSpan = clamp(metres, MIN_SATELLITE_SPAN, MAX_SATELLITE_SPAN);
    if (this.mode === 'satellite') this.applySatellite();
  }

  setMode(mode: CameraMode): void {
    // Switching camera modes must end any in-progress drag, otherwise a lost
    // pointerup can keep applying movement in the new mode.
    this.stopDrag();
    if (mode === this.mode) return;
    const previousCamera = this.camera;
    this.mode = mode;
    this.manualSatelliteFocus = false;
    if (mode === 'external') this.camera = this.externalCamera;
    if (mode === 'satellite') this.camera = this.satelliteCamera;
    if (mode === 'free') {
      this.camera = this.freeCamera;
      // Match the previous view's framing instead of reusing an old free pose
      // or the orthographic camera's million-metre altitude.
      this.freeCamera.fov = this.externalCamera.fov;
      this.freeCamera.updateProjectionMatrix();
      const up = localUp(this.focusCurrent);
      this.freeUp.copy(up);
      if (previousCamera === this.satelliteCamera) {
        const distance =
          (this.satelliteSpan * 0.5) /
          Math.tan((this.freeCamera.fov * Math.PI) / 360);
        this.freePosition.copy(this.focusCurrent).addScaledVector(up, distance);
        this.freeYaw = 0;
        this.freePitch = MIN_PITCH_DEG * DEG;
      } else {
        this.freePosition.copy(previousCamera.position);
        const direction = new THREE.Vector3();
        previousCamera.getWorldDirection(direction);
        const { north, east } = twoTangents(this.freeUp);
        this.freeYaw = Math.atan2(direction.dot(north), direction.dot(east));
        this.freePitch = clamp(Math.asin(clamp(direction.dot(this.freeUp), -1, 1)),
          MIN_PITCH_DEG * DEG, MAX_PITCH_DEG * DEG);
      }
    }
    this.applyActive();
  }

  /** Set the point the camera orbits. The first focus snaps; later moves ease. */
  setFocus(target: THREE.Vector3 | null, up: THREE.Vector3, force = false): void {
    if (this.mode === 'satellite' && this.manualSatelliteFocus && !force) return;
    if (!target) {
      this.hasFocus = false;
      return;
    }
    if (up.lengthSq() > 1e-12) this.upAxis.copy(up).normalize();
    if (force) {
      this.focusCurrent.copy(target);
      this.focusTarget.copy(target);
      this.transitionStart.copy(target);
      this.transitionElapsed = FOCUS_TRANSITION_SECONDS;
      this.hasFocus = true;
      this.manualSatelliteFocus = false;
      this.applyActive();
      return;
    }
    // Satellite auto-follow must stay exactly centred. Playback can move the
    // target by kilometres per frame at 1000x; the 0.15 s focus easing used by
    // External would always lag behind. Manual panning already returned above,
    // so this only applies while the camera is following the selection.
    if (this.mode === 'satellite') {
      this.focusCurrent.copy(target);
      this.focusTarget.copy(target);
      this.transitionStart.copy(target);
      this.transitionElapsed = FOCUS_TRANSITION_SECONDS;
      this.hasFocus = true;
      this.applyActive();
      return;
    }
    if (!this.hasFocus) {
      this.focusCurrent.copy(target);
      this.focusTarget.copy(target);
      this.transitionStart.copy(target);
      this.transitionElapsed = FOCUS_TRANSITION_SECONDS;
      this.hasFocus = true;
      this.applyActive();
      return;
    }
    if (target.distanceToSquared(this.focusTarget) > 1e-8) {
      this.transitionStart.copy(this.focusCurrent);
      this.focusTarget.copy(target);
      this.transitionElapsed = 0;
    }
  }

  setExternalAngles(yawDeg: number, pitchDeg: number, distance?: number): void {
    this.yaw = yawDeg * DEG;
    this.pitch = clamp(pitchDeg, MIN_EXTERNAL_PITCH_DEG, MAX_EXTERNAL_PITCH_DEG) * DEG;
    if (distance !== undefined) {
      this.orbitDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    }
    if (this.mode === 'external') this.applyExternal();
  }

  /** Pan the satellite view from a pointer drag, in CSS pixels. */
  panSatellitePixels(dx: number, dy: number, viewportHeight: number): void {
    if (dx === 0 && dy === 0) return;
    const metresPerPixel = this.satelliteSpan / Math.max(1, viewportHeight);
    this.panSatellite(dx * metresPerPixel, dy * metresPerPixel);
    this.onSatellitePan?.();
  }

  /** Pan the satellite view across the local tangent plane, in metres. */
  panSatellite(eastM: number, northM: number): void {
    this.manualSatelliteFocus = true;
    const { north, east } = twoTangents(localUp(this.focusCurrent));
    this.focusCurrent.addScaledVector(east, eastM).addScaledVector(north, northM);
    this.focusTarget.copy(this.focusCurrent);
    this.transitionStart.copy(this.focusCurrent);
    this.transitionElapsed = FOCUS_TRANSITION_SECONDS;
    this.hasFocus = true;
    if (this.mode === 'satellite') this.applySatellite();
  }

  setFreePose(position: THREE.Vector3, yawDeg: number, pitchDeg: number): void {
    this.freePosition.copy(position);
    this.freeUp.copy(localUp(position));
    this.freeYaw = yawDeg * DEG;
    this.freePitch = clamp(pitchDeg, MIN_PITCH_DEG, MAX_PITCH_DEG) * DEG;
    if (this.mode === 'free') this.applyFree();
  }

  /**
   * Move the free camera along its local axes. `forward`, `right` and `up` are
   * input strengths; `dt` is seconds. Shift boost is applied separately.
   */
  moveFree(forward: number, right: number, up: number, dt: number, boost = false): void {
    const cameraUp = this.freeUp;
    const { north, east } = twoTangents(cameraUp);
    const cosPitch = Math.cos(this.freePitch);
    const forwardDirection = new THREE.Vector3()
      .addScaledVector(east, Math.cos(this.freeYaw) * cosPitch)
      .addScaledVector(north, Math.sin(this.freeYaw) * cosPitch)
      .addScaledVector(cameraUp, Math.sin(this.freePitch));
    const rightDirection = new THREE.Vector3().crossVectors(forwardDirection, cameraUp).normalize();
    const speed = FREE_SPEED * (boost ? FREE_BOOST : 1) * Math.max(0, dt);
    this.freePosition
      .addScaledVector(forwardDirection, forward * speed)
      .addScaledVector(rightDirection, right * speed)
      .addScaledVector(cameraUp, up * speed);
    if (this.mode === 'free') this.applyFree();
  }

  update(dt: number): void {
    if (this.transitionElapsed < FOCUS_TRANSITION_SECONDS) {
      this.transitionElapsed = Math.min(
        FOCUS_TRANSITION_SECONDS,
        this.transitionElapsed + Math.max(0, dt),
      );
      const t = smoothstep(this.transitionElapsed / FOCUS_TRANSITION_SECONDS);
      this.focusCurrent.lerpVectors(this.transitionStart, this.focusTarget, t);
    }
    this.applyActive();
  }

  reset(): void {
    this.yaw = DEFAULT_YAW_DEG * DEG;
    this.pitch = DEFAULT_PITCH_DEG * DEG;
    this.orbitDistance = DEFAULT_DISTANCE;
    this.satelliteSpan = DEFAULT_SATELLITE_SPAN;
    if (this.mode === 'free') {
      this.freePosition.copy(this.focusCurrent).addScaledVector(this.upAxis, 5_000);
      this.freeUp.copy(this.upAxis);
      this.freeYaw = this.yaw;
      this.freePitch = -25 * DEG;
    }
    this.applyActive();
  }

  focusOn(point: THREE.Vector3): void {
    this.manualSatelliteFocus = false;
    this.focusCurrent.copy(point);
    this.focusTarget.copy(point);
    this.transitionStart.copy(point);
    this.transitionElapsed = FOCUS_TRANSITION_SECONDS;
    this.hasFocus = true;
    this.applyActive();
  }

  frameOn(center: THREE.Vector3, radius: number): void {
    this.manualSatelliteFocus = false;
    const up = center.lengthSq() > 1e-6 ? center.clone().normalize() : this.upAxis.clone();
    this.upAxis.copy(up);
    this.focusOn(center);
    this.orbitDistance = clamp(Math.max(radius * 2.8, radius + 100), MIN_DISTANCE, MAX_DISTANCE);
    this.satelliteSpan = clamp(radius * 3, MIN_SATELLITE_SPAN, MAX_SATELLITE_SPAN);
    if (this.mode === 'free') {
      this.freePosition.copy(center).addScaledVector(up, Math.max(radius * 2, 5_000));
      this.freeUp.copy(up);
      this.freePitch = -30 * DEG;
    }
    this.applyActive();
  }

  private applyActive(): void {
    if (this.mode === 'satellite') this.applySatellite();
    else if (this.mode === 'free') this.applyFree();
    else this.applyExternal();
  }

  private applyExternal(): void {
    const up = this.upAxis;
    const { north, east } = twoTangents(up);
    const sinPitch = Math.sin(this.pitch);
    const cosPitch = Math.cos(this.pitch);
    const horizontal = sinPitch * this.orbitDistance;
    const offset = new THREE.Vector3()
      .addScaledVector(up, cosPitch * this.orbitDistance)
      .addScaledVector(north, Math.cos(this.yaw) * horizontal)
      .addScaledVector(east, Math.sin(this.yaw) * horizontal);
    this.externalCamera.position.copy(this.focusCurrent).add(offset);
    // Near a straight-down view the raw local up is almost parallel to the
    // view direction and lookAt can flip. Project it perpendicular first.
    const viewDirection = this.focusCurrent.clone().sub(this.externalCamera.position).normalize();
    const cameraUp = up.clone().addScaledVector(viewDirection, -up.dot(viewDirection));
    if (cameraUp.lengthSq() < 1e-8) cameraUp.copy(north);
    this.externalCamera.up.copy(cameraUp.normalize());
    this.externalCamera.lookAt(this.focusCurrent);
    // High-orbit trails can sit on the far side of the body even when the
    // camera is zoomed close to the focus. Keep the far plane beyond both the
    // orbit and the zoomed-out view instead of stopping at 30,000 km.
    const focusRadius = this.focusCurrent.length();
    this.externalCamera.far = Math.max(
      30_000_000,
      this.orbitDistance * 4,
      focusRadius * 4 + 100_000,
    );
    this.externalCamera.updateProjectionMatrix();
  }

  private applySatellite(): void {
    // The satellite camera sits on the radial through the focus; that is the
    // true local up even when the caller supplied a different frame.
    const up = localUp(this.focusCurrent);
    const north = twoTangents(up).north;
    this.satelliteCamera.position.copy(this.focusCurrent).addScaledVector(up, SATELLITE_HEIGHT);
    this.satelliteCamera.up.copy(north);
    this.satelliteCamera.lookAt(this.focusCurrent);
    this.satelliteCamera.left = -this.satelliteSpan * this.aspect * 0.5;
    this.satelliteCamera.right = this.satelliteSpan * this.aspect * 0.5;
    this.satelliteCamera.top = this.satelliteSpan * 0.5;
    this.satelliteCamera.bottom = -this.satelliteSpan * 0.5;
    this.satelliteCamera.near = 1;
    // A long trail can extend to the far side of the body at high orbit; keep
    // the far plane beyond the focus radius as well as the zoomed-out view.
    const focusRadius = this.focusCurrent.length();
    this.satelliteCamera.far =
      SATELLITE_HEIGHT +
      Math.max(2_000_000, this.satelliteSpan * 2, focusRadius * 4 + 100_000);
    this.satelliteCamera.updateProjectionMatrix();
  }

  private applyFree(): void {
    const up = this.freeUp;
    const { north, east } = twoTangents(up);
    const cosPitch = Math.cos(this.freePitch);
    const direction = new THREE.Vector3()
      .addScaledVector(east, Math.cos(this.freeYaw) * cosPitch)
      .addScaledVector(north, Math.sin(this.freeYaw) * cosPitch)
      .addScaledVector(up, Math.sin(this.freePitch));
    this.freeCamera.position.copy(this.freePosition);
    this.freeCamera.up.copy(up);
    this.freeCamera.lookAt(this.freePosition.clone().add(direction));
  }

  private stopDrag(): void {
    const el = this.attachedElement;
    const id = this.pointerId;
    this.dragging = false;
    this.pointerId = null;
    el?.classList.remove('is-orbiting');
    if (id !== null && el?.hasPointerCapture(id)) el.releasePointerCapture(id);
  }

  dispose(): void {
    this.listeners.abort();
    this.stopDrag();
    this.attachedElement = null;
    this.onSatellitePan = null;
  }

  private attach(element: HTMLElement): void {
    const { signal } = this.listeners;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.dragging) return;
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured; drag still works.
      }
      if (this.mode === 'external') element.classList.add('is-orbiting');
    }, { signal });
    element.addEventListener('pointermove', (event) => {
      if (!this.dragging || event.pointerId !== this.pointerId) return;
      // Browsers can keep delivering pointermove after a lost pointerup (for
      // example when capture is released outside the canvas). A zero button
      // mask is definitive proof the drag has ended.
      if ((event.buttons & 1) === 0) {
        this.stopDrag();
        return;
      }
      if (this.mode === 'free') {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        // Drag look: right drag turns right, matching the cursor direction.
        this.freeYaw += dx * 0.002;
        this.freePitch = clamp(
          this.freePitch - dy * 0.002,
          MIN_PITCH_DEG * DEG,
          MAX_PITCH_DEG * DEG,
        );
        this.applyFree();
        return;
      }
      if (this.mode === 'satellite') {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        // Keep the pan direction consistent with the drag: right drag moves
        // the satellite focus east, so the map slides left under the cursor.
        this.panSatellitePixels(dx, dy, element.clientHeight);
        return;
      }
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      const nextPitch = clamp(
        this.pitchDeg - dy * 0.25,
        MIN_EXTERNAL_PITCH_DEG,
        MAX_EXTERNAL_PITCH_DEG,
      );
      if (dx !== 0 || Math.abs(nextPitch - this.pitchDeg) >= 1e-9) {
        this.setExternalAngles(this.yawDeg - dx * 0.25, nextPitch);
      }
    }, { signal });
    const end = (event: PointerEvent): void => {
      if (event.pointerId === this.pointerId) this.stopDrag();
    };
    element.addEventListener('pointercancel', end, { signal });
    element.addEventListener('lostpointercapture', end, { signal });
    window.addEventListener('pointerup', end, { signal });
    window.addEventListener('blur', () => this.stopDrag(), { signal });
    element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (this.mode === 'satellite') {
          this.zoom = this.satelliteSpan * Math.exp(event.deltaY * 0.0012);
          return;
        }
        if (this.mode === 'free') return;
        const factor = Math.exp(event.deltaY * 0.0012);
        this.orbitDistance = clamp(this.orbitDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
        this.applyExternal();
      },
      { passive: false, signal },
    );
  }
}
