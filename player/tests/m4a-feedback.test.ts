import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ActorTrack } from '../src/format/types'
import { createActorMarker } from '../src/scene/actors'
import { labelLeader } from '../src/scene/labelLeader'
import { addSelectionOutline } from '../src/scene/outline'
import { createVesselMarker, isDetachedCore } from '../src/scene/vessel'
import { shouldKeepSelection } from '../src/playback/selection'
import { isDebrisVessel } from '../src/format/types'
import { isOccludedBySphere } from '../src/scene/occlusion'

function actor(): ActorTrack {
  return {
    id: 'a1',
    name: 'AIM-120',
    kind: 'weapon/missile',
    side: 'blue',
    parent: 'p1',
    target: 't1',
    weapon: 'AIM-120',
    body: 'Kerbin',
    startUt: 0,
    endUt: 10,
    samples: {},
  } as unknown as ActorTrack
}

describe('M4A playback feedback', () => {
  it('attaches the leader to the nearest label edge', () => {
    const leader = labelLeader(
      { x: 100, y: 100, width: 80, height: 20 },
      { x: 220, y: 150 },
    )
    expect(leader).not.toBeNull()
    expect(leader?.startX).toBe(180)
    expect(leader?.startY).toBe(120)
    expect(leader?.endX).toBe(220)
    expect(leader?.endY).toBe(150)
  })

  it('hides the leader when the model is inside the label', () => {
    const leader = labelLeader(
      { x: 100, y: 100, width: 80, height: 20 },
      { x: 140, y: 110 },
    )
    expect(leader).toBeNull()
  })

  it('builds one merged silhouette instead of one shell per mesh', () => {
    const group = new THREE.Group()
    const left = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    left.position.x = -2
    const right = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    right.position.x = 2
    group.add(left, right)

    addSelectionOutline(group)
    const outlines = group.userData.outlines as THREE.Object3D[]
    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toBeInstanceOf(THREE.Mesh)
    expect((outlines[0] as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('renders weapon models larger than their exported size', () => {
    const marker = createActorMarker(actor())
    const content = marker.children[0] as THREE.Group
    expect(content).toBeInstanceOf(THREE.Group)
    expect(content.scale.x).toBe(8)
  })

  it('keeps an ended weapon selected instead of jumping back to its launcher', () => {
    expect(shouldKeepSelection({ transient: true }, false)).toBe(true)
    expect(shouldKeepSelection({ transient: true }, true)).toBe(true)
    expect(shouldKeepSelection({ transient: false }, false)).toBe(true)
    expect(shouldKeepSelection(null, false)).toBe(false)
  })

  it('detects debris by its name when KSP reports type Base', () => {
    expect(
      isDebrisVessel({ type: 'Base', kind: 'ground/structure', name: 'TGT_Ship Debris' }),
    ).toBe(true)
  })

  it('treats a detached probe core as debris, not a satellite', () => {
    expect(
      isDebrisVessel({
        type: 'Probe',
        kind: 'space/vessel',
        name: 'FT-99/34B Traveller Active_1',
      }),
    ).toBe(true)
    const marker = createVesselMarker(
      0xff0000,
      'Probe',
      'space/vessel',
      'FT-99/34B Traveller Active_1',
    )
    expect(marker.userData.kind).toBe('debris')
  })

  it('hides labels for points behind the planet horizon', () => {
    const camera = { x: 0, y: 0, z: 200 }
    const center = { x: 0, y: 0, z: 0 }
    expect(isOccludedBySphere(camera, { x: 0, y: 0, z: -200 }, center, 100)).toBe(true)
    expect(isOccludedBySphere(camera, { x: 0, y: 0, z: 300 }, center, 100)).toBe(false)
    expect(isOccludedBySphere(camera, { x: 0, y: 0, z: 200 }, center, 100)).toBe(false)
  })

  it('uses the debris preset for a Debris vessel even when kind is unknown', () => {
    const marker = createVesselMarker(0xff0000, 'Debris', 'unknown')
    expect(marker.userData.kind).toBe('debris')
    const named = createVesselMarker(0xff0000, 'Unknown', 'unknown', 'FT-99/34A Traveller Active Debris')
    expect(named.userData.kind).toBe('debris')
  })

  it('detects detached cores that kept the carrier name', () => {
    const vessels = [
      { id: 'plane', name: 'RQ-12 Talon-V', type: 'Plane', partCount: 30, transient: false },
      { id: 'core', name: 'RQ-12 Talon-V', type: 'Probe', partCount: 3, transient: false },
      { id: 'rover', name: 'TGT_Rover', type: 'Base', partCount: 18, transient: false },
      { id: 'rover-core', name: 'TGT_Rover', type: 'Probe', partCount: 7, transient: false },
      { id: 'rover-probe', name: 'TGT_Rover Probe', type: 'Base', partCount: 1, transient: false },
      {
        id: 'plane-core',
        name: 'FT-99/34B Traveller Active_4 Probe',
        type: 'Base',
        partCount: 7,
        transient: false,
      },
      {
        id: 'plane-4',
        name: 'FT-99/34B Traveller Active_4',
        type: 'Plane',
        partCount: 76,
        transient: false,
      },
    ] as const

    expect(isDetachedCore(vessels[1], vessels)).toBe(true)
    expect(isDetachedCore(vessels[3], vessels)).toBe(true)
    expect(isDetachedCore(vessels[4], vessels)).toBe(true)
    expect(isDetachedCore(vessels[5], vessels)).toBe(true)
    expect(isDetachedCore(vessels[0], vessels)).toBe(false)
    expect(isDetachedCore(vessels[6], vessels)).toBe(false)
  })

  it('lets a start-splashed probe use the ship model', () => {
    const marker = createVesselMarker(0xff0000, 'Probe', 'sea/ship', 'TGT_Ship')
    expect(marker.userData.kind).toBe('sea/ship')
    const station = createVesselMarker(0xff0000, 'Station', 'sea/ship', 'Station_1')
    expect(station.userData.kind).toBe('sea/ship')
    expect(isDebrisVessel({ type: 'Station', kind: 'sea/ship', name: 'Station_1' })).toBe(false)
  })

  it('keeps Station One selectable when KSP records the stock localization key', () => {
    expect(isDebrisVessel({ type: 'Station', kind: 'space/vessel', name: '#autoLOC_6002452' })).toBe(false)
  })
})
