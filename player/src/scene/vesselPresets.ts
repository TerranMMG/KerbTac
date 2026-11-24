import type * as THREE from 'three'
import { makeVesselVariant, type ProceduralVessel } from './proceduralVessels'

const presets = new Map<string, ProceduralVessel>([
  ['air/fighter', 'fighter'], ['air/fixed', 'fighter'], ['air/fixedwing', 'fighter'], ['air/rotary', 'rotary'],
  ['ground/vehicle', 'rover'], ['ground/structure', 'base'], ['sea/ship', 'ship'],
  ['space/vessel', 'craft'], ['debris', 'debris'], ['eva', 'eva'],
])

export function createPresetMarker(kind: string | null | undefined, material: THREE.Material): THREE.Group | null {
  const variant = kind ? presets.get(kind) : undefined
  if (!variant) return null
  const group = makeVesselVariant(variant, material)
  group.userData.kind = kind
  return group
}
