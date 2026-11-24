// Spherical geometry for the tactical view. Positions are geographic; ranges
// are great-circle distances on the body surface.

import { DEG, RAD } from './math';

export interface LatLon {
  lat: number;
  lon: number;
  /** Altitude above sea level, metres. Optional: omit for surface points. */
  alt?: number;
}

export interface BearingRange {
  /** Initial great-circle bearing, degrees clockwise from north (0..360). */
  bearingDeg: number;
  rangeKm: number;
}

export function bearingRange(from: LatLon, to: LatLon, bodyRadiusM: number): BearingRange {
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const dLon = (to.lon - from.lon) * DEG;

  const sinDLon = Math.sin(dLon);
  const cosDLon = Math.cos(dLon);
  const y = sinDLon * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * cosDLon;
  let bearingDeg = Math.atan2(y, x) * RAD;
  if (bearingDeg < 0) bearingDeg += 360;
  if (bearingDeg >= 360) bearingDeg -= 360;

  const sinHalfLat = Math.sin((lat2 - lat1) / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const angle = 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
  const meanAltitude = ((from.alt ?? 0) + (to.alt ?? 0)) / 2;
  const rangeKm = (angle * (bodyRadiusM + meanAltitude)) / 1000;

  return { bearingDeg, rangeKm };
}
