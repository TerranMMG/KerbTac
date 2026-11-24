import * as THREE from 'three'
import type { VesselTrack } from '../format/types'
import { createPresetMarker } from './vesselPresets'
import { createRoleMarker } from './roleModels'
import { modelTransform, type CustomModelEntry } from './customModels'
import { makeVesselVariant } from './proceduralVessels'

function createMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.28),
    metalness: 0.3,
    roughness: 0.58,
  })
}

export function setVesselMarkerColor(marker: THREE.Group, color: number): void {
  marker.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material || !('color' in material)) continue
      const colored = material as THREE.MeshStandardMaterial
      colored.color.setHex(color).multiplyScalar(material.userData.markerShade ?? 1)
      colored.emissive?.copy(colored.color).multiplyScalar(0.28)
    }
  })
}

export function createSatelliteMarker(color: number, type: string): THREE.Group {
  const variant = type === 'Station' ? 'station' : type === 'Relay' ? 'relay' : 'probe'
  const group = makeVesselVariant(variant, createMaterial(color))
  group.name = 'satellite-marker'
  group.userData.kind = 'satellite'
  return group
}

/**
 * A small probe/relay/station/base that survived a destroyed carrier. KSP often
 * keeps the carrier name (or appends " Probe"/" Core"), so a matching carrier
 * name plus a small part count is the reliable signal.
 */
export function isDetachedCore(
  vessel: Pick<VesselTrack, 'id' | 'name' | 'type' | 'partCount'>,
  vessels: readonly Pick<VesselTrack, 'id' | 'name' | 'type' | 'partCount' | 'transient'>[],
): boolean {
  const type = (vessel.type ?? '').toLowerCase()
  const coreType = type === 'probe' || type === 'relay' || type === 'station' || type === 'base'
  const name = vessel.name ?? ''
  const base = name
    .replace(/\s+(probe|core|computer)$/i, '')
    .replace(/_(probe|core)$/i, '')
  const namedCore = base !== name
  if (!coreType && !namedCore) return false
  if (vessel.partCount !== null && vessel.partCount !== undefined && vessel.partCount > 12) {
    return false
  }

  return vessels.some((other) => {
    if (other.transient || other.id === vessel.id) return false
    const otherType = (other.type ?? '').toLowerCase()
    if (
      otherType !== 'plane' &&
      otherType !== 'rover' &&
      otherType !== 'base' &&
      otherType !== 'ship'
    ) {
      return false
    }
    const otherName = other.name ?? ''
    return (
      otherName === name ||
      otherName === base ||
      otherName.startsWith(`${base}_`) ||
      base.startsWith(`${otherName}_`)
    )
  })
}

/** Render markers: local −Z is forward and +Y is up. */
export function createVesselMarker(
  color: number,
  type = 'Ship',
  kind?: string | null,
  name?: string | null,
  modelRole?: string | null,
  custom?: CustomModelEntry | null,
): THREE.Group {
  if (custom) {
    const material = createMaterial(color)
    material.side = THREE.DoubleSide
    const mesh = new THREE.Mesh(custom.fittedGeometry, material)
    mesh.name = 'custom-model'
    mesh.userData.sharedGeometry = true
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(modelTransform(custom.binding))
    mesh.matrixWorldNeedsUpdate = true
    const group = new THREE.Group()
    group.name = 'vessel-marker'
    group.userData.customModel = true
    group.add(mesh)
    return group
  }
  const lowerType = type.toLowerCase()
  const isDebris =
    lowerType.includes('debris') ||
    kind === 'debris' ||
    (name ?? '').toLowerCase().includes('debris') ||
    ((lowerType === 'probe' || lowerType === 'relay' || lowerType === 'station') &&
      kind !== 'sea/ship' &&
      /_\d+$/.test(name ?? ''))

  // A recorded space role is stronger evidence than KSP's final name/type:
  // payloads are renamed "... Debris" and flipped to VesselType.Debris when
  // they crash, but the launch replay must still draw the rocket/stage.
  const isFixedBase = modelRole === 'ground.vehicle' && kind === 'ground/structure'
  if (modelRole && !isFixedBase && (!isDebris || modelRole.startsWith('space.'))) {
    const roleMarker = createRoleMarker(modelRole, createMaterial(color))
    if (roleMarker) {
      roleMarker.name = 'vessel-marker'
      return roleMarker
    }
  }

  // A start-splashed Base/Probe/Relay/Station can legitimately be recorded with
  // the sea/ship kind. The ship preset wins over the generic satellite marker
  // only in this explicit case.
  if (!isDebris && kind !== 'sea/ship' && (type === 'Probe' || type === 'Relay' || type === 'Station')) {
    return createSatelliteMarker(color, type)
  }

  const material = createMaterial(color)
  const fallbackKind =
    lowerType === 'base' ? 'ground/structure' :
    lowerType === 'rover' ? 'ground/vehicle' :
    lowerType === 'lander' ? 'space/vessel' : null
  const preset = createPresetMarker(isDebris ? 'debris' : kind, material) ??
    createPresetMarker(fallbackKind, material)
  if (preset) {
    preset.name = 'vessel-marker'
    return preset
  }

  const group = makeVesselVariant('fighter', material)
  group.name = 'vessel-marker'
  return group
}

/**
 * Attitude ribbon: two vertices per sample (left/right wingtip), so the trail
 * shows which way the aircraft was banked. The centreline and right vector are
 * body-fixed metres; the shader expands them by a camera-relative half-width.
 * A time attribute clips future samples and fades the oldest tail to fully
 * transparent, so the ribbon grows smoothly instead of stepping at 10 Hz.
 */
export function createTrailRibbon(
  centres: Float32Array,
  rights: Float32Array,
  times: Float64Array,
  color: number,
  breaks?: Uint8Array,
): THREE.Mesh {
  const sampleCount = times.length
  const timeOrigin = sampleCount > 0 ? times[0] : 0
  const positions = new Float32Array(sampleCount * 6)
  const rightVectors = new Float32Array(sampleCount * 6)
  const sides = new Float32Array(sampleCount * 2)
  const sampleTimes = new Float32Array(sampleCount * 2)
  for (let i = 0; i < sampleCount; i += 1) {
    const x = centres[i * 3]
    const y = centres[i * 3 + 1]
    const z = centres[i * 3 + 2]
    const rx = rights[i * 3]
    const ry = rights[i * 3 + 1]
    const rz = rights[i * 3 + 2]
    for (let side = 0; side < 2; side += 1) {
      const vertex = i * 2 + side
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = y
      positions[vertex * 3 + 2] = z
      rightVectors[vertex * 3] = rx
      rightVectors[vertex * 3 + 1] = ry
      rightVectors[vertex * 3 + 2] = rz
      sides[vertex] = side === 0 ? -1 : 1
      sampleTimes[vertex] = times[i] - timeOrigin
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aRight', new THREE.BufferAttribute(rightVectors, 3))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
  geometry.setAttribute('aTime', new THREE.BufferAttribute(sampleTimes, 1))
  const indices: number[] = []
  for (let i = 0; i < sampleCount - 1; i += 1) {
    if (breaks?.[i + 1]) continue
    const left = i * 2
    const right = left + 1
    indices.push(left, right, left + 2, right, right + 2, left + 2)
  }
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1))
  const material = createTrailMaterial(color)
  const ribbon = new THREE.Mesh(geometry, material)
  ribbon.frustumCulled = false
  ribbon.name = 'vessel-trail'
  ribbon.userData.timeOrigin = timeOrigin
  return ribbon
}

function createTrailMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHalfWidth: { value: 30 },
      uNow: { value: 0 },
      uWindow: { value: 60 },
      uTailFade: { value: 18 },
      uHeadFade: { value: 4 },
      uOpacity: { value: 0.6 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aRight;
      attribute float aSide;
      attribute float aTime;
      uniform float uHalfWidth;
      varying float vTime;
      void main() {
        vTime = aTime;
        vec3 p = position + aRight * (aSide * uHalfWidth);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uNow;
      uniform float uWindow;
      uniform float uTailFade;
      uniform float uHeadFade;
      uniform float uOpacity;
      varying float vTime;
      void main() {
        #include <logdepthbuf_fragment>
        float age = uNow - vTime;
        float visible = step(vTime, uNow);
        float head = smoothstep(0.0, uHeadFade, age);
        float tail = 1.0 - smoothstep(uWindow - uTailFade, uWindow, age);
        float alpha = visible * head * clamp(tail, 0.0, 1.0) * uOpacity;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

export interface TrailStyle {
  halfWidth: number;
  now: number;
  window: number;
  tailFade: number;
  headFade: number;
  opacity: number;
}

/** Per-frame uniforms; width follows model scale and the shader fades the tail. */
export function updateTrailStyle(trail: THREE.Mesh, style: TrailStyle): void {
  const uniforms = (trail.material as THREE.ShaderMaterial).uniforms
  const timeOrigin = (trail.userData.timeOrigin as number | undefined) ?? 0
  uniforms.uHalfWidth.value = style.halfWidth
  uniforms.uNow.value = style.now - timeOrigin
  uniforms.uWindow.value = style.window
  uniforms.uTailFade.value = style.tailFade
  uniforms.uHeadFade.value = style.headFade
  uniforms.uOpacity.value = style.opacity
}

/** Dispose a subtree's geometries, materials and textures. */
export function disposeObject(root: THREE.Object3D): void {
  root.userData.disposed = true
  const materials = new Set<THREE.Material>()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry && !mesh.userData.sharedGeometry) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach(m => materials.add(m))
    else if (material) materials.add(material)
  })
  for (const material of materials) material.dispose()
}
