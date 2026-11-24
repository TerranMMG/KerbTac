import * as THREE from 'three'
import type { Replay, ReplayEvent } from '../format/types'
import { bodyFrameAt } from '../playback/body'
import { latLonAltToBF, type Vec3 } from '../playback/math'
import { bfToRenderWorld } from './renderFrame'

export interface EventMarkers {
  group: THREE.Group
  meshes: THREE.Mesh[]
  dispose(): void
}

const EVENT_COLORS: Record<string, string> = {
  takeoff: '#81c784',
  touchdown: '#4fc3f7',
  landing: '#4fc3f7',
  gear_up: '#90a4ae',
  gear_down: '#90a4ae',
  stage: '#ffb74d',
  engine_ignition: '#ffd54f',
  engine_shutdown: '#a1887f',
  crash: '#ef5350',
  destroyed: '#ef5350',
  soi_change: '#ba68c8',
  note: '#78909c',
  flight_start: '#546e7a',
  flight_end: '#546e7a',
}

const DEFAULT_COLOR = '#b0bec5'

interface EventPosition {
  bodyName: string
  bf: Vec3
}

function eventPosition(replay: Replay, event: ReplayEvent): EventPosition | null {
  if (event.lat === null || event.lon === null) return null
  const vessel = event.vessel ? replay.vessels.find((item) => item.id === event.vessel) : null
  const bodyName = event.body ?? vessel?.body ?? replay.vessels[0]?.body
  if (!bodyName) return null
  const body = replay.bodies.get(bodyName)
  if (!body) return null
  const bf = latLonAltToBF(event.lat, event.lon, event.alt ?? 0, body.radius)
  return { bodyName, bf }
}

export function createEventMarkers(replay: Replay): EventMarkers | null {
  const group = new THREE.Group()
  group.name = 'event-markers'
  const geometry = new THREE.OctahedronGeometry(1, 0)
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  const meshes: THREE.Mesh[] = []

  for (const event of replay.events) {
    const position = eventPosition(replay, event)
    if (!position) continue
    const frame = bodyFrameAt(replay, position.bodyName, event.ut)
    const world = bfToRenderWorld(frame, position.bf)
    const color = EVENT_COLORS[event.type] ?? DEFAULT_COLOR
    let material = materials.get(color)
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
      materials.set(color, material)
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(world.x, world.y, world.z)
    mesh.userData.body = position.bodyName
    mesh.userData.bf = position.bf
    mesh.userData.ut = event.ut
    mesh.userData.eventType = event.type
    group.add(mesh)
    meshes.push(mesh)
  }

  if (meshes.length === 0) {
    geometry.dispose()
    return null
  }

  return {
    group,
    meshes,
    dispose() {
      geometry.dispose()
      for (const material of materials.values()) material.dispose()
      group.remove(...meshes)
    },
  }
}
