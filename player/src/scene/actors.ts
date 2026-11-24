import * as THREE from 'three'
import type { ActorTrack } from '../format/types'
import { weaponModel, weaponModelKey } from './weaponModels'
import { createPresetMarker } from './vesselPresets'

export function sideColor(side: string | null | undefined): number {
  if (side === 'blue') return 0x4da3ff
  if (side === 'red') return 0xff5f6d
  return 0xc9d4e0
}

interface MissileSpec {
  length: number
  radius: number
  body: string
  nose: string
  boxy: boolean
}

/** Recognise the common BDA missile names and pick proportional geometry. */
function missileSpec(name: string): MissileSpec {
  const value = name.toLowerCase()
  if (value.includes('aim-120') || value.includes('amraam')) {
    return { length: 3.7, radius: 0.11, body: '#e8edf3', nose: '#9aa7b4', boxy: false }
  }
  if (value.includes('aim-9') || value.includes('sidewinder')) {
    return { length: 3.0, radius: 0.13, body: '#eef2f6', nose: '#c0c8d1', boxy: false }
  }
  if (value.includes('jdam') || value.includes('mk83') || value.includes('bomb')) {
    return { length: 3.0, radius: 0.3, body: '#5d6b4d', nose: '#8d9a7b', boxy: true }
  }
  if (value.includes('harm') || value.includes('agm')) {
    return { length: 3.2, radius: 0.15, body: '#d9dee4', nose: '#8f9aa5', boxy: false }
  }
  return { length: 2.8, radius: 0.14, body: '#dfe5eb', nose: '#9aa5b1', boxy: false }
}

/**
 * Missile marker. The nose points along local -Z, matching the procedural
 * aircraft and the render-frame reflection. Distinctive silhouettes make an
 * AIM-120, Sidewinder and JDAM visually distinguishable without loading KSP
 * `.mu` assets at runtime.
 */
export function createActorMarker(
  actor: Pick<ActorTrack, 'id' | 'side'> & {
    name?: string
    weapon?: string | null
    kind?: string | null
  },
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'actor-marker'
  group.userData.actorId = actor.id
  group.userData.kind = actor.kind ?? 'weapon/missile'

  const content = new THREE.Group()
  content.scale.setScalar(8)
  group.add(content)

  const spec = missileSpec(actor.name ?? '')
  const accent = sideColor(actor.side)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent),
    emissive: new THREE.Color(accent).multiplyScalar(0.22),
    metalness: 0.25,
    roughness: 0.6,
  })

  const name = (actor.name ?? '').toLowerCase()
  if (name.includes('debris') || actor.kind === 'debris') {
    const debris = createPresetMarker('debris', bodyMaterial)
    if (debris) {
      content.add(debris)
      return group
    }
  }

  const modelGeometry = weaponModel(
    weaponModelKey({ name: actor.name, weapon: actor.weapon, kind: actor.kind }),
  )
  if (modelGeometry) {
    const model = new THREE.Mesh(modelGeometry, bodyMaterial)
    model.userData.sharedGeometry = true
    content.add(model)
    return group
  }
  const noseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent),
    emissive: new THREE.Color(accent).multiplyScalar(0.22),
    metalness: 0.25,
    roughness: 0.6,
  })
  const finMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: new THREE.Color(accent).multiplyScalar(0.3),
    metalness: 0.3,
    roughness: 0.5,
  })

  const noseLength = spec.length * 0.27
  const bodyLength = spec.length - noseLength
  if (spec.boxy) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(spec.radius * 2, spec.radius * 2.2, bodyLength),
      bodyMaterial,
    )
    body.position.z = noseLength / 2
    content.add(body)
  } else {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.radius, spec.radius, bodyLength, 10),
      bodyMaterial,
    )
    body.rotation.x = Math.PI / 2
    body.position.z = noseLength / 2
    content.add(body)
  }

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(spec.radius, noseLength, 10),
    noseMaterial,
  )
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -spec.length / 2 + noseLength / 2
  content.add(nose)

  const finSpan = spec.radius * 5
  const finThickness = Math.max(0.015, spec.radius * 0.12)
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(finSpan, finThickness, spec.length * 0.18),
      finMaterial,
    )
    fin.position.z = spec.length * 0.38
    fin.rotation.z = angle
    content.add(fin)
  }

  return group
}
