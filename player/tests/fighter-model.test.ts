import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSatelliteMarker, createVesselMarker } from '../src/scene/vessel'
import { toRenderPosition, toRenderQuat } from '../src/scene/renderFrame'

describe('procedural vessel models', () => {
  it('builds a fixed-wing jet synchronously with the nose at the render-frame forward end', () => {
    const marker = createVesselMarker(0x4da3ff, 'Plane', 'air/fixed', 'Jet')
    const bounds = new THREE.Box3().setFromObject(marker)
    expect(marker.children.length).toBeGreaterThan(0)
    expect(marker.children.length).toBeLessThanOrEqual(3)
    expect(bounds.min.z).toBeLessThan(-50)
    expect(bounds.max.z).toBeGreaterThan(40)
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(75)
  })

  it('maps the modeled nose to recorded forward under reflected attitude', () => {
    const source = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, -0.35))
    const converted = toRenderQuat(source)
    const expected = toRenderPosition(new THREE.Vector3(0, 0, 1).applyQuaternion(source))
    const actual = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(new THREE.Quaternion(converted.x, converted.y, converted.z, converted.w))
    expect(actual.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z))).toBeLessThan(1e-10)
  })

  it('gives the probe and relay distinct silhouettes', () => {
    const signature = (type: string) => new THREE.Box3()
      .setFromObject(createSatelliteMarker(0x4da3ff, type)).getSize(new THREE.Vector3()).toArray()
    expect(signature('Probe')).not.toEqual(signature('Relay'))
  })

  it('shares procedural geometry between instances but not team materials', () => {
    const a = createVesselMarker(0x4da3ff, 'Plane').children[0] as THREE.Mesh
    const b = createVesselMarker(0xff5f6d, 'Plane').children[0] as THREE.Mesh
    expect(a.geometry).toBe(b.geometry)
    expect(a.material).not.toBe(b.material)
  })
})
