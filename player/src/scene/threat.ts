// Frozen air-defence threat hemispheres (format v1.3 `threat`).
// The recording freezes the radius at the start; the player never grows or
// shrinks the dome as the unit takes damage.

import * as THREE from 'three'

/** Translucent upper hemisphere of `radiusM` metres, or null when disabled. */
export function createThreatDome(radiusM: number, color: number): THREE.Mesh | null {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null

  const geometry = new THREE.SphereGeometry(radiusM, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'threat-dome'
  mesh.userData.threatRadiusM = radiusM
  mesh.renderOrder = -1
  return mesh
}

const localUp = new THREE.Vector3(0, 1, 0)

/** Ground rim in the local XZ plane, with a width measured in scene metres. */
export function createThreatRing(radiusM: number, color: number): THREE.Mesh | null {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null
  const thickness = Math.max(radiusM * 0.0015, 1)
  const geometry = new THREE.RingGeometry(Math.max(0, radiusM - thickness), radiusM, 128)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.name = 'threat-ring'
  ring.userData.threatRadiusM = radiusM
  ring.renderOrder = 1
  return ring
}

export interface ThreatVisual {
  dome: THREE.Mesh
  ring: THREE.Mesh | null
}

export function updateThreatVisual(visual: ThreatVisual, ground: THREE.Vector3, up: THREE.Vector3, visible: boolean): void {
  const { dome, ring } = visual
  dome.visible = visible
  dome.position.copy(ground)
  dome.quaternion.setFromUnitVectors(localUp, up)
  if (ring) {
    ring.visible = visible
    ring.position.copy(ground).addScaledVector(up, 1.5)
    ring.quaternion.copy(dome.quaternion)
  }
}
