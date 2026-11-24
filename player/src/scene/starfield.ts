import * as THREE from 'three'

export interface StarfieldView {
  points: THREE.Points
  dispose(): void
}

/** A static sphere of stars; the player never travels far enough to parallax them. */
export function createStarfield(count = 5000, radius = 6e6): StarfieldView {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  let seed = 1337
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  for (let i = 0; i < count; i += 1) {
    const u = random() * 2 - 1
    const theta = random() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - u * u))
    positions[i * 3] = Math.cos(theta) * r * radius
    positions[i * 3 + 1] = u * radius
    positions[i * 3 + 2] = Math.sin(theta) * r * radius

    const tint = random()
    if (tint < 0.08) color.setRGB(0.75, 0.85, 1.0)
    else if (tint < 0.16) color.setRGB(1.0, 0.86, 0.7)
    else {
      const brightness = 0.6 + random() * 0.4
      color.setRGB(brightness, brightness, brightness)
    }
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'starfield'
  points.frustumCulled = false

  return {
    points,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
