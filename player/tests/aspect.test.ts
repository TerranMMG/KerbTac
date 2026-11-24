import { describe, expect, it } from 'vitest'
import { aspectAngleDeg, aspectLabel } from '../src/playback/aspect'

describe('aspect angle', () => {
  it('returns 180 when the attacker is in front of the target', () => {
    expect(aspectAngleDeg(0, 180)).toBeCloseTo(180, 6)
  })

  it('returns 0 when the attacker is behind the target', () => {
    expect(aspectAngleDeg(0, 0)).toBeCloseTo(0, 6)
  })

  it('returns 90 for a beam aspect', () => {
    expect(aspectAngleDeg(0, 90)).toBeCloseTo(90, 6)
  })

  it('uses contiguous simplified bands', () => {
    expect(aspectLabel(0)).toBe('Cold')
    expect(aspectLabel(59.9)).toBe('Cold')
    expect(aspectLabel(60)).toBe('Beaming')
    expect(aspectLabel(109.9)).toBe('Beaming')
    expect(aspectLabel(110)).toBe('Flanking')
    expect(aspectLabel(149.9)).toBe('Flanking')
    expect(aspectLabel(150)).toBe('Hot')
    expect(aspectLabel(180)).toBe('Hot')
  })
})
