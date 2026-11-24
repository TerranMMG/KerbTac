import { describe, expect, it } from 'vitest'
import { createTrailRibbon } from '../src/scene/vessel'

describe('trail ribbon breaks', () => {
  it('does not create a quad across a break marker', () => {
    const centres = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
    const rights = Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    const times = Float64Array.from([0, 1, 2, 3])
    const ribbon = createTrailRibbon(centres, rights, times, 0xffffff, Uint8Array.from([0, 0, 1, 0]))
    const index = ribbon.geometry.getIndex()
    expect(index?.count).toBe(12)
  })
})
