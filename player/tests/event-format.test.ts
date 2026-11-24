import { describe, expect, it } from 'vitest'
import type { ReplayEvent } from '../src/format/types'
import { I18n } from '../src/i18n'
import { describeEvent } from '../src/ui/format'

function event(type: string): ReplayEvent {
  return {
    ut: 0,
    type,
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
  }
}

describe('combat event labels', () => {
  it('names every v1.1 combat event in English', () => {
    const i18n = new I18n('en')
    expect(describeEvent(event('weapon_release'), i18n)).toBe('Weapon release')
    expect(describeEvent(event('target_lock'), i18n)).toBe('Radar lock')
    expect(describeEvent(event('hit'), i18n)).toBe('Hit')
    expect(describeEvent(event('kill'), i18n)).toBe('Kill')
    expect(describeEvent(event('miss'), i18n)).toBe('Miss')
    expect(describeEvent(event('proximity_detonation'), i18n)).toBe('Proximity detonation')
    expect(describeEvent(event('gunfire'), i18n)).toBe('Gunfire')
    expect(describeEvent(event('countermeasure'), i18n)).toBe('Countermeasure')
    expect(describeEvent(event('chaff'), i18n)).toBe('Chaff')
    expect(describeEvent(event('flare'), i18n)).toBe('Flare')
    expect(describeEvent(event('impact'), i18n)).toBe('Impact')
    expect(describeEvent(event('shrapnel'), i18n)).toBe('Shrapnel')
  })

  it('names combat events in Chinese', () => {
    const i18n = new I18n('zh')
    expect(describeEvent(event('weapon_release'), i18n)).toBe('武器发射')
    expect(describeEvent(event('target_lock'), i18n)).toBe('雷达锁定')
    expect(describeEvent(event('hit'), i18n)).toBe('命中')
    expect(describeEvent(event('kill'), i18n)).toBe('击毁')
  })
})
