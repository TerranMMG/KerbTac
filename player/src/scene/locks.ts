import * as THREE from 'three'

/** Two endpoints for a lock line, copied so callers cannot mutate the inputs. */
export function buildLockSegment(source: THREE.Vector3, target: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  return [source.clone(), target.clone()]
}

/**
 * A lock line is a thin cylinder rather than THREE.Line: WebGL ignores
 * linewidth, and Tacview-style lock lines need to stay visible at range.
 * Colour encodes the side that initiated the lock.
 */
export function createLockLine(color: THREE.ColorRepresentation): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false)
  const line = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  )
  line.name = 'radar-lock'
  line.frustumCulled = false
  line.visible = false
  return line
}

/** Move a lock line to the latest sampled source/target positions. */
export function updateLockLine(
  line: THREE.Mesh,
  source: THREE.Vector3,
  target: THREE.Vector3,
  radius = 4,
  lateralOffset = 0,
): void {
  const [a, b] = buildLockSegment(source, target)
  const direction = b.clone().sub(a)
  const length = direction.length()
  if (length < 1e-6) {
    line.visible = false
    return
  }
  if (lateralOffset !== 0) {
    // Two aircraft locking each other produce coincident lines. Offset each
    // direction a little so both side colours remain visible.
    const sideways = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0))
    if (sideways.lengthSq() < 1e-8) sideways.set(1, 0, 0)
    sideways.normalize().multiplyScalar(lateralOffset)
    a.add(sideways)
    b.add(sideways)
  }
  line.position.copy(a).addScaledVector(direction, 0.5)
  line.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  )
  line.scale.set(radius, length, radius)
}

export function lockColor(side: string | null | undefined): number {
  if (side === 'blue') return 0x4da3ff
  if (side === 'red') return 0xff5f6d
  return 0xc9d4e0
}
