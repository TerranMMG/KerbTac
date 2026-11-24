import { describe, expect, it } from 'vitest'
import type { ShaderMaterial } from 'three'
import { createTrailLine, updateTrailLine } from '../src/scene/trailLine'

describe('trail centreline', () => {
  it('builds a line-segment strip with one time value per vertex', () => {
    const line = createTrailLine(
      Float32Array.from([0, 0, 0, 1, 0, 0]),
      Float64Array.from([0, 10]),
      0x33ccff,
    )
    expect(line.geometry.getAttribute('position').count).toBe(2)
    expect(line.geometry.getAttribute('aTime').count).toBe(2)
    const material = line.material as ShaderMaterial
    expect(material.fragmentShader).toContain('step(vTime, uNow)')
    expect(material.uniforms.uColor.value.getHex()).toBe(0x33ccff)
  })

  it('updates the visible time window without changing the line geometry', () => {
    const line = createTrailLine(
      Float32Array.from([0, 0, 0, 1, 0, 0]),
      Float64Array.from([100, 110]),
      0xffffff,
    )
    updateTrailLine(line, { now: 115, window: 30, tailFade: 20, opacity: 0.3 })
    const uniforms = (line.material as ShaderMaterial).uniforms
    expect(uniforms.uNow.value).toBe(15)
    expect(uniforms.uWindow.value).toBe(30)
    expect(uniforms.uTailFade.value).toBe(20)
    expect(uniforms.uOpacity.value).toBe(0.3)
  })
})
