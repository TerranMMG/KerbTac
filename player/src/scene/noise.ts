/** Deterministic 3D gradient noise used to paint procedural planet textures. */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Noise3D {
  (x: number, y: number, z: number): number
  fbm(x: number, y: number, z: number, octaves?: number): number
}

export function createNoise3D(seed: number): Noise3D {
  const random = mulberry32(seed)
  const source = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) source[i] = i
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = source[i]
    source[i] = source[j]
    source[j] = tmp
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i += 1) perm[i] = source[i & 255]

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

  const grad = (hash: number, x: number, y: number, z: number): number => {
    switch (hash & 15) {
      case 0: return x + y
      case 1: return -x + y
      case 2: return x - y
      case 3: return -x - y
      case 4: return x + z
      case 5: return -x + z
      case 6: return x - z
      case 7: return -x - z
      case 8: return y + z
      case 9: return -y + z
      case 10: return y - z
      case 11: return -y - z
      case 12: return x + y
      case 13: return -y + z
      case 14: return -x + y
      default: return -y - z
    }
  }

  const noise = ((x: number, y: number, z: number): number => {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const zi = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const a = perm[xi] + yi
    const aa = perm[a] + zi
    const ab = perm[a + 1] + zi
    const b = perm[xi + 1] + yi
    const ba = perm[b] + zi
    const bb = perm[b + 1] + zi

    const x1 = lerp(grad(perm[aa], xf, yf, zf), grad(perm[ba], xf - 1, yf, zf), u)
    const x2 = lerp(grad(perm[ab], xf, yf - 1, zf), grad(perm[bb], xf - 1, yf - 1, zf), u)
    const y1 = lerp(x1, x2, v)
    const x3 = lerp(grad(perm[aa + 1], xf, yf, zf - 1), grad(perm[ba + 1], xf - 1, yf, zf - 1), u)
    const x4 = lerp(grad(perm[ab + 1], xf, yf - 1, zf - 1), grad(perm[bb + 1], xf - 1, yf - 1, zf - 1), u)
    const y2 = lerp(x3, x4, v)
    return lerp(y1, y2, w)
  }) as Noise3D

  noise.fbm = (x: number, y: number, z: number, octaves = 4): number => {
    let total = 0
    let amplitude = 1
    let frequency = 1
    let norm = 0
    for (let i = 0; i < octaves; i += 1) {
      total += noise(x * frequency, y * frequency, z * frequency) * amplitude
      norm += amplitude
      amplitude *= 0.5
      frequency *= 2.03
    }
    return total / norm
  }

  return noise
}
