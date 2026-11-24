import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ActorTrack, EffectEvent } from '../src/format/types'
import { createActorMarker } from '../src/scene/actors'
import { seededParticles } from '../src/scene/effects'
import { buildLockSegment } from '../src/scene/locks'

function effect(overrides: Partial<EffectEvent> = {}): EffectEvent {
  return {
    ut: 100,
    kind: 'chaff',
    body: 'Kerbin',
    lat: 0,
    lon: 0,
    alt: 1000,
    count: 8,
    seed: 42,
    life: 4,
    source: 'blue',
    target: null,
    vx: 0,
    vy: 0,
    vz: 0,
    spread: 10,
    ...overrides,
  }
}

describe('effects, locks and actors', () => {
  it('seeded particles are deterministic', () => {
    const e = effect()
    const a = seededParticles(e)
    const b = seededParticles(e)
    expect(a).toHaveLength(8)
    expect(a[0].x).toBeCloseTo(b[0].x, 6)
    expect(a[0].y).toBeCloseTo(b[0].y, 6)
    expect(a[0].z).toBeCloseTo(b[0].z, 6)
  })

  it('different seeds produce different particles', () => {
    const a = seededParticles(effect({ seed: 1 }))
    const b = seededParticles(effect({ seed: 2 }))
    expect(a[0].x).not.toBeCloseTo(b[0].x, 6)
  })

  it('clamps the particle count to the protocol limit', () => {
    expect(seededParticles(effect({ count: 0 }))).toHaveLength(1)
    expect(seededParticles(effect({ count: 5000 }))).toHaveLength(512)
  })

  it('lock segment connects source and target', () => {
    const [a, b] = buildLockSegment(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))
    expect(a).toEqual(new THREE.Vector3(0, 0, 0))
    expect(b).toEqual(new THREE.Vector3(1, 0, 0))
  })

  it('actor markers are compact cones tagged with the actor id', () => {
    const actor = {
      id: 'a1',
      name: 'AIM-120',
      kind: 'weapon/missile',
      side: 'blue',
      parent: 'p1',
      target: 't1',
      weapon: null,
      body: 'Kerbin',
      startUt: 0,
      endUt: 10,
      samples: {},
    } as unknown as ActorTrack
    const marker = createActorMarker(actor)
    expect(marker).toBeInstanceOf(THREE.Object3D)
    expect(marker.userData.actorId).toBe('a1')
    expect(marker.children.length).toBeGreaterThan(0)
  })
})
