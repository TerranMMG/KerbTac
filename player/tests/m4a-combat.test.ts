import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CelestialBodyDef, EffectEvent, ReplayEvent } from '../src/format/types'
import { createActorMarker } from '../src/scene/actors'
import { createEffectBurst, effectPointSize, effectProfile, updateEffectBurst } from '../src/scene/effects'
import {
  createTracerObject,
  tracerBursts,
  updateTracerObject,
} from '../src/scene/tracers'
import { weaponModel, weaponModelKey } from '../src/scene/weaponModels'

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
    source: null,
    target: null,
    vx: 0,
    vy: 0,
    vz: 0,
    spread: 2,
    ...overrides,
  }
}

const kerbin = {
  name: 'Kerbin',
  radius: 600000,
  gravParameter: 3.5316e12,
} as unknown as CelestialBodyDef

function gunfire(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    ut: 100,
    type: 'gunfire',
    vessel: 'v1',
    target: null,
    body: 'Kerbin',
    lat: 0,
    lon: 0,
    alt: 1000,
    source: null,
    weapon: 'M230',
    outcome: 'fired',
    range: null,
    aspect: null,
    damage: null,
    data: {
      rounds: 3,
      speed: 900,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      endUt: 100.1,
    },
    ...overrides,
  }
}

describe('M4A combat visuals', () => {
  it('profiles distinguish chaff, flares, smoke and explosions', () => {
    expect(effectProfile('chaff').additive).toBe(false)
    expect(effectProfile('flare').additive).toBe(true)
    expect(effectProfile('smoke').lift).toBeGreaterThan(0)
    expect(effectProfile('explosion').size).toBeGreaterThan(effectProfile('shrapnel').size)
  })

  it('keeps countermeasure squares small at combat distances', () => {
    expect(effectPointSize(1000, effectProfile('chaff'))).toBeLessThan(6)
    expect(effectPointSize(1000, effectProfile('flare'))).toBeLessThan(8)
    // Satellite view uses the external distance formula at the equivalent
    // perspective distance, so it must change with zoom instead of staying
    // fixed in pixels.
    const far = effectPointSize(1_000_000, effectProfile('chaff'), 500_000, 660)
    const near = effectPointSize(1_000_000, effectProfile('chaff'), 5_000, 660)
    expect(far).toBeLessThan(1)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeCloseTo(1.9, 0)
    expect(effectPointSize(1_000_000, effectProfile('flare'), 5_000, 660)).toBeGreaterThan(near)
  })

  it('integrates body-fixed velocity and gravity', () => {
    const burst = effect({ kind: 'shrapnel', vx: 10, vy: 0, vz: 0, spread: 0, count: 1 })
    const points = createEffectBurst(burst)
    updateEffectBurst(burst, points, 1, { x: 0, y: 600000, z: 0 }, 9.80665, 'high')
    const position = points.geometry.getAttribute('position')
    expect(position.getX(0)).toBeGreaterThan(0)
    expect(position.getY(0)).toBeLessThan(0)
  })

  it('keeps the effect origin and body rotation separate from local offsets', () => {
    const burst = effect({ kind: 'chaff', count: 1, spread: 0, vx: 0, vy: 0, vz: 0 })
    const points = createEffectBurst(burst)
    updateEffectBurst(burst, points, 0, { x: 0, y: 600000, z: 0 }, 9.80665, 'high')
    expect(points.position.length()).toBe(0)
    expect(points.geometry.getAttribute('position').getY(0)).toBeCloseTo(0, 6)
  })

  it('turns gunfire events into tracer bursts', () => {
    const bursts = tracerBursts([gunfire()], new Map([['Kerbin', kerbin]]))
    expect(bursts).toHaveLength(1)
    expect(bursts[0].shots).toBe(3)
    expect(bursts[0].direction.z).toBeCloseTo(-1, 6)
  })

  it('only draws tracers while their shot is in flight', () => {
    const burst = tracerBursts([gunfire()], new Map([['Kerbin', kerbin]]))[0]
    const line = createTracerObject(burst)
    expect(updateTracerObject(burst, line, 99)).toBe(false)
    expect(updateTracerObject(burst, line, 100.1)).toBe(true)
    expect(updateTracerObject(burst, line, 102)).toBe(true)
    expect(updateTracerObject(burst, line, 103)).toBe(false)
  })

  it('turns rocket release events into tracers', () => {
    const rocket = gunfire({
      type: 'weapon_release',
      weapon: 'Hydra70Rocket',
      data: {
        weaponClass: 'weapon/rocket',
        count: 9,
        speed: 700,
        dirX: 0,
        dirY: 0,
        dirZ: -1,
      },
    })
    const bursts = tracerBursts([rocket], new Map([['Kerbin', kerbin]]))
    expect(bursts).toHaveLength(1)
    expect(bursts[0].shots).toBe(9)
  })

  it('maps BDA weapon names to procedural silhouettes', () => {
    expect(weaponModelKey({ name: 'AIM-120 AMRAAM', kind: 'weapon/missile' })).toBe('bahaaim120')
    expect(weaponModelKey({ name: 'AGM-114 Hellfire', kind: 'weapon/missile' })).toBe('bahaagm-114')
    expect(weaponModelKey({ name: 'GBU-38 JDAM', kind: 'weapon/bomb' })).toBe('bahajdammk83')
    expect(weaponModelKey({ name: 'Mk83 JDAM', kind: 'weapon/bomb' })).toBe('bahajdammk83')
    expect(weaponModelKey({ name: 'CBU-87 Cluster Bomb', kind: 'weapon/bomb' })).toBe('bahaclusterbomb')
    expect(weaponModelKey({ name: 'Mk82 SnakeEye', kind: 'weapon/bomb' })).toBe('bahamk82bombbrake')
    expect(weaponModelKey({ name: 'RBS-15AL', kind: 'weapon/missile' })).toBe('baharbs-15alcruise')
    expect(weaponModelKey({ name: 'RBS-15', kind: 'weapon/missile' })).toBe('baharbs-15alcruise')
    expect(weaponModel('baharbs-15cruise')).toBe(weaponModel('baharbs-15alcruise'))
    expect(weaponModelKey({ name: 'unknown', kind: 'weapon/missile' })).toBeNull()
  })

  it('maps the recorded bomb and missile display names to distinct models', () => {
    expect(weaponModelKey({ name: 'CBU-87', kind: 'weapon/bomb' })).toBe('bahaclusterbomb')
    expect(weaponModelKey({ name: 'Mk82 SnakeEye', kind: 'weapon/bomb' })).toBe('bahamk82bombbrake')
    expect(weaponModelKey({ name: 'Mk82', kind: 'weapon/bomb' })).toBe('bahamk82bomb')
    expect(weaponModelKey({ name: 'BGM-71 Tow Missile', kind: 'weapon/missile' })).toBe('bahatowmissile')
    expect(weaponModelKey({ name: 'HARM', kind: 'weapon/missile' })).toBe('bahaharm')
    expect(weaponModelKey({ name: 'HEKV', kind: 'weapon/missile' })).toBe('bahahekv1')
    expect(weaponModelKey({ name: 'KKV', kind: 'weapon/missile' })).toBe('bahakkv')
    expect(weaponModelKey({ name: 'Maverick', kind: 'weapon/missile' })).toBe('bahaagm-65')
    expect(weaponModelKey({ name: 'PAC-3', kind: 'weapon/missile' })).toBe('bahapac-3')
    expect(weaponModelKey({ name: 'RBS-15 Air launched Cruise Missile', kind: 'weapon/missile' })).toBe('baharbs-15alcruise')
    expect(weaponModelKey({ name: 'Stingray', kind: 'weapon/beam' })).toBe('stingraybdtorpedo')
  })

  it('loads multi-mesh white models', () => {
    expect(weaponModel('bahaagm86b')).not.toBeNull()
    expect(weaponModel('bahaclusterbomb')).not.toBeNull()
  })

  it('colors actor models with the launcher side, not the source material', () => {
    const marker = createActorMarker({
      id: 'bomb-1',
      name: 'CBU-87',
      weapon: 'CBU-87',
      kind: 'weapon/bomb',
      side: 'blue',
    })
    let bodyColor: number | null = null
    marker.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || child.name === 'selection-outline') return
      const material = child.material as THREE.MeshStandardMaterial
      if (material.color) bodyColor = material.color.getHex()
    })
    expect(bodyColor).toBe(0x4da3ff)
  })

  it('centers a procedural symbol at its nominal rendering length', () => {
    const geometry = weaponModel('bahaaim120')
    expect(geometry).not.toBeNull()
    geometry?.computeBoundingBox()
    const box = geometry?.boundingBox
    expect(box).toBeTruthy()
    if (!box) return
    expect(box.max.z - box.min.z).toBeCloseTo(3.6, 1)
    expect(Math.abs(box.max.z)).toBeCloseTo(1.8, 1)
    expect(Math.abs(box.min.z)).toBeCloseTo(1.8, 1)
  })

  it('keeps a distinct procedural mesh for every supported label except the shared RBS variants', () => {
    const names = ['AIM-120', 'AMRAAM EMP', 'AIM-9', 'AGM-86', 'AGM-65', 'AGM-114',
      'Hellfire EMP', 'HARM', 'PAC-3', 'AIR-2', 'HEKV', 'KKV', 'RBS-15', 'RBS-15AL',
      'TOW', 'CBU', 'JDAM', 'Mk82', 'Mk82 SnakeEye', 'StingRay']
    const signatures = new Set<string>()
    for (const name of names) {
      const model = weaponModel(weaponModelKey({ name }))
      expect(model, name).not.toBeNull()
      const position = model!.getAttribute('position')
      expect(position.array.every(Number.isFinite), name).toBe(true)
      signatures.add(position.array.toString())
    }
    expect(signatures.size).toBe(19)
  })
})
