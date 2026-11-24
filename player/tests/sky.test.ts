import { describe, expect, it } from 'vitest'
import { atmosphereStrengthForAltitude, skyBlendForAltitude } from '../src/scene/sky'

describe('sky altitude blend', () => {
  it('keeps the blue sky on the ground and is black above the atmosphere', () => {
    expect(skyBlendForAltitude(0)).toBe(0)
    expect(skyBlendForAltitude(70_000)).toBe(1)
    expect(skyBlendForAltitude(78_845)).toBe(1)
    expect(skyBlendForAltitude(2_863_330)).toBe(1)
  })

  it('fades through the atmosphere instead of jumping at the boundary', () => {
    const low = skyBlendForAltitude(20_000)
    const middle = skyBlendForAltitude(35_000)
    const high = skyBlendForAltitude(55_000)
    expect(low).toBeGreaterThan(0)
    expect(low).toBeLessThan(middle)
    expect(middle).toBeLessThan(high)
    expect(high).toBeLessThan(1)
  })

  it('keeps the atmosphere rim subtle once the camera leaves the air', () => {
    expect(atmosphereStrengthForAltitude(0)).toBeGreaterThan(atmosphereStrengthForAltitude(1))
    expect(atmosphereStrengthForAltitude(1)).toBeLessThan(0.2)
  })
})
