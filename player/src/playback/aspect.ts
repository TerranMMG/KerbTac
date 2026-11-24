/**
 * Aspect angle is measured from the target's tail:
 * 0° = attacker directly behind (cold), 180° = attacker in front (hot).
 */
export function aspectAngleDeg(
  targetHeadingDeg: number,
  bearingAttackerToTargetDeg: number,
): number {
  const targetToAttacker = (bearingAttackerToTargetDeg + 180) % 360
  const delta = Math.abs(((targetHeadingDeg - targetToAttacker + 540) % 360) - 180)
  return 180 - delta
}

/**
 * Simplified air-combat aspect bands. The standard brevity terms are
 * approximate, so contiguous cut-offs are used to cover every angle:
 * Cold < 60°, Beaming 60–110°, Flanking 110–150°, Hot ≥ 150°.
 */
export function aspectLabel(angleDeg: number): string {
  if (angleDeg >= 150) return 'Hot'
  if (angleDeg >= 110) return 'Flanking'
  if (angleDeg >= 60) return 'Beaming'
  return 'Cold'
}
