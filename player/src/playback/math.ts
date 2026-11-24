// Small double-precision vector/quaternion toolkit for playback math.
// Kept dependency-free (no Three.js) so it can be unit tested in Node.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-12 ? scale(a, 1 / len) : vec3(0, 0, 0);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function lerpNum(a: number | null, b: number | null, t: number): number | null {
  if (a === null || b === null) return t < 0.5 ? a : b;
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function wrapLongitude(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Interpolate longitude along the shortest arc across the antimeridian. */
export function lerpLongitude(a: number, b: number, t: number): number {
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return wrapLongitude(a + delta * t);
}

// ---------------------------------------------------------------------------
// Quaternions (x, y, z, w), right-handed, active rotations.
// ---------------------------------------------------------------------------

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

export function quatFromArray(arr: ArrayLike<number>, offset = 0): Quat {
  return {
    x: arr[offset] as number,
    y: arr[offset + 1] as number,
    z: arr[offset + 2] as number,
    w: arr[offset + 3] as number,
  };
}

export function quatLength(q: Quat): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

export function normalizeQuat(q: Quat): Quat {
  const len = quatLength(q);
  if (!(len > 1e-12)) return { ...IDENTITY };
  const inv = 1 / len;
  return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2 * q.xyz x (q.xyz x v + q.w * v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function quatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const n = normalize(axis);
  if (length(n) < 1e-12) return { ...IDENTITY };
  const half = radians * 0.5;
  const s = Math.sin(half);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(half) };
}

/** Shortest-arc spherical interpolation. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return normalizeQuat({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const theta = Math.acos(clamp(cos, -1, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return {
    x: a.x * wa + bx * wb,
    y: a.y * wa + by * wb,
    z: a.z * wa + bz * wb,
    w: a.w * wa + bw * wb,
  };
}

/**
 * Convert latitude/longitude/altitude into the body-fixed Cartesian frame
 * defined by docs/format-v1.md §4.1 (+Y north, lon 0 at +X, lon 90E at +Z).
 */
export function latLonAltToBF(latDeg: number, lonDeg: number, alt: number, radius: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const r = radius + alt;
  const cosLat = Math.cos(lat);
  return {
    x: r * cosLat * Math.cos(lon),
    y: r * Math.sin(lat),
    z: r * cosLat * Math.sin(lon),
  };
}

/**
 * Visual altitude above the rendered sea-level sphere. Kerbin's terrain has
 * relief but the map sphere does not, so a vessel at ASL 70 m with AGL 2 m
 * would otherwise float 68 m above the ground texture. AGL is the correct
 * height to use for placement; old files without AGL fall back to ASL.
 */
export function renderAltitude(alt: number, agl: number | null | undefined): number {
  // Below sea level the recorded ASL is authoritative; AGL is clamped at 0
  // and would otherwise lift underwater debris back to the surface.
  if (alt < 0) return alt;
  return agl != null && Number.isFinite(agl) ? Math.max(0, agl) : alt;
}

export function bfToLatLon(pos: Vec3, radius: number): { lat: number; lon: number; alt: number } {
  const r = length(pos);
  return {
    lat: Math.asin(clamp(pos.y / r, -1, 1)) * RAD,
    lon: Math.atan2(pos.z, pos.x) * RAD,
    alt: r - radius,
  };
}

/** True heading of a body-fixed direction at a given location, degrees clockwise from north. */
export function headingOf(direction: Vec3, latDeg: number, lonDeg: number): number {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const north = vec3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon));
  const east = vec3(-Math.sin(lon), 0, Math.cos(lon));
  const h = Math.atan2(dot(direction, east), dot(direction, north)) * RAD;
  return (h + 360) % 360;
}
