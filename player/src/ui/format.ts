import type { ReplayEvent } from '../format/types'
import { formatDuration, formatKspTime, formatMissionTime } from '../playback/clock'
import type { I18n, MessageKey } from '../i18n'

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatAltitude(meters: number): string {
  if (!Number.isFinite(meters)) return '—'
  const abs = Math.abs(meters)
  if (abs >= 10_000) return `${formatNumber(meters / 1000, 1)} km`
  return `${formatNumber(meters, 0)} m`
}

export function formatSpeed(mps: number): string {
  if (!Number.isFinite(mps)) return '—'
  return `${formatNumber(mps, 1)} m/s`
}

export function formatMass(kg: number): string {
  if (!Number.isFinite(kg)) return '—'
  if (Math.abs(kg) >= 1000) return `${formatNumber(kg / 1000, 2)} t`
  return `${formatNumber(kg, 0)} kg`
}

export function formatAngle(degrees: number): string {
  if (!Number.isFinite(degrees)) return '—'
  return `${formatNumber(((degrees % 360) + 360) % 360, 0)}°`
}

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  return `${formatNumber(ratio * 100, 0)}%`
}

export function formatGee(gee: number): string {
  if (!Number.isFinite(gee)) return '—'
  return `${formatNumber(gee, 2)} g`
}

export function formatResource(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatNumber(value, Math.abs(value) < 100 ? 1 : 0)
}

export function formatEventClock(ut: number, startUt: number): string {
  return formatMissionTime(ut, startUt).replace('T+ ', '')
}

export function formatEventTime(ut: number, startUt: number): string {
  return formatMissionTime(ut, startUt)
}

export function describeEvent(event: ReplayEvent, i18n: I18n): string {
  if (event.type === 'weapon_release' && dataValue(event, 'weaponClass')?.includes('rocket')) {
    return i18n.t('event.rocket_launch')
  }
  const key = `event.${event.type}` as MessageKey
  const label = i18n.t(key)
  if (label === key) return i18n.t('event.unknown')
  return label
}

function dataValue(event: ReplayEvent, name: string): string | null {
  const data = event.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[name]
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function describeEventDetail(event: ReplayEvent, i18n: I18n): string {
  switch (event.type) {
    case 'takeoff': {
      const speed = dataValue(event, 'speed')
      return speed ? i18n.t('detail.speed', { value: formatNumber(Number(speed), 0) }) : ''
    }
    case 'touchdown': {
      const vs = dataValue(event, 'verticalSpeed')
      return vs ? i18n.t('detail.verticalSpeed', { value: formatNumber(Number(vs), 1) }) : ''
    }
    case 'landing': {
      const speed = dataValue(event, 'speed')
      return speed ? i18n.t('detail.speed', { value: formatNumber(Number(speed), 1) }) : ''
    }
    case 'stage': {
      const stage = dataValue(event, 'stage')
      return stage ? i18n.t('detail.stage', { value: stage }) : ''
    }
    case 'gear_up':
    case 'gear_down':
    case 'engine_ignition':
    case 'engine_shutdown': {
      const part = dataValue(event, 'part')
      return part ?? ''
    }
    case 'soi_change': {
      const from = dataValue(event, 'from') ?? '?'
      const to = dataValue(event, 'to') ?? '?'
      return i18n.t('detail.fromTo', { from, to })
    }
    case 'note':
      return dataValue(event, 'text') ?? ''
    case 'flight_end': {
      const duration = dataValue(event, 'duration')
      return duration ? i18n.t('detail.duration', { value: formatDuration(Number(duration)) }) : ''
    }
    case 'gunfire': {
      const parts: string[] = []
      const rounds = dataValue(event, 'rounds')
      const rpm = dataValue(event, 'rpm')
      const caliber = dataValue(event, 'caliber')
      if (rounds) parts.push(`${formatNumber(Number(rounds), 0)} rds`)
      if (rpm) parts.push(`${formatNumber(Number(rpm), 0)} rpm`)
      if (caliber) parts.push(`${formatNumber(Number(caliber), 0)} mm`)
      return parts.join(' · ')
    }
    case 'countermeasure':
    case 'chaff':
    case 'flare': {
      const count = dataValue(event, 'count')
      const cmType = dataValue(event, 'cmType')
      return [count && `${count}×`, cmType].filter(Boolean).join(' ')
    }
    case 'weapon_release': {
      return dataValue(event, 'weaponClass') ?? event.weapon ?? ''
    }
    case 'impact':
    case 'proximity_detonation': {
      const tnt = dataValue(event, 'tntMass')
      const warhead = dataValue(event, 'warhead')
      return [tnt && `${formatNumber(Number(tnt), 1)} kg`, warhead].filter(Boolean).join(' · ')
    }
    case 'hit': {
      const before = dataValue(event, 'healthBefore')
      const after = dataValue(event, 'healthAfter')
      if (before && after) {
        return `${formatPercent(Number(before))} → ${formatPercent(Number(after))}`
      }
      return event.damage != null ? `-${formatPercent(event.damage)}` : ''
    }
    case 'kill':
    case 'destroyed': {
      const weapon = event.weapon
      return weapon ? `← ${weapon}` : dataValue(event, 'reason') ?? ''
    }
    case 'miss':
      return dataValue(event, 'reason') ?? ''
    case 'target_lock': {
      const sensor = dataValue(event, 'sensor')
      const mode = dataValue(event, 'mode')
      return [sensor, mode].filter(Boolean).join(' · ')
    }
    default:
      return ''
  }
}

export { formatDuration, formatKspTime, formatMissionTime }
