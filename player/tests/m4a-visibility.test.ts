import { describe, expect, it } from 'vitest'
import type { ReplayEvent, TrackSegment, VesselTrack } from '../src/format/types'
import { vesselFirstUt, vesselLastSampleUt, vesselLastUt, vesselTerminalUt } from '../src/playback/track'
import { sideAt } from '../src/playback/selection'

function segment(kind: TrackSegment['kind'], source: TrackSegment['source'], times: number[]): TrackSegment {
  const table = {
    length: times.length,
    t: Float64Array.from(times),
  } as unknown as TrackSegment['samples']
  return {
    index: 0,
    logicalIndex: 0,
    chunkIndex: 0,
    kind,
    body: 'Kerbin',
    startUt: times[0],
    endUt: times[times.length - 1],
    source,
    boundary: false,
    samples: table,
    orbit: null,
  }
}

function vessel(id: string, transient: boolean, segments: TrackSegment[]): VesselTrack {
  return { id, transient, segments } as unknown as VesselTrack
}

function event(overrides: Partial<ReplayEvent>): ReplayEvent {
  return {
    ut: 0,
    type: 'note',
    vessel: null,
    target: null,
    body: null,
    lat: null,
    lon: null,
    alt: null,
    source: null,
    weapon: null,
    outcome: null,
    range: null,
    aspect: null,
    damage: null,
    data: {},
    ...overrides,
  }
}

describe('vessel visibility windows', () => {
  it('uses the first and last sample for a transient bomb', () => {
    const bomb = vessel('bomb', true, [segment('flight', 'loaded', [10, 20])])
    expect(vesselFirstUt(bomb)).toBe(10)
    expect(vesselLastUt(bomb)).toBe(20)
  })

  it('extends a bomb to its impact event time', () => {
    const bomb = vessel('bomb', true, [segment('flight', 'loaded', [10, 20])])
    const impact = event({
      type: 'impact',
      ut: 25,
      data: { actorId: 'bomb' },
    })
    expect(vesselTerminalUt(bomb, [impact])).toBe(25)
  })

  it('ends a static ship at its kill event', () => {
    const ship = vessel('ship', false, [segment('static', 'loaded', [0])])
    const kill = event({ type: 'kill', ut: 50, vessel: 'ship' })
    expect(vesselTerminalUt(ship, [kill])).toBe(50)
  })

  it('returns null when a vessel has no terminal event', () => {
    const plane = vessel('plane', false, [segment('flight', 'active', [0, 100])])
    expect(vesselTerminalUt(plane, [])).toBeNull()
  })

  it('keeps the real last sample for static debris', () => {
    const debris = vessel('debris', false, [segment('static', 'loaded', [96, 98])])
    expect(vesselLastUt(debris)).toBe(Number.POSITIVE_INFINITY)
    expect(vesselLastSampleUt(debris)).toBe(98)
  })

  it('changes side at team_change events', () => {
    const plane = { id: 'p1', side: 'red' }
    const events = [
      event({ type: 'team_change', ut: 10, vessel: 'p1', data: { side: 'blue' } }),
      event({ type: 'team_change', ut: 20, vessel: 'p1', data: { side: 'red' } }),
    ]
    expect(sideAt(plane as never, 5, events)).toBe('red')
    expect(sideAt(plane as never, 15, events)).toBe('blue')
    expect(sideAt(plane as never, 25, events)).toBe('red')
  })
})
