import type * as THREE from 'three'
import { makeVesselVariant, type ProceduralVessel } from './proceduralVessels'

const roles = new Map<string, ProceduralVessel>([
  ['ground.radar', 'radar'], ['ground.launcher', 'launcher'], ['ground.sam', 'combined'],
  ['ground.vehicle', 'rover'],
  ['space.rocket', 'rocket'], ['space.stage', 'stage'], ['space.fairing', 'fairing'],
])

export function createRoleMarker(role: string, material: THREE.Material): THREE.Group | null {
  const variant = roles.get(role)
  if (!variant) return null
  const group = makeVesselVariant(variant, material)
  group.userData.role = role
  return group
}
