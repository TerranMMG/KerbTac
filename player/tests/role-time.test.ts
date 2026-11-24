import { describe, expect, it } from 'vitest'
import type { VesselTrack } from '../src/format/types'
import { modelRoleAt, parentAt, stackEndUt } from '../src/playback/roles'

function vessel(partial: Partial<VesselTrack>): VesselTrack {
  return {
    id: 'v1',
    name: 'Test',
    type: 'Probe',
    body: 'Kerbin',
    color: '#fff',
    team: null,
    rootPart: null,
    partCount: null,
    crewCount: null,
    side: 'neutral',
    callsign: null,
    kind: 'unknown',
    health: null,
    loadout: [],
    transient: false,
    segments: [],
    ...partial,
  }
}

describe('time-aware roles', () => {
  it('keeps the launch stack through fairing and booster releases in either seek direction', () => {
    const payload = vessel({ role: 'payload', modelRole: 'space.rocket' })
    const vessels = [
      payload,
      vessel({ id: 'fairing', parentId: payload.id, role: 'fairing', separatedUt: 10 }),
      vessel({ id: 'booster', parentId: payload.id, role: 'stage.booster', separatedUt: 20 }),
      vessel({ id: 'upper', parentId: payload.id, role: 'stage.upper', separatedUt: 50 }),
    ]
    const stackEnd = stackEndUt(vessels, payload)
    expect([9, 10, 20, 49, 50, 49, 10, 9].map(ut => modelRoleAt(payload, ut, stackEnd))).toEqual([
      'space.rocket', 'space.rocket', 'space.rocket', 'space.rocket', null,
      'space.rocket', 'space.rocket', 'space.rocket',
    ])
  })

  it('shows the launch stack as a rocket before it separates', () => {
    const v = vessel({
      separatedUt: 470,
      parentId: 'payload',
      role: 'stage.upper',
      modelRole: 'space.stage',
    })
    expect(modelRoleAt(v, 10)).toBe('space.rocket')
    expect(parentAt(v, 10)).toBeNull()
  })

  it('uses the recorded stage role after separation', () => {
    const v = vessel({
      separatedUt: 470,
      parentId: 'payload',
      role: 'stage.upper',
      modelRole: 'space.stage',
    })
    expect(modelRoleAt(v, 480)).toBe('space.stage')
    expect(parentAt(v, 480)).toBe('payload')
  })

  it('leaves vessels without a separation time unchanged', () => {
    const v = vessel({ modelRole: 'space.rocket' })
    expect(modelRoleAt(v, 10)).toBe('space.rocket')
    expect(parentAt(v, 10)).toBeNull()
  })
})
