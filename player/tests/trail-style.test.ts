import { describe, expect, it } from 'vitest'
import type { ShaderMaterial } from 'three'
import { createTrailRibbon, updateTrailStyle } from '../src/scene/vessel'

describe('past-only trail', () => {
  it('hides future samples and exposes the trail window uniforms', () => {
    const ribbon = createTrailRibbon(
      Float32Array.from([0, 0, 0, 1, 0, 0]),
      Float32Array.from([0, 1, 0, 0, 1, 0]),
      Float64Array.from([0, 10]),
      0xffffff,
    )
    const material = ribbon.material as ShaderMaterial
    const uniforms = material.uniforms

    expect(uniforms.uFutureAlpha).toBeUndefined()
    expect(material.vertexShader).not.toContain('uFutureAlpha')
    expect(material.vertexShader).not.toContain('isFuture')
    expect(material.fragmentShader).toContain('step(vTime, uNow)')

    updateTrailStyle(ribbon, {
      halfWidth: 1,
      now: 5,
      window: 30,
      tailFade: 20,
      headFade: 1,
      opacity: 1,
    })
    expect(uniforms.uNow.value).toBe(5)
    expect(uniforms.uWindow.value).toBe(30)
    expect(uniforms.uTailFade.value).toBe(20)
  })
})
