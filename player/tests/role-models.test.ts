import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createRoleMarker } from '../src/scene/roleModels'
import { makeVesselVariant, type ProceduralVessel } from '../src/scene/proceduralVessels'

const ROLES = [
  'ground.radar',
  'ground.launcher',
  'ground.sam',
  'space.rocket',
  'space.stage',
  'space.fairing',
] as const

describe('role models', () => {
  it('builds a procedural marker for every new role', () => {
    for (const role of ROLES) {
      const marker = createRoleMarker(role, new THREE.MeshBasicMaterial())
      expect(marker, role).not.toBeNull()
      expect(marker?.userData.role).toBe(role)
      expect(marker?.children.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('returns null for roles handled by the existing presets', () => {
    expect(createRoleMarker('air.fighter', new THREE.MeshBasicMaterial())).toBeNull()
  })

  it('keeps the marker length near the 120-unit model convention', () => {
    for (const role of ROLES) {
      const marker = createRoleMarker(role, new THREE.MeshBasicMaterial())
      if (!marker) continue
      const box = new THREE.Box3().setFromObject(marker)
      const size = new THREE.Vector3()
      box.getSize(size)
      const longest = Math.max(size.x, size.y, size.z)
      expect(longest, role).toBeGreaterThan(30)
      expect(longest, role).toBeLessThan(200)
    }
  })

  it('aligns the rocket nose and stage exhaust to the reflected render axes', () => {
    const rocket = createRoleMarker('space.rocket', new THREE.MeshBasicMaterial())!
    const rocketBounds = new THREE.Box3().setFromObject(rocket)
    expect(rocketBounds.min.z).toBeLessThan(-60)
    const front: THREE.Vector3[] = []
    rocket.updateMatrixWorld(true)
    rocket.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const positions = object.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
        if (point.z < -60) front.push(point)
      }
    })
    expect(front.length).toBeGreaterThan(0)
    expect(front.every(point => Math.hypot(point.x, point.y) < 1)).toBe(true)
    const stage = createRoleMarker('space.stage', new THREE.MeshBasicMaterial())!
    const stageBounds = new THREE.Box3().setFromObject(stage)
    expect(stageBounds.max.z).toBeGreaterThan(-stageBounds.min.z)
  })

  it('createVesselMarker prefers a recorded model role', async () => {
    const { createVesselMarker } = await import('../src/scene/vessel')
    const marker = createVesselMarker(0x4da3ff, 'Ship', 'space/vessel', 'Rocket', 'space.rocket')
    expect(marker.userData.role).toBe('space.rocket')
  })

  it('recognizes the fixed-wing kind written by the current recorder', async () => {
    const { createVesselMarker } = await import('../src/scene/vessel')
    const marker = createVesselMarker(0x4da3ff, 'Plane', 'air/fixedwing', 'Aeris 3A', 'air.support')
    expect(marker.userData.kind).toBe('air/fixedwing')
  })

  it('prefers a recorded ground vehicle role over the probe preset', async () => {
    const { createVesselMarker } = await import('../src/scene/vessel')
    const marker = createVesselMarker(0x4da3ff, 'Probe', 'space/vessel', 'Bug-E Buggy', 'ground.vehicle')
    expect(marker.userData.role).toBe('ground.vehicle')
  })

  it('keeps the fixed-base preset for the legacy ground.vehicle role on structures', async () => {
    const { createVesselMarker } = await import('../src/scene/vessel')
    const marker = createVesselMarker(0x4da3ff, 'Base', 'ground/structure', 'Fixed Base', 'ground.vehicle')
    expect(marker.userData.kind).toBe('ground/structure')
  })

  it.each<[string, ProceduralVessel]>([['Base', 'base'], ['Lander', 'craft'], ['Rover', 'rover']])(
    'uses the %s model even when the recorder could not inspect unloaded parts',
    async (type, variant) => {
      const { createVesselMarker } = await import('../src/scene/vessel')
      const model = createVesselMarker(0x4da3ff, type, 'unknown', 'Unloaded vessel', null)
      const expected = makeVesselVariant(variant, new THREE.MeshBasicMaterial())
      const geometries = (group: THREE.Group) => group.children.map(child => (child as THREE.Mesh).geometry)
      expect(geometries(model)).toEqual(geometries(expected))
    },
  )
})
