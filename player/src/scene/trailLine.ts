import * as THREE from 'three'

export interface TrailLineStyle {
  now: number
  window: number
  tailFade: number
  opacity: number
}

/**
 * One-pixel centreline that keeps a trail continuous when the ribbon quads
 * become smaller than a pixel at very high orbits.
 */
export function createTrailLine(centres: Float32Array, times: Float64Array, color: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(centres, 3))
  const origin = times.length > 0 ? times[0] : 0
  const values = new Float32Array(times.length)
  for (let index = 0; index < times.length; index += 1) {
    values[index] = times[index] - origin
  }
  geometry.setAttribute('aTime', new THREE.BufferAttribute(values, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uNow: { value: 0 },
      uWindow: { value: 60 },
      uTailFade: { value: 18 },
      uOpacity: { value: 0.4 },
    },
    vertexShader: `
      attribute float aTime;
      varying float vTime;
      void main() {
        vTime = aTime;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uNow;
      uniform float uWindow;
      uniform float uTailFade;
      uniform float uOpacity;
      varying float vTime;
      void main() {
        float age = uNow - vTime;
        float visible = step(vTime, uNow);
        float fadeStart = max(0.0, uWindow - max(uTailFade, 0.001));
        float tail = 1.0 - smoothstep(fadeStart, max(uWindow, fadeStart + 0.001), age);
        float alpha = visible * clamp(tail, 0.0, 1.0) * uOpacity;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const line = new THREE.LineSegments(geometry, material)
  line.name = 'vessel-trail-line'
  line.frustumCulled = false
  line.renderOrder = 2
  line.userData.timeOrigin = origin
  return line
}

export function updateTrailLine(line: THREE.LineSegments, style: TrailLineStyle): void {
  const material = line.material as THREE.ShaderMaterial
  const origin = typeof line.userData.timeOrigin === 'number' ? line.userData.timeOrigin : 0
  material.uniforms.uNow.value = style.now - origin
  material.uniforms.uWindow.value = style.window
  material.uniforms.uTailFade.value = style.tailFade
  material.uniforms.uOpacity.value = style.opacity
}
