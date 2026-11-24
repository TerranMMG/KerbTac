import * as THREE from 'three'
import type { EffectEvent } from '../format/types'

/** Small deterministic PRNG; the same seed produces the same cloud on every replay. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Unit direction per particle. Positions are expanded by age × spread at draw
 * time, so a burst needs one geometry for its whole lifetime.
 */
export function seededParticles(effect: EffectEvent): THREE.Vector3[] {
  const count = Math.max(1, Math.min(512, Math.floor(effect.count) || 1))
  const random = mulberry32(effect.seed)
  const particles: THREE.Vector3[] = []
  for (let i = 0; i < count; i += 1) {
    const y = random() * 2 - 1
    const theta = random() * Math.PI * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const speed = 0.45 + random() * 0.55
    particles.push(
      new THREE.Vector3(radius * Math.cos(theta) * speed, y * speed, radius * Math.sin(theta) * speed),
    )
  }
  return particles
}

export interface EffectProfile {
  color: number
  opacity: number
  size: number
  drag: number
  gravity: number
  lift: number
  additive: boolean
  flicker: number
}

/**
 * Per-kind appearance and motion. Chaff is light and drags quickly; flares
 * burn hot and fall slowly; smoke rises; explosions throw a short-lived
 * fireball and a slower smoke cloud.
 */
export function effectProfile(kind: string): EffectProfile {
  switch (kind) {
    case 'chaff':
      return {
        color: 0xd7dee8,
        opacity: 0.85,
        size: 0.9,
        drag: 2.8,
        gravity: 4.0,
        lift: 0,
        additive: false,
        flicker: 0,
      }
    case 'flare':
      return {
        color: 0xffb04a,
        opacity: 1.0,
        size: 1.1,
        drag: 1.2,
        gravity: 3.0,
        lift: 0,
        additive: true,
        flicker: 0.35,
      }
    case 'smoke':
      return {
        color: 0x87909c,
        opacity: 0.55,
        size: 3.0,
        drag: 1.6,
        gravity: 0.4,
        lift: 2.2,
        additive: false,
        flicker: 0,
      }
    case 'explosion':
      return {
        color: 0xff8a3d,
        opacity: 1.0,
        size: 3.6,
        drag: 2.2,
        gravity: 5.0,
        lift: 0.8,
        additive: true,
        flicker: 0.55,
      }
    case 'shrapnel':
      return {
        color: 0xffc46b,
        opacity: 1.0,
        size: 1.0,
        drag: 0.35,
        gravity: 9.8,
        lift: 0,
        additive: true,
        flicker: 0.2,
      }
    case 'bubble':
      return {
        color: 0x9fd8ff,
        opacity: 0.5,
        size: 3.2,
        drag: 2.0,
        gravity: -0.5,
        lift: 0,
        additive: false,
        flicker: 0,
      }
    case 'decoy':
      return {
        color: 0xffd27a,
        opacity: 0.85,
        size: 2.2,
        drag: 1.4,
        gravity: 2.0,
        lift: 0,
        additive: true,
        flicker: 0.2,
      }
    default:
      return {
        color: 0xff9f43,
        opacity: 0.9,
        size: 2.0,
        drag: 1.8,
        gravity: 6.0,
        lift: 0,
        additive: false,
        flicker: 0,
      }
  }
}

/**
 * Point size for a countermeasure square. Perspective views use world units
 * (size attenuation converts them to screen pixels); the orthographic
 * satellite view consumes pixels directly.
 */
export function effectPointSize(
  distance: number,
  profile: EffectProfile,
  satelliteSpan?: number,
  viewportHeight?: number,
): number {
  if (satelliteSpan !== undefined && satelliteSpan > 0) {
    if (viewportHeight !== undefined && viewportHeight > 0) {
      // Satellite is orthographic: PointsMaterial.size is in pixels. Convert
      // the zoom span to the equivalent external perspective distance and run
      // the exact same distance/clamp formula, then convert that world size
      // back to pixels. This makes the countermeasure grow and shrink with
      // zoom exactly like the external camera instead of staying fixed.
      const equivalentDistance =
        satelliteSpan / (2 * Math.tan((50 * Math.PI) / 360))
      const worldSize = THREE.MathUtils.clamp(
        equivalentDistance * 0.003 * profile.size,
        1.5,
        80,
      )
      const pixels = (worldSize * viewportHeight) / satelliteSpan
      return THREE.MathUtils.clamp(pixels, 0.1, 40)
    }
    return THREE.MathUtils.clamp(profile.size * 2.2, 0.1, 12)
  }
  return THREE.MathUtils.clamp(distance * 0.003 * profile.size, 1.5, 80)
}

export function createEffectBurst(effect: EffectEvent): THREE.Points {
  const particles = seededParticles(effect)
  const positions = new Float32Array(particles.length * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const profile = effectProfile(effect.kind)
  const material = new THREE.PointsMaterial({
    color: profile.color,
    size: 240,
    sizeAttenuation: true,
    transparent: true,
    opacity: profile.opacity,
    depthWrite: false,
    blending: profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.name = `effect-${effect.kind}`
  points.frustumCulled = false
  points.visible = false
  points.userData.seeds = particles
  points.userData.profile = profile
  return points
}

/**
 * Integrates a burst in body-fixed space and writes local offsets into the
 * geometry. The Points object itself sits at the burst origin with the body
 * rotation, so the offsets need no per-particle world transform.
 */
export function updateEffectBurst(
  effect: EffectEvent,
  points: THREE.Points,
  age: number,
  originBf: { x: number; y: number; z: number },
  gravity: number,
  quality: 'low' | 'medium' | 'high',
): void {
  const seeds = points.userData.seeds as THREE.Vector3[] | undefined
  if (!seeds || seeds.length === 0) {
    return
  }

  const profile = (points.userData.profile as EffectProfile | undefined) ?? effectProfile(effect.kind)
  const limit = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512
  const count = Math.min(seeds.length, limit)
  const attribute = points.geometry.getAttribute('position') as THREE.BufferAttribute
  const array = attribute.array as Float32Array

  const upLength = Math.hypot(originBf.x, originBf.y, originBf.z) || 1
  const upX = originBf.x / upLength
  const upY = originBf.y / upLength
  const upZ = -originBf.z / upLength

  const drag = Math.max(0.0001, profile.drag)
  const decay = (1 - Math.exp(-drag * age)) / drag
  const fall = gravity * (profile.gravity / 9.80665) * 0.5 * age * age
  const lift = profile.lift * 0.5 * age * age
  const vertical = lift - fall
  const baseX = effect.vx
  const baseY = effect.vy
  const baseZ = effect.vz
  const spread = Math.max(0, effect.spread)

  for (let i = 0; i < seeds.length; i += 1) {
    if (i >= count) {
      array[i * 3] = 0
      array[i * 3 + 1] = 0
      array[i * 3 + 2] = 0
      continue
    }

    const seed = seeds[i]
    const vx = baseX + seed.x * spread
    const vy = baseY + seed.y * spread
    const vz = baseZ + seed.z * spread
    array[i * 3] = vx * decay + upX * vertical
    array[i * 3 + 1] = vy * decay + upY * vertical
    array[i * 3 + 2] = -(vz * decay + upZ * vertical)
  }

  attribute.needsUpdate = true
  points.visible = true
}
