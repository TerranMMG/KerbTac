import * as THREE from 'three'
import type { CelestialBodyDef } from '../format/types'
import { createNoise3D } from './noise'
import kerbinMapUrl from '../assets/kerbin-16k-tacview.webp?url'

const TEXTURE_WIDTH = 1024
const TEXTURE_HEIGHT = 512

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** Paints an equirectangular Kerbin-like map that matches the BF convention. */
export function createPlanetTexture(seed: number, style: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = TEXTURE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return canvas

  const noise = createNoise3D(seed)
  const detail = createNoise3D(seed + 17)
  const image = context.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT)
  const data = image.data

  const oceanDeep: [number, number, number] = style === 'kerbin' ? [9, 33, 62] : [24, 26, 32]
  const oceanShallow: [number, number, number] = style === 'kerbin' ? [24, 96, 138] : [52, 54, 60]
  const shore: [number, number, number] = [148, 152, 118]
  const lowland: [number, number, number] = [58, 116, 62]
  const highland: [number, number, number] = [112, 116, 68]
  const mountain: [number, number, number] = [138, 132, 120]
  const snow: [number, number, number] = [238, 244, 248]

  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    const lat = (0.5 - (y + 0.5) / TEXTURE_HEIGHT) * Math.PI
    const cosLat = Math.cos(lat)
    const sinLat = Math.sin(lat)
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const lon = ((x + 0.5) / TEXTURE_WIDTH) * Math.PI * 2 - Math.PI
      const px = cosLat * Math.cos(lon)
      const py = sinLat
      const pz = cosLat * Math.sin(lon)

      const warp = detail.fbm(px * 3.1 + 11.3, py * 3.1 - 4.7, pz * 3.1 + 2.9, 3) * 0.18
      const elevation = noise.fbm(px * 2.05 + 3.7 + warp, py * 2.05 - 1.9, pz * 2.05 + 6.1, 5)
      const ridge = Math.abs(noise.fbm(px * 5.4 - 8.1, py * 5.4 + 2.2, pz * 5.4 - 3.3, 3))
      const seaLevel = 0.045

      let color: [number, number, number]
      if (elevation < seaLevel) {
        const depth = Math.max(0, Math.min(1, (seaLevel - elevation) / 0.34))
        color = mix(oceanShallow, oceanDeep, depth * 0.9)
      } else {
        const height = Math.min(1, (elevation - seaLevel) / 0.3)
        if (height < 0.04) color = mix(shore, lowland, height / 0.04)
        else if (height < 0.42) color = mix(lowland, highland, (height - 0.04) / 0.38)
        else color = mix(highland, mountain, Math.min(1, (height - 0.42) / 0.3))
        const rock = Math.max(0, ridge - 0.52) * 1.4
        color = mix(color, mountain, Math.min(0.6, rock))
      }

      // Dry belts around the tropics and polar ice.
      const absLat = Math.abs(lat)
      const dry = Math.max(0, 1 - Math.abs(absLat - 0.42) / 0.16) * 0.35
      if (elevation >= seaLevel) color = mix(color, [148, 132, 82], dry)

      const polar = Math.max(0, (absLat - 1.16) / 0.42)
      if (polar > 0) color = mix(color, snow, Math.min(1, polar * 1.4))

      const grain = (detail.fbm(px * 42, py * 42, pz * 42, 2) * 0.5 + 0.5 - 0.5) * 10
      const index = (y * TEXTURE_WIDTH + x) * 4
      data[index] = Math.max(0, Math.min(255, color[0] + grain))
      data[index + 1] = Math.max(0, Math.min(255, color[1] + grain))
      data[index + 2] = Math.max(0, Math.min(255, color[2] + grain))
      data[index + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/** Clouds as a transparent overlay texture. */
export function createCloudTexture(seed: number): HTMLCanvasElement {
  const width = TEXTURE_WIDTH
  const height = TEXTURE_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const noise = createNoise3D(seed + 91)
  const image = context.createImageData(width, height)
  const data = image.data

  for (let y = 0; y < height; y += 1) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI
    const cosLat = Math.cos(lat)
    const sinLat = Math.sin(lat)
    for (let x = 0; x < width; x += 1) {
      const lon = ((x + 0.5) / width) * Math.PI * 2 - Math.PI
      const px = cosLat * Math.cos(lon)
      const py = sinLat
      const pz = cosLat * Math.sin(lon)
      const n = noise.fbm(px * 2.6 + 5.1, py * 2.6 - 2.4, pz * 2.6 + 8.8, 4)
      const band = Math.sin(lat * 5.4) * 0.05
      const value = n + band
      const alpha = Math.max(0, Math.min(1, (value - 0.1) / 0.32))
      const index = (y * width + x) * 4
      data[index] = 245
      data[index + 1] = 248
      data[index + 2] = 255
      data[index + 3] = Math.round(alpha * alpha * 205)
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

export interface PlanetView {
  group: THREE.Group
  radius: number
  update(dt: number): void
  setAtmosphereStrength(strength: number): void
  dispose(): void
}

const DETAIL_GLSL = `
float ktHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ktNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ktHash(i + vec3(0.0, 0.0, 0.0)), ktHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(ktHash(i + vec3(0.0, 1.0, 0.0)), ktHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(ktHash(i + vec3(0.0, 0.0, 1.0)), ktHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(ktHash(i + vec3(0.0, 1.0, 1.0)), ktHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`

/**
 * Adds object-space high frequency detail so the surface stays legible when the
 * camera drops below orbital altitude. The average brightness is preserved, so
 * the orbital view is unchanged.
 */
function enableSurfaceDetail(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vKtUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKtUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vKtUv;\n${DETAIL_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float ktLand = step(diffuseColor.b + 0.015, max(diffuseColor.r, diffuseColor.g));
        // UV-space octaves keep the detail independent of the huge object-space
        // radius (float precision broke the old vKtObj frequencies).
        float ktDetail = ktNoise(vec3(vKtUv * 2000.0, 0.0)) * 0.28
                       + ktNoise(vec3(vKtUv * 8000.0, 1.0)) * 0.22
                       + ktNoise(vec3(vKtUv * 32000.0, 2.0)) * 0.2
                       + ktNoise(vec3(vKtUv * 128000.0, 3.0)) * 0.16
                       + ktNoise(vec3(vKtUv * 512000.0, 4.0)) * 0.14;
        float ktShade = mix(1.0, 0.65 + 0.7 * ktDetail, ktLand);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(ktShade * 1.06, ktShade, ktShade * 0.94), ktLand);`,
      )
  }
}

/** Flat ocean colour shown for a moment before the real Kerbin map decodes. */
function createOceanTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, '#123a58')
    gradient.addColorStop(0.5, '#0f3350')
    gradient.addColorStop(1, '#123a58')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Loads the real Kerbin map (already flipped horizontally on disk to cancel the
 * SphereGeometry UV mirror) and swaps it over the placeholder. On failure the
 * procedural texture stays and the cloud layer comes back.
 */
function loadRealKerbinMap(
  material: THREE.MeshBasicMaterial,
  clouds: THREE.Mesh,
  placeholder: THREE.Texture,
  styleSeed: number,
  style: string,
  anisotropy: number,
  isDisposed: () => boolean,
  setCurrent: (texture: THREE.Texture) => void,
): void {
  const apply = (texture: THREE.Texture) => {
    if (isDisposed()) {
      texture.dispose()
      return
    }
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    material.map = texture
    material.needsUpdate = true
    setCurrent(texture)
    placeholder.dispose()
    clouds.visible = false
  }
  const loadImage = () => new THREE.TextureLoader().load(
    kerbinMapUrl, apply, undefined, (error) => {
      if (isDisposed()) return
      console.warn('[KerbTac] failed to load the Kerbin map, using procedural terrain', error)
      const fallback = new THREE.CanvasTexture(createPlanetTexture(styleSeed, style))
      fallback.colorSpace = THREE.SRGBColorSpace
      fallback.anisotropy = anisotropy
      material.map = fallback
      material.needsUpdate = true
      setCurrent(fallback)
      placeholder.dispose()
      clouds.visible = true
      enableSurfaceDetail(material)
    },
  )
  if (typeof createImageBitmap !== 'function') {
    loadImage()
    return
  }
  // Decode and flip the 16K image before WebGL uploads it. Supplying an
  // HTMLImageElement instead made texSubImage2D do that work during a frame.
  new THREE.ImageBitmapLoader().setOptions({
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
  }).load(kerbinMapUrl, (bitmap) => {
    const texture = new THREE.Texture(bitmap)
    texture.flipY = false
    texture.needsUpdate = true
    texture.addEventListener('dispose', () => bitmap.close())
    apply(texture)
  }, undefined, () => {
    if (!isDisposed()) loadImage()
  })
}

export function createPlanet(body: CelestialBodyDef, styleSeed = 1, anisotropy = 4, onTextureChange?: () => void): PlanetView {
  const group = new THREE.Group()
  group.name = `body:${body.name}`
  const radius = body.radius

  const usesRealMap = body.name.toLowerCase() === 'kerbin'
  const placeholder = usesRealMap
    ? createOceanTexture()
    : new THREE.CanvasTexture(createPlanetTexture(styleSeed, body.style ?? 'kerbin'))
  placeholder.colorSpace = THREE.SRGBColorSpace
  placeholder.anisotropy = anisotropy
  let currentTexture: THREE.Texture = placeholder

  // Unlit surface: Tacview never shows a terminator or a dark side. Daylight
  // is constant so the playback remains readable at any recorded time.
  const surfaceMaterial = new THREE.MeshBasicMaterial({ map: currentTexture })
  enableSurfaceDetail(surfaceMaterial)
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, usesRealMap ? 256 : 192, usesRealMap ? 128 : 96), surfaceMaterial)
  surface.name = 'surface'
  group.add(surface)

  const cloudTexture = new THREE.CanvasTexture(createCloudTexture(styleSeed))
  cloudTexture.colorSpace = THREE.SRGBColorSpace
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.004, 96, 48),
    new THREE.MeshStandardMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 1,
    }),
  )
  clouds.name = 'clouds'
  clouds.visible = !usesRealMap
  group.add(clouds)

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.008, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color('#cfe2f2') },
        uStrength: { value: 0.3 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormalDirection;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormalDirection = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        uniform float uStrength;
        varying vec3 vWorldPosition;
        varying vec3 vNormalDirection;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float rim = 1.0 - abs(dot(viewDirection, normalize(vNormalDirection)));
          float intensity = pow(clamp(rim, 0.0, 1.0), 2.4);
          gl_FragColor = vec4(glowColor, intensity * uStrength);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  )
  atmosphere.name = 'atmosphere'
  group.add(atmosphere)

  let cloudRotation = 0
  let disposed = false

  if (usesRealMap) {
    loadRealKerbinMap(
      surfaceMaterial,
      clouds,
      placeholder,
      styleSeed,
      body.style ?? 'kerbin',
      anisotropy,
      () => disposed,
      (texture) => {
        currentTexture = texture
        onTextureChange?.()
      },
    )
  }

  return {
    group,
    radius,
    update(dt: number) {
      cloudRotation += dt * 0.0016
      clouds.rotation.y = cloudRotation
    },
    setAtmosphereStrength(strength: number) {
      const uniforms = (atmosphere.material as THREE.ShaderMaterial).uniforms
      uniforms.uStrength.value = Math.max(0, strength)
    },
    dispose() {
      surface.geometry.dispose()
      ;(surface.material as THREE.Material).dispose()
      clouds.geometry.dispose()
      ;(clouds.material as THREE.Material).dispose()
      atmosphere.geometry.dispose()
      ;(atmosphere.material as THREE.Material).dispose()
      disposed = true
      currentTexture.dispose()
      cloudTexture.dispose()
    },
  }
}
