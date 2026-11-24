import * as THREE from 'three'
import type { CelestialBodyDef, EffectEvent, RadarLock, Replay, SampleTable, VesselTrack } from '../format/types'
import { displayColorHex, isDebrisVessel } from '../format/types'
import { eventBound, replayEventIndex, replayFrameAt } from '../playback/selection'
import { displayVesselName, modelRoleAt, stackEndUt } from '../playback/roles'
import { bodyFrameAt, bodyRotationAt } from '../playback/body'
import { latLonAltToBF, renderAltitude, type Quat } from '../playback/math'
import {
  sampleVessel,
  vesselFirstUt,
  vesselLastSampleUt,
  vesselLastUt,
  type VesselState,
} from '../playback/track'
import { metricValueAt, type HeightMetric } from '../playback/metrics'
import { CameraRig, radialCameraUp, type CameraMode } from './camera'
import { createPlanet, type PlanetView } from './planet'
import { createEventMarkers, type EventMarkers } from './eventMarkers'
import { applyHeightWallMetric, createHeightWallMaterial, buildHeightWallFromTrail, shouldShowHeightWall, updateHeightWallStyle, type HeightWallSetting } from './heightWall'
import { createTrailRibbon, createVesselMarker, disposeObject, isDetachedCore, setVesselMarkerColor, updateTrailStyle } from './vessel'
import { setMarkerOpacity } from './outline'
import { canCustomizeModel, CustomModelRegistry, parseCustomGeometry } from './customModels'
import type { ModelBinding } from '../format/models'
import { createTrailLine, updateTrailLine } from './trailLine'
import { buildTrailMeshData, trailDrawRange, type TrailSegmentInput } from './trailMeshData'
import type { TrailDetailRequest, TrailDetailResult } from './trailDetail'
import TrailDetailWorker from './trailDetailWorker?worker&inline'
import { vesselIdFromObject } from './vesselPick'
import { trailHalfWidth } from './trailWidth'
import { atmosphereStrengthForAltitude, skyBlendForAltitude } from './sky'
import { DEFAULT_FRAME_RADIUS_M, frameRadiusForAltitude } from './frame'
import { createActorMarker } from './actors'
import { createThreatDome, createThreatRing, updateThreatVisual, type ThreatVisual } from './threat'
import { createEffectBurst, effectPointSize, effectProfile, updateEffectBurst, type EffectProfile } from './effects'
import { createTracerObject, tracerBursts, updateTracerObject, type TracerBurst } from './tracers'
import { isOccludedBySphere } from './occlusion'
import { createLockLine, lockColor, updateLockLine } from './locks'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { bfToRenderWorld, toRenderFrame, toRenderQuat } from './renderFrame'
import {
  labelLines,
  resolveLabelOverlaps,
  type LabelBox,
  type LabelSettings,
} from './labels'
import { snapModelScale, VectorArrows } from './vectors'
import { markerScale } from './scale'
import type { DisplaySettings } from '../playback/displaySettings'
import { DEFAULT_DISPLAY_SETTINGS, cloneDisplaySettings } from '../playback/displaySettings'

// External view is object-centric. A planet-scale radius put the camera so
// far above an aircraft that the ground, trails and lock lines disappeared.


export interface CameraFocus {
  position: THREE.Vector3
  forward: THREE.Vector3
  up: THREE.Vector3
}

interface VesselVisual {
  vessel: VesselTrack
  color: number
  index: number
  side: string
  marker: THREE.Group
  detachedCore: boolean
  stackEnd: number | null
  markerRole: string | null
  trail: THREE.Mesh
  trailLine: THREE.LineSegments
  wall: THREE.Mesh | null
  wallSources: Uint32Array
  wallTables: SampleTable[]
  wallRange?: { metric: HeightMetric; min: number; max: number }
  arrows: VectorArrows
  label: HTMLDivElement
  leader: HTMLDivElement
  labelText: string
  times: Float64Array
  wallTimes: Float64Array
  trailBody: string
  headTrim: number
  firstUt: number
  fadeStartUt: number
}

const SUN_DIRECTION = new THREE.Vector3(0.55, 0.42, 0.72).normalize()
const MODEL_FADE_SECONDS = 1.2

export class World {
  readonly rig: CameraRig
  private readonly container: HTMLElement
  private readonly labelLayer: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly planets = new Map<string, PlanetView>()
  private readonly visuals = new Map<string, VesselVisual>()
  private readonly spaceSky = new THREE.Color('#04070c')
  private skyTexture: THREE.Texture | null = null
  private eventMarkers: EventMarkers | null = null
  private lockLines: Array<{ lock: RadarLock; line: THREE.Mesh }> = []
  private effectBursts: Array<{ effect: EffectEvent; points: THREE.Points }> = []
  private tracerLines: Array<{ burst: TracerBurst; line: ReturnType<typeof createTracerObject> }> = []
  private killMarkers: Array<{ sprite: THREE.Sprite; vesselId: string; ut: number; state?: VesselState | null }> = []
  private activeKillMarkers: THREE.Sprite[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerDownActive = false
  private eventClickConsumed = false
  /** Called when the user clicks a 3D event marker. */
  onEventClick: ((ut: number, inputTime: number) => void) | null = null
  /** Called when the user double-clicks a vessel model. */
  onVesselPick: ((id: string) => void) | null = null
  private replay: Replay | null = null
  private selectedId: string | null = null
  private trailDetailWorker: Worker | null = null
  private restoreCoarseTrail: (() => void) | null = null
  private currentUt = 0
  private drawnUt: number | null = null
  private dirty = true
  private focusDirty = true
  private disposed = false
  private readonly viewMatrix = new THREE.Matrix4()
  private readonly projectionMatrix = new THREE.Matrix4()
  private displaySettings: DisplaySettings = cloneDisplaySettings(DEFAULT_DISPLAY_SETTINGS)
  private threatDomes = new Map<string, ThreatVisual>()
  private heightWallSetting: HeightWallSetting = 'selected'
  /** The scene is deliberately planet-fixed; M2 has no day/night cycle. */
  private frameUt = 0
  private selectedLabel: LabelSettings = DEFAULT_DISPLAY_SETTINGS.selectedLabel
  private unselectedLabel: LabelSettings = DEFAULT_DISPLAY_SETTINGS.unselectedLabel
  private width = 1
  private height = 1
  private readonly resizeObserver: ResizeObserver
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private readonly outlinePass: OutlinePass
  private readonly outputPass = new OutputPass()

  constructor(container: HTMLElement, labelLayer: HTMLElement) {
    this.container = container
    this.labelLayer = labelLayer

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false)
    this.renderer.domElement.className = 'viewport-canvas'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#04070c')
    this.skyTexture = this.createSkyTexture()
    this.width = Math.max(1, container.clientWidth)
    this.height = Math.max(1, container.clientHeight)
    this.rig = new CameraRig(this.renderer.domElement, this.width / this.height)

    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(this.width, this.height)
    this.renderPass = new RenderPass(this.scene, this.rig.camera)
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(this.width, this.height),
      this.scene,
      this.rig.camera,
    )
    this.outlinePass.edgeStrength = 2
    this.outlinePass.edgeGlow = 0
    this.outlinePass.edgeThickness = 0.6
    this.outlinePass.pulsePeriod = 0
    this.outlinePass.visibleEdgeColor.set(0xffffff)
    this.outlinePass.hiddenEdgeColor.set(0xffffff)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.outlinePass)
    this.composer.addPass(this.outputPass)

    window.addEventListener('resize', this.handleResize)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('dblclick', this.handleDoubleClick)
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)
  }

  private readonly handleContextRestored = (): void => {
    // Three rebuilds GPU resources, but an unchanged paused scene still
    // needs one draw to repopulate the restored framebuffer.
    this.dirty = true
  }

  /** Screen-space in-atmosphere sky: blue zenith fading to a pale horizon. */
  private createSkyTexture(): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, 256)
      gradient.addColorStop(0, '#3f86bd')
      gradient.addColorStop(0.55, '#79b3da')
      gradient.addColorStop(1, '#cfe8f7')
      context.fillStyle = gradient
      context.fillRect(0, 0, 2, 256)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private readonly handleResize = (): void => {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.outlinePass.resolution.set(width, height)
    this.rig.setAspect(width / height)
    this.dirty = true
  }

  /**
   * M1 lighting is a studio sun: put the light above the recording's starting
   * position so the real map is readable instead of showing the night side.
   * M3 will use the actual sun direction from body ephemerides.
   */
  private computeSunDirection(replay: Replay): THREE.Vector3 {
    const vessel = replay.vessels[0]
    if (!vessel) return SUN_DIRECTION.clone()
    const body = replay.bodies.get(vessel.body)
    const state = sampleVessel(vessel, replay.startUt, replay.bodies)
    if (!body || !state) return SUN_DIRECTION.clone()

    const bf = latLonAltToBF(state.lat, state.lon, 0, body.radius)
    const frame = bodyFrameAt(replay, vessel.body, replay.startUt)
    const world = bfToRenderWorld(frame, bf)
    const up = new THREE.Vector3(world.x, world.y, world.z)
    if (up.lengthSq() < 1e-6) return SUN_DIRECTION.clone()
    up.normalize()

    const tangent = new THREE.Vector3(0, 1, 0).cross(up)
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0)
    tangent.normalize()
    return up.clone().multiplyScalar(0.86).add(tangent.multiplyScalar(0.42)).normalize()
  }

  /**
   * Tacview keeps the surface in daylight and blends the sky from pale blue
   * near the ground to black in orbit. The same camera altitude also controls
   * the thin atmosphere rim.
   */
  private updateSky(): void {
    const replay = this.replay
    const visual = this.selectedId ? this.visuals.get(this.selectedId) : null
    const bodyName = visual?.vessel.body ?? replay?.vessels[0]?.body
    if (!replay || !bodyName) return
    const radius = replay.bodies.get(bodyName)?.radius ?? 600_000
    const altitude = Math.max(0, this.rig.camera.position.length() - radius)
    const blend = skyBlendForAltitude(altitude)
    this.scene.background = blend > 0.985 ? this.spaceSky : this.skyTexture
    const strength = atmosphereStrengthForAltitude(blend)
    for (const [name, planet] of this.planets) {
      planet.setAtmosphereStrength(name === bodyName ? strength : 0.18)
    }
  }

  load(replay: Replay): void {
    this.clearContent()
    this.replay = replay
    this.dirty = true
    this.focusDirty = true
    this.drawnUt = null
    const events = replayEventIndex(replay)
    this.currentUt = replay.startUt
    this.frameUt = replay.manifest.session.ut0 ?? replay.startUt

    this.scene.add(new THREE.AmbientLight('#8fa4bd', 0.26))
    const sunDirection = this.computeSunDirection(replay)
    const sun = new THREE.DirectionalLight('#fff4e0', 3.2)
    sun.position.copy(sunDirection).multiplyScalar(2_000_000)
    this.scene.add(sun)
    this.scene.add(sun.target)

    const anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy())
    // M1 has no orbit propagation: place the recorded body at the origin even
    // when bodies.json also lists its parent (for example the Sun). Rendering
    // every root body would put the Sun at the origin and swallow the planet.
    const renderBodies = new Map<string, CelestialBodyDef>()
    for (const vessel of replay.vessels) {
      const body = replay.bodies.get(vessel.body)
      if (body) renderBodies.set(body.name, body)
    }
    if (renderBodies.size === 0) {
      for (const body of replay.bodies.values()) {
        if (body.parent === null) renderBodies.set(body.name, body)
      }
    }
    for (const body of renderBodies.values()) {
      const planet = createPlanet(body, 1, anisotropy, () => { this.dirty = true })
      this.planets.set(body.name, planet)
      this.scene.add(planet.group)
    }

    this.eventMarkers = createEventMarkers(replay)
    if (this.eventMarkers) {
      // Events are shown on the timeline; 3D cubes obscure the view.
      this.eventMarkers.group.visible = false
      this.scene.add(this.eventMarkers.group)
    }

    for (const lock of replay.locks) {
      const source = replay.vessels.find((vessel) => vessel.id === lock.source)
      const line = createLockLine(lockColor(source?.side))
      line.userData.source = lock.source
      line.userData.target = lock.target
      this.scene.add(line)
      this.lockLines.push({ lock, line })
    }

    for (const effect of replay.effects) {
      const countermeasure = effect.kind === 'chaff' ||
        effect.kind === 'flare' ||
        effect.kind === 'decoy' ||
        effect.kind === 'bubble'
      if (!countermeasure) continue
      const points = createEffectBurst(effect)
      this.scene.add(points)
      this.effectBursts.push({ effect, points })
    }

    for (const burst of tracerBursts(replay.events, replay.bodies, replay.vessels)) {
      const line = createTracerObject(burst)
      this.scene.add(line)
      this.tracerLines.push({ burst, line })
    }

    const visibleVessels = replay.vessels
    visibleVessels.forEach((vessel, index) => {
      const color = parseInt(displayColorHex(vessel, index).slice(1), 16)
      const detachedCore = !vessel.transient && isDetachedCore(vessel, replay.vessels)
      const stackEnd = vessel.role === 'payload' ? stackEndUt(replay.vessels, vessel) : null
      const markerRole = detachedCore ? 'debris' : modelRoleAt(vessel, this.currentUt, stackEnd)
      const marker = this.builtInMarker(replay, vessel, color, markerRole, detachedCore)
      marker.userData.vesselId = vessel.id
      this.scene.add(marker)

      if (vessel.threat && vessel.threat.threatRadiusM > 0) {
        const domeColor = parseInt(displayColorHex(vessel, index).slice(1), 16)
        const dome = createThreatDome(vessel.threat.threatRadiusM, domeColor)
        const ring = createThreatRing(vessel.threat.threatRadiusM, domeColor)
        if (dome) this.scene.add(dome)
        if (ring) this.scene.add(ring)
        if (dome) this.threatDomes.set(vessel.id, { dome, ring })
      }

      const arrows = new VectorArrows()
      this.scene.add(arrows.group)

      const { times, centres, rights, breaks, lineTimes, lineCentres, wallPoints, wallSources, body } =
        buildTrailMeshData(this.trailInput(vessel), vessel.body, false)
      const trail = createTrailRibbon(centres, rights, times, color, breaks)
      this.scene.add(trail)
      const trailLine = createTrailLine(lineCentres, lineTimes, color)
      this.scene.add(trailLine)

      let wall: THREE.Mesh | null = null
      let wallTimes = new Float64Array(0)
      if (wallPoints.length > 1) {
        const radius = replay.bodies.get(body)?.radius ?? 600_000
        const geometry = buildHeightWallFromTrail(
          wallPoints,
          radius,
          `#${color.toString(16).padStart(6, '0')}`,
          1,
        )
        wall = new THREE.Mesh(geometry, createHeightWallMaterial(color))
        wall.name = 'vessel-height-wall'
        wall.frustumCulled = false
        wall.visible = false
        wallTimes = Float64Array.from(wallPoints.map((point) => point.t))
        this.scene.add(wall)
      }

      const label = document.createElement('div')
      label.className = 'vessel-label'
      label.textContent = displayVesselName(vessel)
      label.dataset.vesselId = vessel.id
      label.style.setProperty('--vessel-color', `#${color.toString(16).padStart(6, '0')}`)
      label.addEventListener('pointerdown', (event) => {
        event.stopPropagation()
        this.onVesselPick?.(vessel.id)
      })
      label.addEventListener('click', (event) => {
        event.stopPropagation()
        this.onVesselPick?.(vessel.id)
      })
      this.labelLayer.appendChild(label)

      const leader = document.createElement('div')
      leader.className = 'label-leader'
      leader.hidden = true
      this.labelLayer.appendChild(leader)

      const lastSampleUt = isDebrisVessel(vessel)
        ? vesselLastSampleUt(vessel)
        : vesselLastUt(vessel)
      const firstSampleUt = vesselFirstUt(vessel)
      const terminalUt = isDebrisVessel(vessel)
        ? null
        : events.terminalUt(vessel)
      const fadeStartUt = terminalUt !== null
        ? terminalUt
        : lastSampleUt === null
          ? Number.POSITIVE_INFINITY
          : lastSampleUt
      const firstUt = firstSampleUt === null ? Number.POSITIVE_INFINITY : firstSampleUt

      this.visuals.set(vessel.id, {
        vessel,
        color,
        index,
        side: vessel.side,
        marker,
        detachedCore,
        stackEnd,
        markerRole,
        trail,
        trailLine,
        wall,
        wallSources,
        wallTables: vessel.segments.flatMap(segment => segment.samples?.length ? [segment.samples] : []),
        arrows,
        label,
        leader,
        labelText: '',
        times,
        wallTimes,
        trailBody: body,
        headTrim: 0,
        firstUt,
        fadeStartUt,
      })
    })

    const decoded = new Map<string, THREE.BufferGeometry | Error>()
    const used = new Set<THREE.BufferGeometry>()
    for (const binding of replay.models) {
      try {
        let geometry = decoded.get(binding.file)
        if (!geometry) {
          try {
            const data = replay.modelFiles.get(binding.file)
            if (!data) throw new Error('missing model file')
            geometry = parseCustomGeometry(binding.file, data)
          } catch (error) {
            geometry = error instanceof Error ? error : new Error(String(error))
          }
          decoded.set(binding.file, geometry)
        }
        if (geometry instanceof Error) throw geometry
        this.setCustomModel(binding.vesselId, geometry, binding)
        used.add(geometry)
      } catch (error) {
        replay.warnings.push({
          code: 'optionalSection',
          params: { path: binding.file, detail: error instanceof Error ? error.message : String(error) },
        })
      }
    }
    for (const geometry of decoded.values()) {
      if (!(geometry instanceof Error) && !used.has(geometry)) geometry.dispose()
    }

    for (const event of events.forVessel(null)) {
      if (event.type !== 'kill' && event.type !== 'destroyed' && event.type !== 'crash') continue
      const vesselId = event.vessel ?? event.target
      if (!vesselId || !this.visuals.has(vesselId)) continue
      const vessel = this.visuals.get(vesselId)?.vessel
      if (vessel && isDebrisVessel(vessel)) continue
      const material = new THREE.SpriteMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.name = 'kill-flash'
      sprite.visible = false
      sprite.renderOrder = 20
      this.scene.add(sprite)
      this.killMarkers.push({ sprite, vesselId, ut: event.ut })
    }

    const first = visibleVessels.find((vessel) => !vessel.transient) ?? visibleVessels[0]
    this.selectedId = first ? first.id : null
    if (first) {
      const focus = this.focus()
      if (focus) {
        this.rig.frameOn(focus.position, this.frameRadiusFor(first))
        this.rig.setFocus(focus.position, focus.up, true)
      } else {
        this.rig.focusOn(this.positionOf(null, first))
      }
    }
    this.update(0)
    if (first) this.requestTrailDetail(first.id)
  }

  private readonly customModels = new CustomModelRegistry()

  getCustomModel(vesselId: string) {
    return this.customModels.getCustomModel(vesselId)
  }

  setCustomModel(vesselId: string, geometry: THREE.BufferGeometry, binding: ModelBinding): void {
    const visual = this.visuals.get(vesselId)
    if (!visual || !canCustomizeModel(visual.vessel) || binding.vesselId !== vesselId) {
      throw new Error('This vessel cannot use a custom model')
    }
    this.customModels.setCustomModel(vesselId, geometry, binding)
    const marker = createVesselMarker(visual.color, visual.vessel.type, visual.vessel.kind,
      visual.vessel.name, visual.vessel.modelRole, this.customModels.getCustomModel(vesselId))
    this.replaceMarker(visual, marker)
  }

  clearCustomModel(vesselId: string): void {
    const visual = this.visuals.get(vesselId)
    if (!visual || !this.replay || !this.getCustomModel(vesselId)) return
    this.customModels.clearCustomModel(vesselId)
    visual.markerRole = visual.detachedCore ? 'debris' : modelRoleAt(visual.vessel, this.currentUt, visual.stackEnd)
    this.replaceMarker(visual, this.builtInMarker(
      this.replay, visual.vessel, visual.color, visual.markerRole, visual.detachedCore,
    ))
  }

  private replaceMarker(visual: VesselVisual, marker: THREE.Group): void {
    this.dirty = true
    const previous = visual.marker
    marker.position.copy(previous.position)
    marker.quaternion.copy(previous.quaternion)
    marker.scale.copy(previous.scale)
    marker.visible = previous.visible
    marker.userData.vesselId = visual.vessel.id
    this.scene.remove(previous)
    disposeObject(previous)
    visual.marker = marker
    this.scene.add(marker)
  }

  private builtInMarker(
    replay: Replay, vessel: VesselTrack, color: number, role: string | null, detached: boolean,
  ): THREE.Group {
    if (vessel.transient) {
      const actor = replay.actors.find(item => item.id === vessel.id)
      return createActorMarker({ ...vessel, weapon: actor?.weapon })
    }
    return createVesselMarker(color, vessel.type, detached ? 'debris' : vessel.kind, vessel.name, role)
  }

  private trailInput(vessel: VesselTrack): TrailSegmentInput[] {
    return vessel.segments.flatMap(segment => {
      const samples = segment.samples
      if (!samples?.length) return []
      const { length, t, lat, lon, alt, agl } = samples
      return [{ body: segment.body, kind: segment.kind, boundary: segment.boundary,
        radius: this.replay?.bodies.get(segment.body)?.radius ?? 600_000,
        samples: { length, t, lat, lon, alt, agl } }]
    })
  }

  private positionOf(state: VesselState | null, vessel: VesselTrack): THREE.Vector3 {
    const replay = this.replay
    if (!replay || !state) return new THREE.Vector3()
    const bodyName = state.body ?? vessel.body
    const radius = replay.bodies.get(bodyName)?.radius ?? 600_000
    const bf = latLonAltToBF(
      state.lat,
      state.lon,
      renderAltitude(state.alt, state.agl),
      radius,
    )
    const frame = bodyFrameAt(replay, bodyName, this.frameUt)
    const world = bfToRenderWorld(frame, bf)
    return new THREE.Vector3(world.x, world.y, world.z)
  }

  setTime(ut: number): void {
    this.currentUt = ut
  }

  setHeightWall(setting: HeightWallSetting): void {
    this.dirty = true
    this.heightWallSetting = setting
  }

  setHeightMetric(metric: HeightMetric): void {
    if (this.displaySettings.heightMetric === metric) return
    this.displaySettings.heightMetric = metric
    this.dirty = true
  }

  private syncWallMetric(visual: VesselVisual): void {
    const geometry = visual.wall?.geometry
    const metric = this.displaySettings.heightMetric
    if (!geometry || geometry.userData.metric === metric) return
    // Use the full body's range for consistent opacity across coarse/selected
    // detail; use the exact merged source sample for each retained vertex.
    if (visual.wallRange?.metric !== metric) {
      let min = Infinity
      let max = -Infinity
      visual.vessel.segments.forEach(segment => {
        const table = segment.samples
        if (!table || segment.body !== visual.trailBody) return
        for (let i = 0; i < table.length; i++) {
          const value = Math.abs(metricValueAt(table, i, metric))
          if (!Number.isFinite(value)) continue
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
      })
      visual.wallRange = { metric, min, max }
    }
    applyHeightWallMetric(geometry, visual.wallTables, visual.wallSources, metric,
      visual.wallRange.min, visual.wallRange.max)
    geometry.userData.metric = metric
  }

  setSelected(id: string | null): void {
    const previous = this.selectedId
    this.selectedId = id
    this.dirty = true
    this.focusDirty = true
    if (previous !== id) {
      this.cancelTrailDetail()
      if (id) this.requestTrailDetail(id)
    }
    const focus = this.focus()
    if (!focus) return
    const visual = id ? this.visuals.get(id) : null
    const radius = this.frameRadiusFor(visual?.vessel)
    if (radius > DEFAULT_FRAME_RADIUS_M) this.rig.frameOn(focus.position, radius)
    else this.rig.setFocus(focus.position, focus.up, true)
  }

  private cancelTrailDetail(): void {
    this.trailDetailWorker?.terminate()
    this.trailDetailWorker = null
    this.restoreCoarseTrail?.()
    this.restoreCoarseTrail = null
  }

  private requestTrailDetail(id: string): void {
    const visual = this.visuals.get(id)
    if (!visual || !this.replay) return
    const segments = this.trailInput(visual.vessel)
    if (!segments.length) return
    const body = visual.vessel.body
    const request: TrailDetailRequest = {
      segments, body, radius: this.replay.bodies.get(body)?.radius ?? 600_000,
      color: visual.color, wall: visual.wall !== null,
    }
    let worker: Worker
    try {
      worker = new TrailDetailWorker()
    } catch (error) {
      console.warn('[KerbTac] full trail detail unavailable', error)
      return
    }
    this.trailDetailWorker = worker
    const fail = (error: unknown) => {
      if (this.trailDetailWorker !== worker) return
      this.cancelTrailDetail()
      console.warn('[KerbTac] full trail detail unavailable', error)
    }
    worker.onerror = fail
    worker.onmessageerror = fail
    worker.onmessage = ({ data }: MessageEvent<TrailDetailResult>) => {
      if (this.trailDetailWorker !== worker) return
      worker.terminate()
      this.trailDetailWorker = null
      const swap = (object: THREE.Mesh | THREE.LineSegments, payload: TrailDetailResult['ribbon']) => {
        const previous = object.geometry
        const previousOrigin = object.userData.timeOrigin
        const geometry = new THREE.BufferGeometry()
        for (const [name, attr] of Object.entries(payload.attributes)) {
          geometry.setAttribute(name, new THREE.BufferAttribute(attr.array, attr.itemSize))
        }
        if (payload.index) geometry.setIndex(new THREE.BufferAttribute(payload.index.array, 1))
        geometry.userData.timeOrigin = payload.timeOrigin
        geometry.userData.substeps = payload.substeps
        // Time is monotonic within a body, but not across the independently
        // appended body runs of a legacy multi-body recording.
        geometry.userData.clipByTime = segments.every(segment => segment.body === body) || object === visual.wall
        object.geometry = geometry
        object.userData.timeOrigin = payload.timeOrigin
        return () => {
          geometry.dispose()
          object.geometry = previous
          object.userData.timeOrigin = previousOrigin
        }
      }
      const restoreRibbon = swap(visual.trail, data.ribbon)
      const restoreLine = swap(visual.trailLine, data.line)
      const restoreWall = visual.wall && data.wall ? swap(visual.wall, data.wall) : null
      const previousTimes = visual.times
      const previousWallTimes = visual.wallTimes
      const previousWallSources = visual.wallSources
      visual.times = data.times
      visual.wallTimes = data.wallTimes
      visual.wallSources = data.wallSources
      this.dirty = true
      this.restoreCoarseTrail = () => {
        restoreRibbon()
        restoreLine()
        restoreWall?.()
        visual.times = previousTimes
        visual.wallTimes = previousWallTimes
        visual.wallSources = previousWallSources
      }
    }
    try {
      // Only positional columns are cloned. The replay retains ownership for
      // sampling and subsequent selections.
      worker.postMessage(request)
    } catch (error) {
      fail(error)
    }
  }

  /** Frame high-orbit selections around the satellite; keep close views tight. */
  private frameRadiusFor(vessel: VesselTrack | undefined): number {
    const replay = this.replay
    if (!vessel || !replay) return DEFAULT_FRAME_RADIUS_M
    const state = sampleVessel(vessel, this.currentUt, replay.bodies)
    if (!state) return DEFAULT_FRAME_RADIUS_M
    return frameRadiusForAltitude(state.alt)
  }

  /** Apply the whole Display menu state in one place. */
  setDisplaySettings(settings: DisplaySettings): void {
    this.dirty = true
    this.displaySettings = cloneDisplaySettings(settings)
    this.heightWallSetting = this.displaySettings.heightWall
    this.selectedLabel = this.displaySettings.selectedLabel
    this.unselectedLabel = this.displaySettings.unselectedLabel
  }

  setModelScale(index: number): void {
    this.dirty = true
    this.displaySettings.modelScaleIndex = index
  }

  setVectorsVisible(visible: boolean): void {
    this.dirty = true
    this.displaySettings.showVectors = visible
  }

  setLabelsVisible(visible: boolean): void {
    this.dirty = true
    this.displaySettings.showLabels = visible
  }

  setTrailSeconds(seconds: number): void {
    this.dirty = true
    this.displaySettings.trailSeconds = seconds
  }

  setLabelSettings(selected: LabelSettings, unselected: LabelSettings): void {
    this.dirty = true
    this.selectedLabel = selected
    this.unselectedLabel = unselected
    this.displaySettings.selectedLabel = selected
    this.displaySettings.unselectedLabel = unselected
  }

  moveFree(forward: number, right: number, up: number, dt: number, boost = false): void {
    this.rig.moveFree(forward, right, up, dt, boost)
  }

  setCameraMode(mode: CameraMode): void {
    this.dirty = true
    this.rig.setMode(mode)
    const focus = this.focus()
    if (focus) this.rig.setFocus(focus.position, focus.up, true)
  }

  resetCamera(): void {
    this.dirty = true
    const focus = this.focus()
    if (focus) {
      this.rig.frameOn(focus.position, DEFAULT_FRAME_RADIUS_M)
      this.rig.setFocus(focus.position, focus.up, true)
    } else {
      this.rig.reset()
    }
  }

  compassHeadingDeg(): number | null {
    if (this.rig.mode === 'satellite') return null
    return this.rig.viewHeadingDeg
  }

  private focus(): CameraFocus | null {
    const visual = this.selectedId ? this.visuals.get(this.selectedId) : null
    const replay = this.replay
    if (!visual || !replay) return null
    const state = replayFrameAt(replay, this.currentUt).sample(visual.vessel)
    if (!state) return null
    const position = this.positionOf(state, visual.vessel)
    const frame = bodyFrameAt(replay, state.body ?? visual.vessel.body, this.frameUt)
    const worldQuat = multiplyQuat(toRenderQuat(frame.quat), toRenderQuat(state.q))
    const forward = rotateVector(worldQuat, { x: 0, y: 0, z: 1 })
    // Orbiting around the aircraft's own up vector puts the camera below
    // the surface whenever the aircraft is inverted. Use the radial up of
    // the body instead: external view stays above the horizon and never
    // inherits roll.
    const up = radialCameraUp(position)
    return {
      position,
      forward: new THREE.Vector3(forward.x, forward.y, forward.z).normalize(),
      up,
    }
  }



  update(dt: number): void {
    if (this.disposed) return
    const replay = this.replay
    if (!replay) {
      this.renderer.render(this.scene, this.rig.camera)
      return
    }

    const timeChanged = this.drawnUt !== this.currentUt
    if (timeChanged || this.focusDirty) {
      const focus = this.focus()
      // Move the camera before projecting labels, otherwise leaders are drawn
      // from last frame's camera and visibly trail a fast missile.
      if (focus) this.rig.setFocus(focus.position, focus.up, this.rig.mode === 'external')
      this.focusDirty = false
    }
    // Apply focus easing/free-camera movement before label projection. The old
    // order updated the camera after placing labels, so fast orbiting or
    // satellite panning left the labels and leaders one frame behind.
    this.rig.update(dt)
    const camera = this.rig.camera
    camera.updateMatrixWorld(true)
    if (!timeChanged && !this.dirty &&
        this.viewMatrix.equals(camera.matrixWorld) && this.projectionMatrix.equals(camera.projectionMatrix)) return
    this.viewMatrix.copy(camera.matrixWorld)
    this.projectionMatrix.copy(camera.projectionMatrix)
    this.dirty = false
    this.drawnUt = this.currentUt
    const frameState = replayFrameAt(replay, this.currentUt)
    if (timeChanged) {
      for (const [name, planet] of this.planets) {
        const body = replay.bodies.get(name)
        if (!body) continue
        const rotation = toRenderQuat(bodyRotationAt(body, this.frameUt))
        planet.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
        planet.update(dt)
      }
    }
    this.updateSky()

    const labelBoxes: Array<{
      visual: VesselVisual
      selected: boolean
      box: LabelBox
      anchorX: number
      anchorY: number
    }> = []
    const modelScale = snapModelScale(this.displaySettings.modelScaleIndex)

    for (const visual of this.visuals.values()) {
      const selected = visual.vessel.id === this.selectedId
      const state = frameState.sample(visual.vessel)
      const vessel = visual.vessel
      if (!vessel.transient && !visual.detachedCore &&
          (visual.stackEnd !== null || (vessel.parentId && vessel.separatedUt != null)) &&
          !this.getCustomModel(vessel.id)) {
        const role = modelRoleAt(vessel, this.currentUt, visual.stackEnd)
        if (role !== visual.markerRole) {
          visual.markerRole = role
          this.replaceMarker(visual, this.builtInMarker(replay, vessel, visual.color, role, false))
        }
      }
      const side = frameState.side(visual.vessel)
      if (side !== visual.side) {
        visual.side = side
        visual.color = parseInt(
          displayColorHex({ ...visual.vessel, side }, visual.index).slice(1),
          16,
        )
        setVesselMarkerColor(visual.marker, visual.color)
        const trailMaterial = visual.trail.material as THREE.ShaderMaterial
        if (trailMaterial.uniforms?.uColor) trailMaterial.uniforms.uColor.value.setHex(visual.color)
        const lineMaterial = visual.trailLine.material as THREE.LineBasicMaterial
        lineMaterial.color?.setHex(visual.color)
        if (visual.wall) {
          const wallMaterial = visual.wall.material as THREE.ShaderMaterial
          if (wallMaterial.uniforms?.wallColor) {
            wallMaterial.uniforms.wallColor.value.setHex(visual.color)
          }
        }
        for (const sideClass of ['side-blue', 'side-red', 'side-neutral']) {
          visual.label.classList.remove(sideClass)
        }
        visual.label.classList.add(`side-${side}`)
        visual.label.style.setProperty('--vessel-color', `#${visual.color.toString(16).padStart(6, '0')}`)
      }
      const lastUt = visual.fadeStartUt
      const started = this.currentUt >= visual.firstUt
      const fade = !started
        ? 0
        : this.currentUt <= lastUt
          ? 1
          : THREE.MathUtils.clamp(1 - (this.currentUt - lastUt) / MODEL_FADE_SECONDS, 0, 1)
      const markerVisible = state !== null && fade > 0
      visual.marker.visible = markerVisible
      visual.trail.visible = state !== null && fade > 0
      visual.trailLine.visible = state !== null && fade > 0
      visual.arrows.group.visible = false
      if (visual.wall) visual.wall.visible = false
      setMarkerOpacity(visual.marker, fade)
      const threat = this.threatDomes.get(visual.vessel.id)
      if (!state) {
        if (threat) {
          threat.dome.visible = false
          if (threat.ring) threat.ring.visible = false
        }
        visual.label.classList.add('is-hidden')
        visual.leader.hidden = true
        continue
      }
      const position = this.positionOf(state, visual.vessel)
      visual.marker.position.copy(position)
      const bodyName = state.body ?? visual.vessel.body
      const bodyDef = replay.bodies.get(bodyName)
      const bodyFrame = bodyFrameAt(replay, bodyName, this.frameUt)
      const bodyCenter = new THREE.Vector3(
        bodyFrame.position.x,
        bodyFrame.position.y,
        bodyFrame.position.z,
      )
      // A submerged wreck is inside the planet sphere, but its label should
      // still be available when the camera is looking at that local area.
      if (threat) {
        const up = position.clone().sub(bodyCenter)
        if (up.lengthSq() > 1e-6) up.normalize()
        else up.set(0, 1, 0)
        const ground = bodyCenter.clone().addScaledVector(up, bodyDef?.radius ?? 600_000)
        updateThreatVisual(threat, ground, up, this.displaySettings.showThreatCircles && fade > 0)
      }

      const labelOccluded = state.alt < 0
        ? false
        : bodyDef
          ? isOccludedBySphere(
              this.rig.camera.position,
              position,
              bodyCenter,
              bodyDef.radius,
            )
          : false

      const trailFrame = toRenderFrame(bodyFrameAt(replay, visual.trailBody, this.frameUt))
      visual.trail.position.set(trailFrame.position.x, trailFrame.position.y, trailFrame.position.z)
      visual.trail.quaternion.set(
        trailFrame.quat.x,
        trailFrame.quat.y,
        trailFrame.quat.z,
        trailFrame.quat.w,
      )
      visual.trailLine.position.copy(visual.trail.position)
      visual.trailLine.quaternion.copy(visual.trail.quaternion)

      const frame = bodyFrameAt(replay, state.body ?? visual.vessel.body, this.frameUt)
      const worldQuat = multiplyQuat(toRenderQuat(frame.quat), toRenderQuat(state.q))
      visual.marker.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w)

      const distance = this.rig.camera.position.distanceTo(position)
      const scale = markerScale({
        mode: this.rig.mode,
        distance,
        satelliteSpan: this.rig.zoom,
        transient: visual.vessel.transient,
        modelScale,
      })
      visual.marker.scale.setScalar(scale)

      visual.arrows.group.position.copy(position)
      const bodyQuat = toRenderQuat(frame.quat)
      visual.arrows.group.quaternion.set(
        bodyQuat.x,
        bodyQuat.y,
        bodyQuat.z,
        bodyQuat.w,
      )
      visual.arrows.update(
        state,
        this.displaySettings.showVectors && fade > 0,
        THREE.MathUtils.clamp(distance * 0.00055, 250, 120_000),
      )

      // Draw only the recorded past; samples after the playback head are hidden.
      const windowSec = Math.max(1, this.displaySettings.trailSeconds)
      for (const object of [visual.trail, visual.trailLine, visual.wall]) {
        const geometry = object?.geometry
        if (!geometry?.userData.clipByTime) continue
        const time = geometry.getAttribute('aTime')
        const index = geometry.index
        const stride = index ? 6 : 2
        const now = this.currentUt - geometry.userData.timeOrigin
        const range = trailDrawRange(i => time.getX(index ? index.getX(i) : i),
          Math.floor((index?.count ?? time.count) / stride), stride, now - windowSec, now)
        geometry.setDrawRange(range.start, range.count)
      }
      const baseHalfWidth = visual.vessel.transient ? 0.8 : 14
      const metresPerPixel =
        this.rig.mode === 'satellite'
          ? this.rig.zoom / Math.max(1, this.height)
          : (2 *
              distance *
              Math.tan(((this.rig.camera as THREE.PerspectiveCamera).fov * Math.PI) / 360)) /
            Math.max(1, this.height)
      // Keep the head at the model centre; the fragment-shader time cutoff
      // already draws the ribbon up to the current instant.
      const headTrim = 0
      visual.headTrim = headTrim
      updateTrailStyle(visual.trail, {
        halfWidth: trailHalfWidth(baseHalfWidth * scale, metresPerPixel),
        now: this.currentUt - headTrim,
        window: windowSec,
        // Fade across the whole visible trail: the oldest end is transparent
        // even when the recording has not yet filled the selected window.
        tailFade: Math.min(10, windowSec),
        headFade: Math.min(0.5, Math.max(0.1, windowSec * 0.01)),
        opacity: (selected ? 0.62 : 0.36) * fade,
      })
      updateTrailLine(visual.trailLine, {
        now: this.currentUt - headTrim,
        window: windowSec,
        tailFade: Math.min(10, windowSec),
        opacity: (selected ? 0.72 : 0.45) * fade,
      })
      if (visual.wall) {
        // A 60 s curtain at orbital speed is tens of kilometres tall and
        // covers the whole view; keep the wall for low-altitude flight.
        const wallAltitude = state.alt ?? 0
        visual.wall.visible =
          fade > 0 &&
          wallAltitude < 25_000 &&
          shouldShowHeightWall(this.rig.mode, this.heightWallSetting) &&
          (this.heightWallSetting === 'all' || selected)
        visual.wall.position.copy(visual.trail.position)
        visual.wall.quaternion.copy(visual.trail.quaternion)
        if (visual.wall.visible) {
          this.syncWallMetric(visual)
          updateHeightWallStyle(visual.wall, {
            now: this.currentUt - visual.headTrim,
            window: windowSec,
            tailFade: Math.min(10, windowSec),
            headFade: Math.min(0.5, Math.max(0.1, windowSec * 0.01)),
            opacity: selected ? 0.55 : 0.3,
          })
        }
      }

      visual.label.classList.toggle('is-selected', selected)
      visual.label.classList.toggle(`side-${visual.side}`, true)
      visual.label.style.opacity = String(fade)
      visual.leader.style.opacity = String(fade)
      if (!this.displaySettings.showLabels || fade <= 0 || labelOccluded) {
        visual.label.classList.add('is-hidden')
        visual.leader.hidden = true
        continue
      }

      const settings = selected ? this.selectedLabel : this.unselectedLabel
      const units = {
        altitude: this.displaySettings.altitudeUnit,
        speedDistance: this.displaySettings.speedDistanceUnit,
      }
      const lines = visual.vessel.transient && !selected
        ? [visual.vessel.name]
        : labelLines(visual.vessel, state, settings, units)
      if (lines.length === 0) {
        visual.label.classList.add('is-hidden')
        visual.leader.hidden = true
        continue
      }
      const labelText = lines.join('\n')
      if (visual.labelText !== labelText) {
        visual.labelText = labelText
        visual.label.replaceChildren(
          ...lines.map((text) => {
            const line = document.createElement('span')
            line.className = 'label-line'
            line.textContent = text
            return line
          }),
        )
      }

      const projected = position.clone().project(this.rig.camera)
      const visible =
        projected.z < 1 &&
        projected.z > -1 &&
        Math.abs(projected.x) < 1.2 &&
        Math.abs(projected.y) < 1.2
      if (!visible) {
        visual.label.classList.add('is-hidden')
        visual.leader.hidden = true
        continue
      }
      const x = (projected.x * 0.5 + 0.5) * this.width
      const y = (-projected.y * 0.5 + 0.5) * this.height
      const labelScale = settings.scale ?? 1
      const width = Math.max(
        80,
        Math.max(...lines.map((line) => line.length), 1) * 7 + 16,
      )
      const height = Math.max(20, lines.length * 16 + 6)
      // Tacview-style label layout: labels start up and to the right of the
      // model. The global layout pass below moves them apart across every
      // team and neutral vessel, so no fixed per-index tier is needed.
      const scaledWidth = width * labelScale
      const scaledHeight = height * labelScale
      const left = x + 28
      const bottom = y - 34
      labelBoxes.push({
        visual,
        selected,
        anchorX: x,
        anchorY: y,
        box: {
          x: left,
          y: bottom - scaledHeight,
          width: scaledWidth,
          height: scaledHeight,
          distance,
          id: visual.vessel.id,
          selected,
        },
      })
    }

    for (const sprite of this.activeKillMarkers) sprite.visible = false
    this.activeKillMarkers = []
    const killStart = eventBound(this.killMarkers, marker => marker.ut < this.currentUt - 1.6)
    for (let i = killStart; i < this.killMarkers.length; i++) {
      const marker = this.killMarkers[i]
      const { sprite, vesselId, ut } = marker
      if (ut > this.currentUt) break
      const visual = this.visuals.get(vesselId)
      const state = marker.state ??= visual ? sampleVessel(visual.vessel, ut, replay.bodies) : null
      const age = this.currentUt - ut
      if (!visual || !state) continue
      const position = this.positionOf(state, visual.vessel)
      const distance = this.rig.camera.position.distanceTo(position)
      sprite.position.copy(position)
      const scale = markerScale({
        mode: this.rig.mode,
        distance,
        satelliteSpan: this.rig.zoom,
        transient: visual.vessel.transient,
        modelScale,
      })
      const spriteSize = this.rig.mode === 'satellite'
        ? this.rig.zoom * 0.006
        : (visual.vessel.transient ? 48 : 140) * scale
      sprite.scale.setScalar(spriteSize)
      const material = sprite.material as THREE.SpriteMaterial
      material.opacity = 0.55 * (1 - age / 1.6)
      sprite.visible = true
      this.activeKillMarkers.push(sprite)
    }

    resolveLabelOverlaps(
      labelBoxes.map((item) => item.box),
      this.width,
      this.height,
    )
    for (const item of labelBoxes) {
      this.placeLabel(
        item.visual,
        item.box,
        item.anchorX,
        item.anchorY,
        true,
        (item.selected ? this.selectedLabel : this.unselectedLabel).scale ?? 1,
      )
    }

    for (const { lock, line } of this.lockLines) {
      const source = this.visuals.get(lock.source)
      const target = this.visuals.get(lock.target)
      const active = this.currentUt >= lock.startUt && this.currentUt <= lock.endUt
      const involved = this.selectedId === lock.source || this.selectedId === lock.target
      if (!this.displaySettings.showLockLines || !active || !involved || !source || !target) {
        line.visible = false
        continue
      }
      const sourceState = frameState.sample(source.vessel)
      const targetState = frameState.sample(target.vessel)
      if (!sourceState || !targetState) {
        line.visible = false
        continue
      }
      const sourcePosition = this.positionOf(sourceState, source.vessel)
      const targetPosition = this.positionOf(targetState, target.vessel)
      const lockRadius =
        this.rig.mode === 'satellite'
          ? Math.max(0.5, (this.rig.zoom / Math.max(1, this.height)) * 0.8)
          : THREE.MathUtils.clamp(
              this.rig.camera.position.distanceTo(sourcePosition) * 0.0008,
              1,
              600,
            )
      const lateral = (lock.source < lock.target ? 1 : -1) * lockRadius * 2.8
      updateLockLine(line, sourcePosition, targetPosition, lockRadius, lateral)
      line.visible = true
    }

    for (const { effect, points } of this.effectBursts) {
      const age = this.currentUt - effect.ut
      const bodyName = effect.body
      const body = bodyName ? replay.bodies.get(bodyName) : null
      const countermeasure = effect.kind === 'chaff' ||
        effect.kind === 'flare' ||
        effect.kind === 'decoy' ||
        effect.kind === 'bubble'
      const enabled = this.displaySettings.showEffects &&
        countermeasure &&
        this.displaySettings.showCountermeasures
      if (!body || !bodyName || age < 0 || age > effect.life || !enabled) {
        points.visible = false
        continue
      }
      const sourceVessel = effect.source
        ? replay.vessels.find((item) => item.id === effect.source)
        : undefined
      const sourceState = sourceVessel
        ? sampleVessel(sourceVessel, effect.ut, replay.bodies)
        : null
      const effectLat = sourceState?.lat ?? effect.lat
      const effectLon = sourceState?.lon ?? effect.lon
      const effectAlt = sourceState
        ? renderAltitude(sourceState.alt, sourceState.agl)
        : effect.alt
      const bf = latLonAltToBF(effectLat, effectLon, effectAlt, body.radius)
      const frame = bodyFrameAt(replay, bodyName, this.frameUt)
      const world = bfToRenderWorld(frame, bf)
      const rotation = toRenderQuat(frame.quat)
      points.position.set(world.x, world.y, world.z)
      points.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      const distance = this.rig.camera.position.distanceTo(points.position)
      const gravity = body.gravParameter > 0
        ? body.gravParameter / Math.pow(body.radius + Math.max(0, effectAlt), 2)
        : 9.80665
      updateEffectBurst(
        effect,
        points,
        age,
        bf,
        gravity,
        'high',
      )
      const material = points.material as THREE.PointsMaterial
      const profile = (points.userData.profile as EffectProfile | undefined) ?? effectProfile(effect.kind)
      const opacity = profile.opacity
      const flicker = profile.flicker
        ? 1 - profile.flicker * 0.5 * (0.5 + 0.5 * Math.sin(age * 40 + effect.seed))
        : 1
      material.size = effectPointSize(
        distance,
        profile,
        this.rig.mode === 'satellite' ? this.rig.zoom : undefined,
        this.rig.mode === 'satellite' ? this.height : undefined,
      )
      material.opacity = Math.max(
        0,
        opacity * (1 - age / Math.max(effect.life, 0.001)) * flicker,
      )
      points.visible = true
    }

    for (const { burst, line } of this.tracerLines) {
      const body = replay.bodies.get(burst.body)
      if (!body || !this.displaySettings.showTracers) {
        line.visible = false
        continue
      }
      const frame = bodyFrameAt(replay, burst.body, this.frameUt)
      const world = bfToRenderWorld(frame, burst.originBf)
      const rotation = toRenderQuat(frame.quat)
      line.position.set(world.x, world.y, world.z)
      line.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      updateTracerObject(burst, line, this.currentUt, this.width, this.height)
    }

    if (this.eventMarkers?.group.visible) {
      const camera = this.rig.camera
      for (const mesh of this.eventMarkers.meshes) {
        const body = mesh.userData.body as string
        const bf = mesh.userData.bf as { x: number; y: number; z: number }
        const world = bfToRenderWorld(bodyFrameAt(replay, body, this.frameUt), bf)
        mesh.position.set(world.x, world.y, world.z)
        const distance = camera.position.distanceTo(mesh.position)
        mesh.scale.setScalar(THREE.MathUtils.clamp(distance * 0.012, 20, 9000))
      }
    }

    const selectedVisual = this.selectedId ? this.visuals.get(this.selectedId) : null
    this.outlinePass.selectedObjects =
      selectedVisual && selectedVisual.marker.visible ? [selectedVisual.marker] : []
    this.renderPass.camera = this.rig.camera
    this.outlinePass.renderCamera = this.rig.camera
    this.composer.render()
    this.dirty = false
  }

  private placeLabel(
    visual: VesselVisual,
    box: LabelBox,
    anchorX: number,
    anchorY: number,
    visible: boolean,
    scale: number,
  ): void {
    visual.label.classList.toggle('is-hidden', !visible)
    if (!visible) {
      visual.leader.hidden = true
      return
    }

    const left = box.x
    const bottom = box.y + box.height
    visual.label.style.left = `${left.toFixed(1)}px`
    visual.label.style.top = 'auto'
    visual.label.style.bottom = `${(this.height - bottom).toFixed(1)}px`
    visual.label.style.transform = `scale(${scale})`

    // The leader line starts at the lower-left corner of the label, matching
    // the Tacview reference, and runs to the model anchor.
    const leaderStartX = left
    const leaderStartY = bottom
    const dx = anchorX - leaderStartX
    const dy = anchorY - leaderStartY
    const length = Math.hypot(dx, dy)
    if (length < 1) {
      visual.leader.hidden = true
      return
    }

    visual.leader.hidden = false
    visual.leader.style.left = `${leaderStartX.toFixed(1)}px`
    visual.leader.style.top = `${leaderStartY.toFixed(1)}px`
    visual.leader.style.width = `${length.toFixed(1)}px`
    visual.leader.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`
  }

  render(): void {
    this.renderPass.camera = this.rig.camera
    this.outlinePass.renderCamera = this.rig.camera
    this.composer.render()
  }

  private clearContent(): void {
    this.cancelTrailDetail()
    for (const visual of this.visuals.values()) {
      this.scene.remove(visual.marker)
      this.scene.remove(visual.trail)
      this.scene.remove(visual.trailLine)
      this.scene.remove(visual.arrows.group)
      visual.arrows.dispose()
      if (visual.wall) {
        this.scene.remove(visual.wall)
        visual.wall.geometry.dispose()
        ;(visual.wall.material as THREE.Material).dispose()
      }
      disposeObject(visual.marker)
      visual.trail.geometry.dispose()
      ;(visual.trail.material as THREE.Material).dispose()
      visual.trailLine.geometry.dispose()
      ;(visual.trailLine.material as THREE.Material).dispose()
      visual.label.remove()
      visual.leader.remove()
    }
    this.visuals.clear()
    this.customModels.clear()

    for (const { dome, ring } of this.threatDomes.values()) {
      this.scene.remove(dome)
      dome.geometry.dispose()
      ;(dome.material as THREE.Material).dispose()
      if (ring) {
        this.scene.remove(ring)
        ring.geometry.dispose()
        ;(ring.material as THREE.Material).dispose()
      }
    }
    this.threatDomes.clear()

    for (const { sprite } of this.killMarkers) {
      this.scene.remove(sprite)
      ;(sprite.material as THREE.Material).dispose()
    }
    this.killMarkers = []
    this.activeKillMarkers = []

    for (const planet of this.planets.values()) {
      this.scene.remove(planet.group)
      planet.dispose()
    }
    this.planets.clear()

    for (const { line } of this.lockLines) {
      this.scene.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    this.lockLines = []

    for (const { points } of this.effectBursts) {
      this.scene.remove(points)
      points.geometry.dispose()
      ;(points.material as THREE.Material).dispose()
    }
    this.effectBursts = []

    for (const { line } of this.tracerLines) {
      this.scene.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    this.tracerLines = []

    if (this.eventMarkers) {
      this.scene.remove(this.eventMarkers.group)
      this.eventMarkers.dispose()
      this.eventMarkers = null
    }
    this.scene.clear()
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownX = event.clientX
    this.pointerDownY = event.clientY
    this.pointerDownActive = true
    this.eventClickConsumed = false
    if (!this.eventMarkers || !this.eventMarkers.group.visible || !this.onEventClick) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.rig.camera)
    const hits = this.raycaster.intersectObjects(this.eventMarkers.meshes, false)
    if (hits.length === 0) return
    const ut = hits[0].object.userData.ut
    if (typeof ut === 'number') {
      this.eventClickConsumed = true
      this.onEventClick(ut, event.timeStamp)
    }
  }

  /** Pick a vessel on a click, but not after a camera orbit/pan drag. */
  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerDownActive) return
    this.pointerDownActive = false
    if (this.eventClickConsumed || !this.onVesselPick) return
    const dx = event.clientX - this.pointerDownX
    const dy = event.clientY - this.pointerDownY
    if (Math.hypot(dx, dy) > 4) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.rig.camera)
    const markers: THREE.Object3D[] = []
    for (const visual of this.visuals.values()) {
      if (visual.marker.visible) markers.push(visual.marker)
    }
    if (markers.length === 0) return
    const hits = this.raycaster.intersectObjects(markers, true)
    for (const hit of hits) {
      const id = vesselIdFromObject(hit.object)
      if (id) {
        this.onVesselPick(id)
        return
      }
    }
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (!this.onVesselPick) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.rig.camera)
    const markers: THREE.Object3D[] = []
    for (const visual of this.visuals.values()) {
      if (visual.marker.visible) markers.push(visual.marker)
    }
    if (markers.length === 0) return
    const hits = this.raycaster.intersectObjects(markers, true)
    for (const hit of hits) {
      const id = vesselIdFromObject(hit.object)
      if (id) {
        this.onVesselPick(id)
        return
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('resize', this.handleResize)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('dblclick', this.handleDoubleClick)
    this.resizeObserver.disconnect()
    this.rig.dispose()
    this.clearContent()
    this.outlinePass.selectedObjects = []
    this.outlinePass.dispose()
    this.renderPass.dispose()
    this.outputPass.dispose()
    this.composer.dispose()
    this.skyTexture?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.replay = null
    this.onEventClick = null
    this.onVesselPick = null
  }
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function rotateVector(q: Quat, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  }
}
