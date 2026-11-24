import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { MAX_MODEL_BYTES, type ModelBinding } from '../format/models'
import type { VesselTrack } from '../format/types'

export interface CustomModelEntry {
  geometry: THREE.BufferGeometry
  fittedGeometry: THREE.BufferGeometry
  binding: ModelBinding
}

const targetBox = new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60))

export function canCustomizeModel(vessel: VesselTrack): boolean {
  return !vessel.transient && vessel.type.toLowerCase() !== 'debris' && vessel.modelRole !== 'debris'
}

/** Owns one fitted mesh per source; markers own only their transform/material state. */
export class CustomModelRegistry {
  private readonly entries = new Map<string, CustomModelEntry>()
  private readonly fitted = new Map<THREE.BufferGeometry, { geometry: THREE.BufferGeometry; users: number }>()

  setCustomModel(vesselId: string, geometry: THREE.BufferGeometry, binding: ModelBinding): void {
    modelTransform(binding)
    const previous = this.entries.get(vesselId)
    if (previous?.geometry === geometry) {
      this.entries.set(vesselId, { ...previous, binding })
      return
    }
    let fitted = this.fitted.get(geometry)
    if (!fitted) {
      fitted = { geometry: normalizeGeometry(geometry, targetBox), users: 0 }
      this.fitted.set(geometry, fitted)
    }
    fitted.users++
    if (previous) this.clearCustomModel(vesselId)
    this.entries.set(vesselId, { geometry, fittedGeometry: fitted.geometry, binding })
  }

  clearCustomModel(vesselId: string): void {
    const entry = this.entries.get(vesselId)
    if (!entry) return
    this.entries.delete(vesselId)
    const fitted = this.fitted.get(entry.geometry)!
    if (--fitted.users !== 0) return
    this.fitted.delete(entry.geometry)
    fitted.geometry.dispose()
    entry.geometry.dispose()
  }

  getCustomModel(vesselId: string): CustomModelEntry | null {
    return this.entries.get(vesselId) ?? null
  }

  clear(): void {
    for (const id of this.entries.keys()) this.clearCustomModel(id)
  }
}

function modelExtension(name: string): 'obj' | 'stl' {
  const extension = name.split('.').pop()?.toLowerCase()
  if (!name.includes('.') || (extension !== 'obj' && extension !== 'stl')) {
    throw new Error('Choose an OBJ or STL model')
  }
  return extension
}

function checkSize(size: number): void {
  if (size > MAX_MODEL_BYTES) throw new Error('Model exceeds 50 MB')
  if (size === 0) throw new Error('Model is empty')
}

function validateStl(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  if (view.byteLength >= 84 && 84 + 50 * view.getUint32(80, true) === view.byteLength) return view.getUint32(80, true)
  const text = new TextDecoder().decode(buffer)
  if (!text.startsWith('solid')) throw new Error('Invalid STL header or binary length')
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
  const vector = `\\s+${number}\\s+${number}\\s+${number}`
  const facet = new RegExp(`\\s*facet\\s+normal${vector}\\s+outer\\s+loop(?:\\s+vertex${vector}){3}\\s+endloop\\s+endfacet`, 'y')
  let facets = 0
  for (const [, body = ''] of text.matchAll(/\bsolid\b[^\r\n]*(?:\r\n|\r|\n)([\s\S]*?)\bendsolid\b[^\r\n]*/g)) {
    facet.lastIndex = 0
    let end = 0
    while (facet.test(body)) {
      end = facet.lastIndex
      facets++
    }
    if (body.slice(end).trim()) throw new Error('Invalid ASCII STL facet')
  }
  if (!facets) throw new Error('Invalid ASCII STL facet')
  return facets
}

export async function loadCustomGeometry(file: File): Promise<THREE.BufferGeometry> {
  modelExtension(file.name)
  checkSize(file.size)
  return parseCustomGeometry(file.name, await file.arrayBuffer())
}

export function parseCustomGeometry(name: string, bytes: ArrayBuffer | Uint8Array): THREE.BufferGeometry {
  const extension = modelExtension(name)
  checkSize(bytes.byteLength)
  let geometry: THREE.BufferGeometry | null = null
  if (extension === 'stl') {
    const buffer = bytes instanceof Uint8Array
      ? bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : Uint8Array.from(bytes).buffer
      : bytes
    const expectedFaces = validateStl(buffer)
    geometry = new STLLoader().parse(buffer)
    if (geometry.getAttribute('position').count !== expectedFaces * 3) {
      geometry.dispose()
      throw new Error('Invalid STL facet count')
    }
    geometry.deleteAttribute('color')
    geometry.clearGroups()
  } else {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes))
    const meshes: THREE.BufferGeometry[] = []
    const materials = new Set<THREE.Material>()
    group.traverse(child => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material)
      }
      if (child instanceof THREE.Mesh) {
        for (const key of Object.keys(child.geometry.attributes)) {
          if (key !== 'position' && key !== 'normal') child.geometry.deleteAttribute(key)
        }
        meshes.push(child.geometry)
      } else {
        child.geometry.dispose()
      }
    })
    for (const material of materials) material.dispose()
    if (meshes.length === 1) geometry = meshes[0] ?? null
    else if (meshes.length > 1) {
      geometry = mergeGeometries(meshes)
      for (const mesh of meshes) mesh.dispose()
    }
  }

  const position = geometry?.getAttribute('position')
  const normal = geometry?.getAttribute('normal')
  if (!geometry || !position || position.count === 0 || position.count % 3 !== 0 ||
      !position.array.every(Number.isFinite) || !normal?.array.every(Number.isFinite)) {
    geometry?.dispose()
    throw new Error('Model has no valid triangles')
  }
  geometry.computeBoundingBox()
  if (!(longestDimension(geometry.boundingBox!) > 0)) {
    geometry.dispose()
    throw new Error('Model has no measurable extent')
  }
  return geometry
}

function longestDimension(box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z)
}

export function normalizeGeometry(geometry: THREE.BufferGeometry, targetBox: THREE.Box3): THREE.BufferGeometry {
  const result = geometry.clone()
  result.computeBoundingBox()
  const sourceBox = result.boundingBox!
  const size = longestDimension(sourceBox)
  const target = longestDimension(targetBox)
  if (!(size > 0) || !(target > 0) || !Number.isFinite(target / size)) {
    result.dispose()
    throw new Error('Cannot fit model bounds')
  }
  const center = sourceBox.getCenter(new THREE.Vector3())
  const scale = target / size
  // Combine centering and scaling so large source coordinates are only rounded once.
  const fit = new THREE.Matrix4().makeScale(scale, scale, scale)
  fit.setPosition(center.multiplyScalar(-scale))
  return result.applyMatrix4(fit)
}

export function modelTransform(binding: ModelBinding): THREE.Matrix4 {
  // Fitted coordinates are at most 60 per component; rotation can increase a
  // component up to the enclosing sphere radius before scale and translation.
  const maxPosition = Math.hypot(60, 60, 60) * binding.scale + Math.max(...binding.offset.map(Math.abs))
  if (!Number.isFinite(Math.fround(maxPosition))) {
    throw new Error('Model transform exceeds the representable geometry range')
  }
  const [x, y, z] = binding.rotation.map(angle => THREE.MathUtils.degToRad(angle % 360))
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...binding.offset), rotation, new THREE.Vector3().setScalar(binding.scale),
  )
}

export function applyModelTransform(geometry: THREE.BufferGeometry, binding: ModelBinding): THREE.BufferGeometry {
  const result = geometry.clone()
  result.applyMatrix4(modelTransform(binding))
  if (!result.getAttribute('position').array.every(Number.isFinite)) {
    result.dispose()
    throw new Error('Model transform exceeds the representable geometry range')
  }
  return result
}
