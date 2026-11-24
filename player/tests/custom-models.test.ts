import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyModelTransform, loadCustomGeometry, normalizeGeometry } from '../src/scene/customModels'

const obj = 'mtllib ignored.mtl\no one\nv 1 2 3\nv 5 2 3\nv 1 4 3\nf 1 2 3\no two\nv 1 2 5\nf 1 4 2\n'
const stl = `solid triangle
facet normal 0 0 1
outer loop
vertex 1 2 3
vertex 5 2 3
vertex 1 4 3
endloop
endfacet
endsolid triangle`
const targetBox = new THREE.Box3(new THREE.Vector3(-5, -2, -2), new THREE.Vector3(5, 2, 2))

describe('custom model geometry', () => {
  it('combines OBJ meshes without reading the material library', async () => {
    const geometry = await loadCustomGeometry(new File([obj], 'mesh.OBJ'))
    expect(geometry.getAttribute('position').count).toBe(6)
    expect(geometry.getAttribute('color')).toBeUndefined()
  })

  it('loads ASCII STL triangles', async () => {
    const geometry = await loadCustomGeometry(new File([stl], 'mesh.stl'))
    expect(geometry.getAttribute('position').count).toBe(3)
  })

  it('rejects malformed facets even when the aggregate vertex count is divisible by three', async () => {
    const bad = stl.replace('vertex 1 4 3\n', '').replace('endsolid triangle',
      'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nvertex 1 1 0\nendloop\nendfacet\nendsolid triangle')
    await expect(loadCustomGeometry(new File([bad], 'mesh.stl'))).rejects.toThrow(/facet/i)
  })

  it('centers a model and matches the target longest dimension without changing the source', async () => {
    const geometry = await loadCustomGeometry(new File([stl], 'mesh.stl'))
    const normalized = normalizeGeometry(geometry, targetBox)
    expect(normalized.boundingBox?.min.toArray()).toEqual([-5, -2.5, 0])
    expect(normalized.boundingBox?.max.toArray()).toEqual([5, 2.5, 0])
    expect(geometry.getAttribute('position').getX(0)).toBe(1)
  })

  it('scales and rotates about the local origin before applying scene-unit offsets', async () => {
    const geometry = normalizeGeometry(await loadCustomGeometry(new File([stl], 'mesh.stl')), targetBox)
    const adjusted = applyModelTransform(geometry, {
      vesselId: 'vessel', file: 'mesh.stl', scale: 2, rotation: [0, 0, 90], offset: [1, 2, 3],
    })
    const p = adjusted.getAttribute('position')
    expect(p.getX(0)).toBeCloseTo(6)
    expect(p.getY(0)).toBeCloseTo(-8)
    expect(p.getZ(0)).toBeCloseTo(3)
    expect(geometry.getAttribute('position').getX(0)).toBe(-5)
  })

  it('rejects unsupported formats', async () => {
    await expect(loadCustomGeometry(new File([obj], 'mesh.ply'))).rejects.toThrow(/OBJ or STL/)
  })

  it('rejects files larger than 50 MiB before reading them', async () => {
    const file = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'mesh.obj')
    await expect(loadCustomGeometry(file)).rejects.toThrow(/50 MB/)
  })

  it.each([
    ['point-only OBJ', 'v 0 0 0\np 1\n', 'mesh.obj'],
    ['collapsed OBJ', 'v 0 0 0\nv 0 0 0\nv 0 0 0\nf 1 2 3\n', 'mesh.obj'],
    ['non-finite OBJ', 'v 0 0 0\nv 1e99 0 0\nv 0 1 0\nf 1 2 3\n', 'mesh.obj'],
    ['corrupt STL', 'not an STL', 'mesh.stl'],
  ])('rejects %s', async (_name, text, filename) => {
    await expect(loadCustomGeometry(new File([text], filename))).rejects.toThrow()
  })
})
