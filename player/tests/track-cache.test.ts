import { expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { sampleVessel, vesselActiveAt } from '../src/playback/track'
import { loadFixture } from './helpers/fixtures'

it('reuses parsed segment tables and lifetime bounds between vessel samples', async () => {
  const replay = parseArchive(new Uint8Array(await loadFixture('synthetic')))
  for (const original of replay.vessels.slice(0, 2)) {
    const segments = original.segments.concat(original.segments)
    let reads = 0
    const vessel = { ...original, get segments() { reads++; return segments } }
    const ut = segments.find(segment => segment.samples)?.startUt ?? replay.startUt
    expect(sampleVessel(vessel, ut, replay.bodies)).not.toBeNull()
    expect(vesselActiveAt(vessel, ut)).toBe(true)
    const firstReads = reads
    sampleVessel(vessel, ut + 0.1, replay.bodies)
    vesselActiveAt(vessel, ut + 0.1)
    expect(reads).toBe(firstReads)
  }
})
