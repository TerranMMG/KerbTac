import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createThreatDome, createThreatRing, updateThreatVisual } from '../src/scene/threat'

const color = 0xff5f6d

describe('threat circle visuals', () => {
  it('keeps the faction-colored translucent dome', () => {
    const dome = createThreatDome(10_000, color)!
    const material = dome.material as THREE.MeshBasicMaterial
    expect(material.color.getHex()).toBe(color)
    expect(material.opacity).toBe(0.12)
    expect(material.depthWrite).toBe(false)
  })

  it('uses a thin, bright annulus with the recorded radius and color', () => {
    const ring = createThreatRing(10_000, color)!
    expect(ring).toBeInstanceOf(THREE.Mesh)
    expect(ring.geometry).toBeInstanceOf(THREE.RingGeometry)
    expect((ring.geometry as THREE.RingGeometry).parameters).toMatchObject({
      outerRadius: 10_000, innerRadius: 9_985, thetaSegments: 128,
    })
    const material = ring.material as THREE.MeshBasicMaterial
    expect(material.color.getHex()).toBe(color)
    expect(material.opacity).toBeGreaterThanOrEqual(0.85)
    expect(material.depthWrite).toBe(false)
    expect(material.polygonOffset).toBe(true)
  })

  it.each([0, -1, NaN, Infinity])('does not draw an invalid radius (%s)', radius => {
    expect(createThreatDome(radius, color)).toBeNull()
    expect(createThreatRing(radius, color)).toBeNull()
  })

  it('lifts the ring from the ground along local up and toggles both together', () => {
    const dome = createThreatDome(10_000, color)!
    const ring = createThreatRing(10_000, color)!
    const up = new THREE.Vector3(1, 1, 0).normalize()
    const ground = up.clone().multiplyScalar(600_000)
    updateThreatVisual({ dome, ring }, ground, up, true)
    expect(dome.position.distanceTo(ground)).toBe(0)
    expect(ring.position.distanceTo(ground.clone().addScaledVector(up, 1.5))).toBeCloseTo(0)
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(ring.quaternion).distanceTo(up)).toBeCloseTo(0)
    expect(dome.visible && ring.visible).toBe(true)
    updateThreatVisual({ dome, ring }, ground, up, false)
    expect(dome.visible || ring.visible).toBe(false)
  })
})
