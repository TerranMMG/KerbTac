import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { CelestialBodyDef, ReplayEvent, VesselTrack } from '../format/types'
import { latLonAltToBF, renderAltitude } from '../playback/math'
import { sampleVessel } from '../playback/track'

export interface TracerBurst {
  body: string
  originBf: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
  endDirection: { x: number; y: number; z: number }
  startUt: number
  endUt: number
  shots: number
  speed: number
  color: number
  weaponType: string
  rocket: boolean
}

function numberValue(event: ReplayEvent, key: string, fallback: number): number {
  const value = event.data?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function stringValue(event: ReplayEvent, key: string): string {
  const value = event.data?.[key]
  return typeof value === 'string' ? value : ''
}

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(v.x, v.y, v.z)
  if (length < 1e-9) return { x: 0, y: 0, z: -1 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function cross(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function lerpDirection(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  f: number,
): { x: number; y: number; z: number } {
  return normalize({
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
  })
}

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Converts gunfire events into tracer bursts. */
export function tracerBursts(
  events: ReplayEvent[],
  bodies: Map<string, CelestialBodyDef>,
  vessels: readonly VesselTrack[] = [],
): TracerBurst[] {
  const bursts: TracerBurst[] = []
  for (const event of events) {
    const rocket =
      event.type === 'weapon_release' &&
      stringValue(event, 'weaponClass').includes('rocket')
    if ((event.type !== 'gunfire' && !rocket) || !event.body) continue
    const body = bodies.get(event.body)
    if (!body) continue

    const sourceVessel = event.vessel
      ? vessels.find((item) => item.id === event.vessel)
      : undefined
    const sourceState = sourceVessel
      ? sampleVessel(sourceVessel, event.ut, bodies)
      : null
    const lat = sourceState?.lat ?? event.lat ?? 0
    const lon = sourceState?.lon ?? event.lon ?? 0
    const alt = sourceState
      ? renderAltitude(sourceState.alt, sourceState.agl)
      : event.alt ?? 0

    const dx = numberValue(event, 'dirX', NaN)
    const dy = numberValue(event, 'dirY', NaN)
    const dz = numberValue(event, 'dirZ', NaN)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue
    const direction = normalize({ x: dx, y: dy, z: dz })
    const ex = numberValue(event, 'endDirX', dx)
    const ey = numberValue(event, 'endDirY', dy)
    const ez = numberValue(event, 'endDirZ', dz)
    const endDirection = normalize({ x: ex, y: ey, z: ez })

    const shots = Math.max(
      1,
      Math.min(64, Math.floor(numberValue(event, rocket ? 'count' : 'rounds', 1))),
    )
    const startUt = event.ut
    const endUt = Math.max(startUt, numberValue(event, 'endUt', startUt))
    const speed = Math.max(50, numberValue(event, 'speed', 900))
    const weaponType = stringValue(event, 'weaponType')
    const colorText = stringValue(event, 'tracerColor')
    const color = /^#[0-9a-f]{6}$/i.test(colorText)
      ? parseInt(colorText.slice(1), 16)
      : rocket
        ? 0xffffff
        : weaponType === 'laser'
          ? 0x8fd8ff
          : 0xfff200

    bursts.push({
      body: event.body,
      originBf: latLonAltToBF(lat, lon, alt, body.radius),
      direction,
      endDirection,
      startUt,
      endUt,
      shots,
      speed,
      color,
      weaponType,
      rocket,
    })
  }
  return bursts
}

/**
 * Per-shot directions with a deterministic dispersion cone. Without the
 * spread every round overlapped into one nearly invisible pixel line; the
 * Tacview reference shows a visible stream of parallel yellow tracers.
 */
function shotDirections(burst: TracerBurst): Float32Array {
  const result = new Float32Array(burst.shots * 3)
  const helper =
    Math.abs(burst.direction.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 }
  const side = normalize(cross(burst.direction, helper))
  const up = normalize(cross(side, burst.direction))
  const spread = burst.rocket ? 0.035 : 0.018

  for (let i = 0; i < burst.shots; i += 1) {
    const f = burst.shots > 1 ? i / (burst.shots - 1) : 0.5
    const base = lerpDirection(burst.direction, burst.endDirection, f)
    const angle = spread * (0.25 + 0.75 * hash(i * 3.17 + burst.startUt))
    const azimuth = hash(i * 7.31 + burst.startUt * 0.37) * Math.PI * 2
    const cx = Math.cos(azimuth) * angle
    const cy = Math.sin(azimuth) * angle
    const dir = normalize({
      x: base.x + side.x * cx + up.x * cy,
      y: base.y + side.y * cx + up.y * cy,
      z: base.z + side.z * cx + up.z * cy,
    })
    result[i * 3] = dir.x
    result[i * 3 + 1] = dir.y
    result[i * 3 + 2] = dir.z
  }
  return result
}

export function createTracerObject(burst: TracerBurst): LineSegments2 {
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(new Float32Array(burst.shots * 6))
  const material = new LineMaterial({
    color: burst.color,
    linewidth: burst.rocket ? 2.2 : 1.8,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  })
  material.resolution.set(1600, 900)
  const line = new LineSegments2(geometry, material)
  line.frustumCulled = false
  line.visible = false
  line.name = 'tracers'
  line.userData.shotDirections = shotDirections(burst)
  return line
}

/** Writes the short segments for the current playback time. */
export function updateTracerObject(
  burst: TracerBurst,
  line: LineSegments2,
  ut: number,
  width = 1600,
  height = 900,
): boolean {
  const material = line.material as LineMaterial
  material.resolution.set(Math.max(1, width), Math.max(1, height))

  const attribute = line.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
  const data = attribute.data.array as Float32Array
  const directions = line.userData.shotDirections as Float32Array
  const travel = burst.rocket ? 3.5 : 2.4
  const tailSeconds = burst.rocket ? 0.7 : 0.45
  let visible = false

  for (let i = 0; i < burst.shots; i += 1) {
    const shotUt = burst.shots === 1
      ? burst.startUt
      : burst.startUt + (burst.endUt - burst.startUt) * (i / (burst.shots - 1))
    const age = ut - shotUt
    if (age < 0 || age > travel) {
      for (let k = 0; k < 6; k += 1) data[i * 6 + k] = 0
      continue
    }

    const head = burst.speed * age
    const tail = Math.max(0, head - Math.max(55, burst.speed * tailSeconds))
    const dx = directions[i * 3]
    const dy = directions[i * 3 + 1]
    const dz = directions[i * 3 + 2]
    data[i * 6] = dx * tail
    data[i * 6 + 1] = dy * tail
    data[i * 6 + 2] = -dz * tail
    data[i * 6 + 3] = dx * head
    data[i * 6 + 4] = dy * head
    data[i * 6 + 5] = -dz * head
    visible = true
  }

  attribute.data.needsUpdate = true
  line.visible = visible
  return visible
}
