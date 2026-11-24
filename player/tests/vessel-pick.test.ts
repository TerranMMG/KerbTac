import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { vesselIdFromObject } from '../src/scene/vesselPick'

describe('vessel picking', () => {
  it('finds the vessel id on a clicked child mesh', () => {
    const marker = new THREE.Group()
    marker.userData.vesselId = 'vessel-7'
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    marker.add(mesh)
    expect(vesselIdFromObject(mesh)).toBe('vessel-7')
  })

  it('returns null when the object has no tagged ancestor', () => {
    expect(vesselIdFromObject(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))).toBeNull()
    expect(vesselIdFromObject(null)).toBeNull()
  })
})
