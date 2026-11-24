import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CustomModelRegistry } from '../src/scene/customModels'
import { setMarkerOpacity } from '../src/scene/outline'
import { createVesselMarker, disposeObject, setVesselMarkerColor } from '../src/scene/vessel'

function binding(vesselId: string) {
  return { vesselId, file: 'mesh.obj', scale: 1, rotation: [0, 0, 0] as const, offset: [0, 0, 0] as const }
}

function marker(registry: CustomModelRegistry, vesselId: string) {
  return createVesselMarker(0x4da3ff, 'Ship', 'space/vessel', 'Vessel', 'space.rocket',
    registry.getCustomModel(vesselId))
}

describe('per-vessel custom models', () => {
  it('only replaces the assigned vessel and returns to the built-in role after reset', () => {
    const registry = new CustomModelRegistry()
    registry.setCustomModel('a', new THREE.BoxGeometry(20, 10, 5), binding('a'))

    expect(marker(registry, 'a').getObjectByName('custom-model')).toBeInstanceOf(THREE.Mesh)
    expect(marker(registry, 'b').userData.role).toBe('space.rocket')
    registry.clearCustomModel('a')
    expect(marker(registry, 'a').userData.role).toBe('space.rocket')
  })

  it('disposes replaced source geometry but not when updating the same model transform', () => {
    const registry = new CustomModelRegistry()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    let disposed = 0
    geometry.addEventListener('dispose', () => disposed++)
    registry.setCustomModel('a', geometry, binding('a'))
    registry.setCustomModel('a', geometry, { ...binding('a'), scale: 2 })
    expect(disposed).toBe(0)
    registry.setCustomModel('a', new THREE.BoxGeometry(2, 2, 2), binding('a'))
    expect(disposed).toBe(1)
  })

  it('shares fitted millimetre geometry and puts manual orientation on just one marker', () => {
    const registry = new CustomModelRegistry()
    const geometry = new THREE.BoxGeometry(4000, 1000, 500)
    registry.setCustomModel('a', geometry, binding('a'))
    registry.setCustomModel('b', geometry, { ...binding('b'), rotation: [0, 90, 0] })

    const a = marker(registry, 'a')
    const b = marker(registry, 'b')
    const aMesh = a.getObjectByName('custom-model') as THREE.Mesh
    const bMesh = b.getObjectByName('custom-model') as THREE.Mesh
    expect(aMesh.geometry).toBe(bMesh.geometry)
    expect(new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).x).toBeCloseTo(120)
    expect(new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3()).z).toBeCloseTo(120)
    expect(bMesh.localToWorld(new THREE.Vector3(60, 0, 0)).z).toBeCloseTo(-60)
    let disposed = 0
    bMesh.geometry.addEventListener('dispose', () => disposed++)

    disposeObject(a)
    registry.clearCustomModel('a')
    expect(disposed).toBe(0)
    disposeObject(b)
    registry.clearCustomModel('b')
    expect(disposed).toBe(1)
  })

  it('isolates model fade and disposal from another marker of the same color', () => {
    const registry = new CustomModelRegistry()
    registry.setCustomModel('a', new THREE.BoxGeometry(1, 1, 1), binding('a'))
    registry.setCustomModel('b', new THREE.BoxGeometry(1, 1, 1), binding('b'))
    const a = marker(registry, 'a')
    const b = marker(registry, 'b')
    const aMesh = a.getObjectByName('custom-model') as THREE.Mesh
    const bMesh = b.getObjectByName('custom-model') as THREE.Mesh
    let sharedDisposed = false
    const onDispose = () => { sharedDisposed = true }
    const bMaterial = bMesh.material as THREE.Material
    bMaterial.addEventListener('dispose', onDispose)
    try {
      expect(aMesh.material).not.toBe(bMesh.material)
      setMarkerOpacity(a, 0.25)
      expect((aMesh.material as THREE.Material).opacity).toBe(0.25)
      expect((bMesh.material as THREE.Material).opacity).toBe(1)
      disposeObject(a)
      expect(sharedDisposed).toBe(false)
    } finally {
      bMaterial.removeEventListener('dispose', onDispose)
      disposeObject(b)
      registry.clear()
    }
  })

  it.each([0x4da3ff, 0xff5f6d, 0xc2cbd4])('uses the vessel display color %i for a custom geometry', color => {
    const registry = new CustomModelRegistry()
    registry.setCustomModel('a', new THREE.BoxGeometry(1, 1, 1), binding('a'))
    const root = createVesselMarker(color, 'Ship', null, 'Vessel', null, registry.getCustomModel('a'))
    const mesh = root.getObjectByName('custom-model') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    expect(mesh.material.color.getHex()).toBe(color)
    disposeObject(root)
    registry.clear()
  })

  it('recolors only the changed vessel after a side switch', () => {
    const registry = new CustomModelRegistry()
    const geometry = new THREE.BoxGeometry(2, 1, 1)
    for (const id of ['a', 'b']) registry.setCustomModel(id, geometry, binding(id))
    const a = marker(registry, 'a')
    const b = marker(registry, 'b')
    setVesselMarkerColor(a, 0xff5f6d)
    const color = (root: THREE.Group) => (root.getObjectByName('custom-model') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.color.getHex()
    expect(color(a)).toBe(0xff5f6d)
    expect(color(b)).toBe(0x4da3ff)
    disposeObject(a)
    disposeObject(b)
    registry.clear()
  })
})
