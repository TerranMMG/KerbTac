import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createThreatDome } from '../src/scene/threat'

describe('threat dome', () => {
  it('builds a translucent hemisphere at the frozen radius', () => {
    const dome = createThreatDome(12000, 0xff5f6d)
    expect(dome).not.toBeNull()
    const mesh = dome as THREE.Mesh
    const sphere = mesh.geometry as THREE.SphereGeometry
    expect(sphere.parameters.radius).toBeCloseTo(12000, 0)
    expect(sphere.parameters.thetaLength).toBeCloseTo(Math.PI / 2, 6)
    const material = mesh.material as THREE.MeshBasicMaterial
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeGreaterThan(0)
    expect(material.opacity).toBeLessThan(0.5)
    expect((material.color as THREE.Color).getHex()).toBe(0xff5f6d)
  })

  it('omits zero and negative ranges', () => {
    expect(createThreatDome(0, 0xffffff)).toBeNull()
    expect(createThreatDome(-5, 0xffffff)).toBeNull()
  })
})
