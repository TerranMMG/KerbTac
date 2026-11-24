import type * as THREE from 'three'

/**
 * Walk from a raycast hit up through its parents until a vessel marker is
 * found. Child meshes are intentionally not tagged individually so a marker
 * can be rebuilt without losing its identity.
 */
export function vesselIdFromObject(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const id = current.userData?.vesselId
    if (typeof id === 'string' && id.length > 0) return id
    current = current.parent
  }
  return null
}
