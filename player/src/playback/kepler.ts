// Two-body Kepler propagation for sample-less orbit segments (format v1.3).
// Orbital elements are in KSP's Z-up inertial frame. Marked vessel orbits
// use the recorded absolute prime-meridian phase, not the display pose.

import type { CelestialBodyDef, OrbitElements } from '../format/types';
import { bodyRotationAt } from './body';
import { DEG, RAD, quatConjugate, quatRotate, vec3, type Vec3 } from './math';

/** Solves E - e sin E = M with Newton's method (radians). */
export function solveEccentricAnomaly(meanAnomalyRad: number, e: number): number {
  const m = Math.atan2(Math.sin(meanAnomalyRad), Math.cos(meanAnomalyRad));
  const clampedE = Math.min(0.999, Math.max(0, e));
  let E = clampedE < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < 12; i += 1) {
    const f = E - clampedE * Math.sin(E) - m;
    const fp = 1 - clampedE * Math.cos(E);
    if (Math.abs(fp) < 1e-12) break;
    const delta = f / fp;
    E -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return E;
}

/** Body-inertial position from classical elements, metres. */
export function orbitPositionInertial(orbit: OrbitElements, mu: number, ut: number): Vec3 {
  const a = orbit.semiMajorAxis;
  if (!(a > 0) || !(mu > 0)) return vec3();

  const e = Math.min(0.999, Math.max(0, orbit.eccentricity));
  const meanMotion = Math.sqrt(mu / (a * a * a));
  const meanAnomaly = orbit.meanAnomalyDeg * DEG + meanMotion * (ut - orbit.epoch);
  const E = solveEccentricAnomaly(meanAnomaly, e);

  // Perifocal coordinates.
  const px = a * (Math.cos(E) - e);
  const py = a * Math.sqrt(1 - e * e) * Math.sin(E);

  // Rz(argPE) -> Rx(inclination) -> Rz(LAN).
  const argPe = orbit.argPeDeg * DEG;
  const inc = orbit.inclinationDeg * DEG;
  const lan = orbit.lanDeg * DEG;

  const x1 = px * Math.cos(argPe) - py * Math.sin(argPe);
  const y1 = px * Math.sin(argPe) + py * Math.cos(argPe);
  const y2 = y1 * Math.cos(inc);
  const z2 = y1 * Math.sin(inc);

  return vec3(
    x1 * Math.cos(lan) - y2 * Math.sin(lan),
    x1 * Math.sin(lan) + y2 * Math.cos(lan),
    z2,
  );
}

/** Body-fixed position for the given UT, metres from the body centre. */
export function orbitPositionBF(
  orbit: OrbitElements,
  mu: number,
  body: CelestialBodyDef,
  ut: number,
): Vec3 | null {
  const spin = orbit.bfRotation;
  if (spin === null || !Number.isFinite(orbit.semiMajorAxis) || !(orbit.semiMajorAxis > 0)
    || !Number.isFinite(mu) || !(mu > 0)
    || !(orbit.eccentricity >= 0 && orbit.eccentricity <= 0.999)) return null;

  const inertial = orbitPositionInertial(orbit, mu, ut);
  if (spin !== undefined) {
    // KSP's Z-up prime meridian points at +phase from inertial +X. Undo
    // that rotation in the XY plane, then map north to +Y and east to +Z.
    const phase = (spin.angleDeg + spin.rateDegPerSec * (ut - spin.epochUt)) % 360 * DEG;
    if (!Number.isFinite(phase)) return null;
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    return vec3(inertial.x * c + inertial.y * s, inertial.z, inertial.y * c - inertial.x * s);
  }

  // Unmarked legacy orbits can only use this convention when independently
  // consistent with both recorded anchors. It is not an absolute KSP frame.
  const rotation = bodyRotationAt(body, ut);
  return quatRotate(quatConjugate(rotation), vec3(inertial.x, inertial.z, inertial.y));
}

export interface LatLonAlt {
  lat: number;
  lon: number;
  alt: number;
}

/** Converts a body-fixed vector to latitude/longitude/altitude. */
export function bfToLatLonAlt(position: Vec3, bodyRadiusM: number): LatLonAlt {
  const r = Math.hypot(position.x, position.y, position.z);
  if (!(r > 0)) return { lat: 0, lon: 0, alt: -bodyRadiusM };
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, position.y / r))) * RAD,
    lon: Math.atan2(position.z, position.x) * RAD,
    alt: r - bodyRadiusM,
  };
}
