import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { CameraRig, radialCameraUp } from '../src/scene/camera';

describe('external camera', () => {
  it('clamps external pitch and never accumulates roll', () => {
    const rig = new CameraRig();
    rig.setMode('external');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.setExternalAngles(0, 120, 500);
    expect(rig.pitchDeg).toBeCloseTo(120, 5);
    expect(rig.camera.position.x).toBeLessThan(600000);
    rig.setExternalAngles(0, 200, 500);
    expect(rig.pitchDeg).toBeLessThanOrEqual(170);
    rig.setExternalAngles(0, -50, 500);
    expect(rig.pitchDeg).toBeGreaterThanOrEqual(1);
    expect(rig.camera.up.length()).toBeCloseTo(1, 5);
  });

  it('orbits around the focus using local up', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.setExternalAngles(0, 30, 500);
    rig.update(0.016);
    expect(rig.camera.position.distanceTo(new Vector3(600000, 0, 0))).toBeCloseTo(500, 3);
    expect(rig.camera.position.x).toBeGreaterThan(600000);
    expect(rig.camera.up.length()).toBeCloseTo(1, 5);
  });

  it('starts free from the current external camera pose', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.setExternalAngles(35, 25, 500);
    const before = rig.camera.position.clone();
    rig.setMode('free');
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(1);
  });

  it('uses radial up for an inverted aircraft camera', () => {
    const up = radialCameraUp(new Vector3(600000, 0, 0));
    expect(up.x).toBeCloseTo(1, 6);
    expect(up.y).toBeCloseTo(0, 6);
    expect(radialCameraUp(new Vector3()).y).toBe(1);
  });

  it('clamps the orbit distance to the supported range', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(), new Vector3(0, 1, 0));
    rig.setExternalAngles(15, 10, 1);
    expect(rig.distance).toBe(60);
    rig.setExternalAngles(15, 10, 2_000_000_000);
    expect(rig.distance).toBe(500_000_000);
  });

  it('frames a high orbit beyond the old two thousand kilometre limit', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(), new Vector3(0, 1, 0));
    rig.frameOn(new Vector3(15_600_000, 0, 0), 15_600_000);
    expect(rig.distance).toBeGreaterThan(15_000_000);
    expect(rig.zoom).toBeGreaterThan(15_000_000);
  });

  it('keeps the external far plane beyond a long orbit', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(), new Vector3(0, 1, 0));
    rig.setExternalAngles(15, 10, 50_000_000);
    const camera = rig.camera as PerspectiveCamera;
    expect(camera.far).toBeGreaterThan(50_000_000);
  });

  it('keeps the external far plane beyond the focused body when zoomed close', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(15_600_000, 0, 0), new Vector3(1, 0, 0));
    rig.setExternalAngles(15, 10, 100_000);
    const camera = rig.camera as PerspectiveCamera;
    // The far plane must also cover the orbit on the opposite side of the body.
    expect(camera.far).toBeGreaterThan(31_000_000);
  });

  it('keeps a valid camera up while yawing without roll', () => {
    const rig = new CameraRig();
    const up = new Vector3(0, 0, 1).normalize();
    rig.setFocus(new Vector3(0, 0, 600000), up);
    for (const yaw of [0, 45, 90, 180, 270]) {
      rig.setExternalAngles(yaw, 30, 1000);
      rig.update(1);
      expect(rig.camera.up.length()).toBeCloseTo(1, 5);
    }
  });

  it('snaps focus immediately when following a moving target', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(0, 0, 600000), new Vector3(0, 0, 1), true);
    rig.setExternalAngles(35, 25, 500);
    rig.setFocus(new Vector3(100, 0, 600000), new Vector3(0, 0, 1), true);
    expect(rig.camera.position.distanceTo(new Vector3(100, 0, 600000))).toBeCloseTo(500, 3);
  });

  it('focusOn moves the orbit centre without changing angles', () => {
    const rig = new CameraRig();
    rig.setFocus(new Vector3(), new Vector3(0, 1, 0));
    rig.setExternalAngles(40, 20, 1000);
    rig.update(1);
    rig.focusOn(new Vector3(100, 0, 0));
    rig.update(1);
    expect(rig.yawDeg).toBeCloseTo(40, 5);
    expect(rig.pitchDeg).toBeCloseTo(20, 5);
  });
});

describe('satellite camera', () => {
  it('satellite camera is orthographic and north-up', () => {
    const rig = new CameraRig();
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(0, 1, 0));
    expect(rig.camera).toBeInstanceOf(OrthographicCamera);
    expect(rig.camera.up.y).toBeCloseTo(1, 5);
    expect(rig.camera.position.clone().sub(new Vector3(600000, 0, 0)).length()).toBeCloseTo(1_000_000, 3);
  });

  it('satellite zoom is the world height of the view', () => {
    const rig = new CameraRig(undefined, 2);
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.zoom = 200_000;
    const camera = rig.camera as OrthographicCamera;
    expect(rig.zoom).toBe(200_000);
    expect(camera.top - camera.bottom).toBeCloseTo(200_000, 3);
    expect(camera.right - camera.left).toBeCloseTo(400_000, 3);
  });

  it('keeps the satellite far plane beyond the zoomed view', () => {
    const rig = new CameraRig(undefined, 2);
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.zoom = 20_000_000;
    const camera = rig.camera as OrthographicCamera;
    expect(camera.far).toBeGreaterThan(1_000_000 + 20_000_000);
  });

  it('keeps the satellite far plane beyond the focused body', () => {
    const rig = new CameraRig(undefined, 2);
    rig.setMode('satellite');
    rig.setFocus(new Vector3(15_600_000, 0, 0), new Vector3(1, 0, 0));
    rig.zoom = 2_000_000;
    const camera = rig.camera as OrthographicCamera;
    expect(camera.far).toBeGreaterThan(15_600_000);
  });

  it('keeps a moving satellite focus centred without easing lag', () => {
    const rig = new CameraRig();
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.zoom = 1000;
    rig.update(0.15);
    const target = new Vector3(600100, 0, 0);
    rig.setFocus(target, new Vector3(1, 0, 0));
    rig.update(0.016);
    expect(rig.camera.position.distanceTo(target)).toBeCloseTo(1_000_000, 0);
  });

  it('pans east when the pointer drags right', () => {
    const rig = new CameraRig();
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.zoom = 1000;
    rig.panSatellitePixels(10, 0, 100);
    expect(rig.camera.position.z).toBeGreaterThan(0);
  });

  it('pans the satellite focus and stops following the selected object', () => {
    const rig = new CameraRig();
    rig.setMode('satellite');
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    rig.panSatellite(5_000, 0);
    const panned = rig.camera.position.clone();
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0));
    expect(rig.camera.position.equals(panned)).toBe(true);
    rig.setFocus(new Vector3(600000, 0, 0), new Vector3(1, 0, 0), true);
    expect(rig.camera.position.equals(panned)).toBe(false);
  });
});

describe('free camera', () => {
  it('free camera moves without roll', () => {
    const rig = new CameraRig();
    rig.setMode('free');
    rig.setFreePose(new Vector3(0, 0, 0), 0, 0);
    rig.moveFree(1, 0, 0, 0.1);
    expect(rig.camera).toBeInstanceOf(PerspectiveCamera);
    expect(rig.camera.position.x).toBeGreaterThan(0);
    expect(rig.camera.up.y).toBeCloseTo(1, 5);
  });

  it('clamps free pitch and keeps local up after moving radially', () => {
    const rig = new CameraRig();
    rig.setMode('free');
    rig.setFreePose(new Vector3(600000, 0, 0), 20, 120);
    expect(rig.pitchDeg).toBe(89);
    rig.moveFree(0, 0, 1, 1);
    expect(rig.camera.position.length()).toBeGreaterThan(600000);
    expect(rig.camera.up.dot(rig.camera.position.clone().normalize())).toBeCloseTo(1, 5);
  });

  it('flies forward along the look direction when pitched down', () => {
    const rig = new CameraRig();
    rig.setMode('free');
    rig.setFreePose(new Vector3(600000, 0, 0), 0, -45);
    const before = rig.camera.position.clone();
    rig.moveFree(1, 0, 0, 1);
    const moved = rig.camera.position.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(100);
    expect(moved.dot(new Vector3(1, 0, 0))).toBeLessThan(0);
  });
});
