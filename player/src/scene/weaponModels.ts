import type * as THREE from 'three'
import { createMunitionSilhouette } from './munitionSilhouettes'

const cache = new Map<string, THREE.BufferGeometry>()

/** Match the legacy recording labels to original procedural replay symbols. */
export function weaponModelKey(actor: {
  name?: string | null
  weapon?: string | null
  kind?: string | null
}): string | null {
  const value = `${actor.name ?? ''} ${actor.weapon ?? ''}`.toLowerCase()
  if (value.includes('amraam') && value.includes('emp')) return 'amraam_emp'
  if (/aim-?120|amraam/.test(value)) return 'bahaaim120'
  if (/aim-?9|sidewinder/.test(value)) return 'bahaaim9'
  if (value.includes('hellfire') && value.includes('emp')) return 'hellfireemp'
  if (/agm-?114|hellfire/.test(value)) return 'bahaagm-114'
  if (/agm-?65|maverick/.test(value)) return 'bahaagm-65'
  if (/agm-?86/.test(value)) return 'bahaagm86b'
  if (/agm-?88|harm/.test(value)) return 'bahaharm'
  if (/pac-?3/.test(value)) return 'bahapac-3'
  if (/air-?2|genie/.test(value)) return 'bahaair-2'
  if (value.includes('hekv')) return 'bahahekv1'
  if (value.includes('kkv')) return 'bahakkv'
  if (/bgm-71|tow/.test(value)) return 'bahatowmissile'
  if (/rbs-?15/.test(value)) return 'baharbs-15alcruise'
  if (/cbu|cluster/.test(value)) return 'bahaclusterbomb'
  if (/jdam|mk83|gbu/.test(value)) return 'bahajdammk83'
  if (value.includes('mk82') && /brake|snake/.test(value)) return 'bahamk82bombbrake'
  if (value.includes('mk82')) return 'bahamk82bomb'
  if (/stingray|torpedo/.test(value)) return 'stingraybdtorpedo'
  return actor.kind?.includes('bomb') ? 'bahamk82bomb' : null
}

/** Shared screen-space geometry, authored with the nose along local −Z. */
export function weaponModel(key: string | null): THREE.BufferGeometry | null {
  if (!key) return null
  const canonical = key === 'baharbs-15cruise' ? 'baharbs-15alcruise' : key
  const existing = cache.get(canonical)
  if (existing) return existing
  const geometry = createMunitionSilhouette(canonical)
  if (geometry) cache.set(canonical, geometry)
  return geometry
}
