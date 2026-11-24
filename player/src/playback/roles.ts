import type { VesselTrack } from '../format/types'

/**
 * A stage that is still attached has no visible parent yet: before its
 * `separatedUt` the original launch stack must render as one rocket, not as a
 * child stage with a future separation time.
 */
export function parentAt(vessel: VesselTrack, ut: number): string | null {
  if (vessel.separatedUt !== null && vessel.separatedUt !== undefined && ut < vessel.separatedUt) {
    return null
  }
  return vessel.parentId ?? null
}

/** Model role before separation is the whole launch stack. */
export function stackEndUt(vessels: VesselTrack[], vessel: VesselTrack): number | null {
  if (vessel.role !== 'payload') return null
  let end: number | null = null
  let upperEnd: number | null = null
  for (const child of vessels) {
    if (child.parentId !== vessel.id || child.separatedUt == null || child.role === 'fairing') {
      continue
    }
    end = end === null ? child.separatedUt : Math.max(end, child.separatedUt)
    if (child.role === 'stage.upper') {
      upperEnd = upperEnd === null ? child.separatedUt : Math.max(upperEnd, child.separatedUt)
    }
  }
  return upperEnd ?? end
}

export function modelRoleAt(
  vessel: VesselTrack,
  ut: number,
  stackEnd: number | null = null,
): string | null {
  if (
    vessel.separatedUt !== null &&
    vessel.separatedUt !== undefined &&
    ut < vessel.separatedUt &&
    vessel.parentId
  ) {
    return 'space.rocket'
  }
  // A released satellite/probe is not a rocket; let the VesselType preset
  // (satellite/probe) draw it instead of the generic two-stage rocket.
  if (
    vessel.role === 'payload' &&
    (vessel.type === 'Probe' || vessel.type === 'Relay' || vessel.type === 'Station')
  ) {
    // The payload stays a launch stack until the recorded stage releases it.
    if (stackEnd !== null && ut < stackEnd) return 'space.rocket'
    return null
  }
  return vessel.modelRole ?? null
}

/** Payloads are renamed "... Debris" when they crash; hide that suffix. */
export function displayVesselName(vessel: VesselTrack): string {
  if (vessel.role === 'payload') {
    return vessel.name.replace(/\s+Debris$/i, '')
  }
  return vessel.name
}
