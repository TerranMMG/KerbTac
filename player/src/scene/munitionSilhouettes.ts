// Original exaggerated, normalized 3D symbols for the replay viewer.
// These dimensions describe scene graphics, not physical hardware.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { accent, box, hull, modelGroup, tube, wing } from './proceduralVessels'

interface Silhouette {
  profile: number[][]
  sides?: number
  rings?: [number, number, number, number?][]
  marks?: [number, number[][]][]
  pads?: [number, number, number, number, number, number][]
}

const shapes: Readonly<Partial<Record<string, Silhouette>>> = {
  'bahaaim120': {profile:[[-47,.3],[-35,4],[38,4],[47,3]],marks:[[4,[[3,-18],[11,-11],[9,-5],[3,-4]]],[4,[[3,28],[12,34],[12,42],[3,43]]]]},
  'amraam_emp': {profile:[[-43,1],[-29,5],[36,5],[43,3]],rings:[[-8,10,5],[2,9,5]],marks:[[4,[[4,25],[10,35],[5,39],[4,39]]]]},
  'bahaaim9': {profile:[[-50,2],[-44,3],[42,3],[49,2]],marks:[[4,[[2,-40],[10,-31],[7,-22],[2,-24]]],[4,[[2,30],[7,37],[8,45],[2,46]]]]},
  'bahaagm86b': {profile:[[-43,1,1],[-31,8,5],[35,8,5],[45,4,3]],marks:[[2,[[4,-8],[26,4],[25,12],[5,10]]]],pads:[[4,10,19,0,6,32]]},
  'bahaagm-65': {profile:[[-35,7],[-25,10],[19,8],[35,5]],marks:[[4,[[6,-2],[18,17],[17,23],[6,25]]]]},
  'bahaagm-114': {sides:6,profile:[[-35,1],[-25,6],[30,6],[37,4]],marks:[[4,[[4,15],[13,22],[13,31],[4,32]]]]},
  'hellfireemp': {sides:6,profile:[[-34,4],[-25,8],[-7,6],[29,6],[35,4]],rings:[[-19,11,8,6]],marks:[[3,[[4,13],[13,21],[11,27],[4,29]]]]},
  'bahaharm': {sides:4,profile:[[-48,.5],[-30,6],[36,6],[48,4]],marks:[[4,[[3,-20],[13,-1],[11,10],[3,15]]]]},
  'bahapac-3': {profile:[[-54,.4],[-36,5],[45,5],[55,3]],rings:[[-30,6,3]],marks:[[3,[[3,40],[11,47],[6,53],[3,53]]]]},
  'bahaair-2': {profile:[[-30,1],[-18,10],[16,10],[30,7]],marks:[[4,[[7,5],[19,10],[20,23],[7,24]]]]},
  'bahahekv1': {sides:6,profile:[[-36,2],[-28,8],[-14,8],[12,4],[36,5]],rings:[[5,11,6,6]],marks:[[3,[[4,15],[9,25],[6,31],[4,32]]]]},
  'bahakkv': {sides:6,profile:[[-25,3],[-17,12],[10,10],[27,5]],rings:[[-3,14,8,6]],pads:[[9,6,12,0,11,0],[8,5,12,-10,-4,0],[8,5,12,10,-4,0]]},
  'baharbs-15alcruise': {profile:[[-44,1,1],[-24,9,8],[33,9,8],[42,5,5]],marks:[[2,[[5,-4],[15,5],[16,14],[5,12]]],[2,[[5,19],[13,27],[11,32],[5,32]]]],pads:[[5,8,12,0,8,31]]},
  'bahatowmissile': {profile:[[-31,6],[-23,7],[25,7],[34,5]],rings:[[13,9,4],[24,9,4]],marks:[[3,[[5,-15],[10,-10],[9,-2],[5,-2]]]]},
  'bahaclusterbomb': {sides:8,profile:[[-33,3],[-20,12],[20,12],[33,7]],rings:[[26,9,7,8]],pads:[[8,5,28,0,11,0]]},
  'bahajdammk83': {profile:[[-41,.5],[-24,11],[9,12],[22,8],[40,5]],rings:[[29,10,11,4]],marks:[[4,[[6,22],[15,32],[14,39],[6,39]]]]},
  'bahamk82bomb': {profile:[[-40,.5],[-29,7],[-13,11],[11,9],[23,5],[39,3]],marks:[[4,[[2,22],[10,30],[9,38],[2,38]]]]},
  'bahamk82bombbrake': {profile:[[-33,.5],[-23,8],[-7,10],[13,7],[32,4]],marks:[[4,[[3,5],[18,19],[18,29],[3,31]]]]},
  'stingraybdtorpedo': {profile:[[-47,4],[-40,9],[24,9],[38,5],[44,3]],rings:[[35,6,3]],marks:[[5,[[3,29],[11,37],[10,42],[3,42]]]]},
}

export function createMunitionSilhouette(key: string): THREE.BufferGeometry | null {
  const recipe = Object.hasOwn(shapes, key) ? shapes[key] : undefined
  if (!recipe) return null
  const material = new THREE.MeshBasicMaterial()
  const group = modelGroup(material)
  hull(group, recipe.profile.map(([z, r, y = r]) => [z, r, y]), recipe.sides)
  for (const [z, radius, width, sides = 8] of recipe.rings ?? []) {
    tube(group, [0, 0, z - width / 2], [0, 0, z + width / 2], radius, radius, accent, sides)
  }
  for (const [count, outline] of recipe.marks ?? []) {
    const joined = outline.map(([x, z], i) => [i === 0 || i === outline.length - 1 ? x * 0.45 : x, z])
    for (let i = 0; i < count; i++) {
      wing(group, joined, 1.8, -0.9).rotation.z = 2 * Math.PI * i / count
    }
  }
  for (const [w, h, l, x, y, z] of recipe.pads ?? []) box(group, w, h, l, x, y, z, accent)
  group.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  const materials = new Set<THREE.Material>([material])
  for (const object of group.children) {
    const part = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
    materials.add(part.material)
    const vertices = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    vertices.deleteAttribute('uv')
    vertices.applyMatrix4(part.matrixWorld)
    parts.push(vertices)
    if (vertices !== part.geometry) part.geometry.dispose()
  }
  const result = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  for (const item of materials) item.dispose()
  if (result) {
    const symbolScale = 3.6 / 94
    result.scale(symbolScale, symbolScale, symbolScale)
    result.center()
  }
  return result
}
