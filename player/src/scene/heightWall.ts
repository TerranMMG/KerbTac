import * as THREE from 'three';
import type { SampleTable } from '../format/types';
import { latLonAltToBF, renderAltitude } from '../playback/math';
import { alphaForRate, metricValueAt, type HeightMetric } from '../playback/metrics';
import { toRenderPosition } from './renderFrame';

export type HeightWallSetting = 'disabled' | 'selected' | 'all';

export function shouldShowHeightWall(
  mode: 'external' | 'satellite' | 'free',
  setting: HeightWallSetting,
): boolean {
  return mode !== 'satellite' && setting !== 'disabled';
}

/**
 * Vertical curtain under the trail. Bottom is terrain (alt - agl) when the
 * archive has an AGL column, otherwise sea level. Vertices are body-fixed and
 * the mesh is rotated with the body like the trail.
 */
export function buildHeightWall(
  samples: SampleTable,
  bodyRadius: number,
  color: string,
): THREE.BufferGeometry {
  const count = samples.length;
  interface WallPoint {
    t: number;
    bottom: { x: number; y: number; z: number };
    top: { x: number; y: number; z: number };
  }
  const points: WallPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const agl = samples.agl?.[i] ?? null;
    // Vessel positions are drawn at AGL above the sea-level sphere, so the
    // wall must use the same datum instead of ASL minus terrain.
    const topAltitude = renderAltitude(samples.alt[i], agl);
    points.push({
      t: samples.t[i],
      bottom: toRenderPosition(latLonAltToBF(samples.lat[i], samples.lon[i], 0, bodyRadius)),
      top: toRenderPosition(
        latLonAltToBF(samples.lat[i], samples.lon[i], topAltitude, bodyRadius),
      ),
    })
  }
  const substeps = 4
  const denseCount = count === 0 ? 0 : (count - 1) * substeps + 1
  const positions = new Float32Array(denseCount * 6)
  const alphas = new Float32Array(denseCount * 2)
  const times = new Float32Array(denseCount * 2)
  const timeOrigin = count > 0 ? samples.t[0] : 0
  // Do not draw a wall through a VesselMover/loader teleport. The vertices
  // stay in place so setHeightWallAlpha() can keep its dense index mapping;
  // only the connecting triangles are omitted.
  const teleportEdges = new Array<boolean>(count).fill(false)
  for (let i = 1; i < count; i += 1) {
    const dt = points[i].t - points[i - 1].t
    if (!(dt > 0)) continue
    const distance = Math.hypot(
      points[i].top.x - points[i - 1].top.x,
      points[i].top.y - points[i - 1].top.y,
      points[i].top.z - points[i - 1].top.z,
    )
    teleportEdges[i] = distance > 500 && distance / dt > 10_000
  }
  let vertex = 0
  const pushPoint = (point: WallPoint): void => {
    positions[vertex * 3] = point.bottom.x
    positions[vertex * 3 + 1] = point.bottom.y
    positions[vertex * 3 + 2] = point.bottom.z
    alphas[vertex] = 0.15
    times[vertex] = point.t - timeOrigin
    vertex += 1
    positions[vertex * 3] = point.top.x
    positions[vertex * 3 + 1] = point.top.y
    positions[vertex * 3 + 2] = point.top.z
    alphas[vertex] = 0.15
    times[vertex] = point.t - timeOrigin
    vertex += 1
  }
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      const previous = points[i - 1]
      const current = points[i]
      for (let step = 1; step < substeps; step += 1) {
        const f = step / substeps
        pushPoint({
          t: previous.t + (current.t - previous.t) * f,
          bottom: {
            x: previous.bottom.x + (current.bottom.x - previous.bottom.x) * f,
            y: previous.bottom.y + (current.bottom.y - previous.bottom.y) * f,
            z: previous.bottom.z + (current.bottom.z - previous.bottom.z) * f,
          },
          top: {
            x: previous.top.x + (current.top.x - previous.top.x) * f,
            y: previous.top.y + (current.top.y - previous.top.y) * f,
            z: previous.top.z + (current.top.z - previous.top.z) * f,
          },
        })
      }
    }
    pushPoint(points[i])
  }
  const indexList: number[] = []
  for (let i = 0; i < denseCount - 1; i += 1) {
    const sampleEdge = Math.floor(i / substeps) + 1
    if (teleportEdges[sampleEdge]) continue
    const bottom = i * 2
    const top = bottom + 1
    indexList.push(bottom, top, bottom + 2, top, top + 2, bottom + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aTime', new THREE.BufferAttribute(times, 1))
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indexList), 1))
  geometry.userData.color = color
  geometry.userData.sampleCount = count
  geometry.userData.substeps = substeps
  geometry.userData.timeOrigin = timeOrigin
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Replace per-sample wall opacity with values derived from a height metric. */
export function setHeightWallAlpha(geometry: THREE.BufferGeometry, rates: Float32Array): void {
  const attribute = geometry.getAttribute('alpha') as THREE.BufferAttribute | undefined;
  if (!attribute) return;
  if (rates.length === 0) return;
  const substeps = (geometry.userData.substeps as number | undefined) ?? 1;
  const denseCount = Math.floor(attribute.count / 2);
  const array = attribute.array as Float32Array;
  for (let i = 0; i < denseCount; i += 1) {
    const source = i / substeps;
    const a = Math.min(rates.length - 1, Math.floor(source));
    const b = Math.min(rates.length - 1, a + 1);
    const f = Math.min(1, Math.max(0, source - a));
    const rate = rates[a] * (1 - f) + rates[b] * f;
    const alpha = alphaForRate(rate);
    array[i * 2] = alpha;
    array[i * 2 + 1] = alpha;
  }
  attribute.needsUpdate = true;
}

/** Map the chosen metric onto the exact retained samples of a merged wall. */
export function applyHeightWallMetric(
  geometry: THREE.BufferGeometry, tables: readonly SampleTable[], sources: Uint32Array,
  metric: HeightMetric, min: number, max: number,
): void {
  const rates = new Float32Array(sources.length / 2);
  const span = max - min;
  if (Number.isFinite(span) && span > 1e-9) {
    for (let i = 0; i < rates.length; i++) {
      const value = Math.abs(metricValueAt(tables[sources[i * 2]], sources[i * 2 + 1], metric));
      rates[i] = Number.isFinite(value) ? (value - min) / span : 0;
    }
  }
  setHeightWallAlpha(geometry, rates);
}

export function createHeightWallMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      wallColor: { value: new THREE.Color(color) },
      uNow: { value: 0 },
      uWindow: { value: 60 },
      uTailFade: { value: 18 },
      uHeadFade: { value: 4 },
      uOpacity: { value: 0.6 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float alpha;
      attribute float aTime;
      varying float vAlpha;
      varying float vTime;
      void main() {
        vAlpha = alpha;
        vTime = aTime;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 wallColor;
      uniform float uOpacity;
      uniform float uNow;
      uniform float uWindow;
      uniform float uTailFade;
      uniform float uHeadFade;
      varying float vAlpha;
      varying float vTime;
      void main() {
        #include <logdepthbuf_fragment>
        float age = uNow - vTime;
        float visible = step(vTime, uNow);
        float head = smoothstep(0.0, uHeadFade, age);
        float tail = 1.0 - smoothstep(uWindow - uTailFade, uWindow, age);
        float alpha = vAlpha * visible * head * clamp(tail, 0.0, 1.0) * uOpacity;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(wallColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export interface HeightWallStyle {
  now: number;
  window: number;
  tailFade: number;
  headFade: number;
  opacity: number;
}

/** Per-frame fade uniforms; avoids a stepped draw range at sample boundaries. */
export function updateHeightWallStyle(wall: THREE.Mesh, style: HeightWallStyle): void {
  const uniforms = (wall.material as THREE.ShaderMaterial).uniforms;
  const timeOrigin = (wall.geometry.userData.timeOrigin as number | undefined) ?? 0;
  uniforms.uNow.value = style.now - timeOrigin;
  uniforms.uWindow.value = style.window;
  uniforms.uTailFade.value = style.tailFade;
  uniforms.uHeadFade.value = style.headFade;
  uniforms.uOpacity.value = style.opacity;
}

/** A trail point already converted to render space (body-fixed, Z mirrored). */
export interface HeightWallTrailPoint {
  breakBefore?: boolean
  t: number
  x: number
  y: number
  z: number
}

/**
 * Builds the wall from the same merged trail points that draw the ribbon.
 * Using the raw segment samples here made the wall lag/lead and zig-zag
 * whenever two segments overlapped during time warp.
 */
export function buildHeightWallFromTrail(
  points: HeightWallTrailPoint[],
  bodyRadius: number,
  color: string,
  substeps = 4,
): THREE.BufferGeometry {
  const count = points.length
  interface WallPoint {
    t: number
    bottom: { x: number; y: number; z: number }
    top: { x: number; y: number; z: number }
  }
  const wallPoints: WallPoint[] = []
  for (let i = 0; i < count; i += 1) {
    const point = points[i]
    const length = Math.hypot(point.x, point.y, point.z) || 1
    const scale = bodyRadius / length
    wallPoints.push({
      t: point.t,
      top: { x: point.x, y: point.y, z: point.z },
      bottom: { x: point.x * scale, y: point.y * scale, z: point.z * scale },
    })
  }

  const denseCount = count === 0 ? 0 : (count - 1) * substeps + 1
  const positions = new Float32Array(denseCount * 6)
  const alphas = new Float32Array(denseCount * 2)
  const times = new Float32Array(denseCount * 2)
  const timeOrigin = count > 0 ? points[0].t : 0
  const teleportEdges = new Array<boolean>(count).fill(false)
  for (let i = 1; i < count; i += 1) {
    const dt = wallPoints[i].t - wallPoints[i - 1].t
    if (points[i].breakBefore) { teleportEdges[i] = true; continue }
    if (!(dt > 0)) continue
    const distance = Math.hypot(
      wallPoints[i].top.x - wallPoints[i - 1].top.x,
      wallPoints[i].top.y - wallPoints[i - 1].top.y,
      wallPoints[i].top.z - wallPoints[i - 1].top.z,
    )
    teleportEdges[i] = distance > 500 && distance / dt > 10_000
  }
  let vertex = 0
  const pushPoint = (point: WallPoint): void => {
    positions[vertex * 3] = point.bottom.x
    positions[vertex * 3 + 1] = point.bottom.y
    positions[vertex * 3 + 2] = point.bottom.z
    alphas[vertex] = 0.15
    times[vertex] = point.t - timeOrigin
    vertex += 1
    positions[vertex * 3] = point.top.x
    positions[vertex * 3 + 1] = point.top.y
    positions[vertex * 3 + 2] = point.top.z
    alphas[vertex] = 0.15
    times[vertex] = point.t - timeOrigin
    vertex += 1
  }
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      const previous = wallPoints[i - 1]
      const current = wallPoints[i]
      for (let step = 1; step < substeps; step += 1) {
        const f = step / substeps
        pushPoint({
          t: previous.t + (current.t - previous.t) * f,
          bottom: {
            x: previous.bottom.x + (current.bottom.x - previous.bottom.x) * f,
            y: previous.bottom.y + (current.bottom.y - previous.bottom.y) * f,
            z: previous.bottom.z + (current.bottom.z - previous.bottom.z) * f,
          },
          top: {
            x: previous.top.x + (current.top.x - previous.top.x) * f,
            y: previous.top.y + (current.top.y - previous.top.y) * f,
            z: previous.top.z + (current.top.z - previous.top.z) * f,
          },
        })
      }
    }
    pushPoint(wallPoints[i])
  }
  const indexList: number[] = []
  for (let i = 0; i < denseCount - 1; i += 1) {
    const sampleEdge = Math.floor(i / substeps) + 1
    if (teleportEdges[sampleEdge]) continue
    const bottom = i * 2
    const top = bottom + 1
    indexList.push(bottom, top, bottom + 2, top, top + 2, bottom + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aTime', new THREE.BufferAttribute(times, 1))
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indexList), 1))
  geometry.userData.color = color
  geometry.userData.sampleCount = count
  geometry.userData.substeps = substeps
  geometry.userData.timeOrigin = timeOrigin
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
