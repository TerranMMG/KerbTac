import { i18n, type MessageKey } from '../i18n'
import type { Replay, ReplayEvent } from '../format/types'
import { displayColorHex, isDebrisVessel } from '../format/types'
import {
  DEFAULT_DISPLAY_SETTINGS,
  TRAIL_SIZE_STEPS,
  cloneDisplaySettings,
  formatTrailDuration,
  snapTrailSeconds,
  trailStepIndex,
  type DisplaySettings,
} from '../playback/displaySettings'
import { SPEEDS } from '../playback/clock'
import { bearingRange } from '../playback/geo'
import { aspectAngleDeg, aspectLabel } from '../playback/aspect'
import { COMBAT_EVENT_TYPES, eventBound, eventVesselId, replayEventIndex, replayFrameAt, shouldKeepSelection } from '../playback/selection'
import { displayVesselName, modelRoleAt, parentAt, stackEndUt } from '../playback/roles'
import {
  vesselFirstUt,
  vesselLastSampleUt,
  type VesselState,
} from '../playback/track'
import type { CameraMode } from '../scene/camera'
import { createDisplayMenu, type DisplayMenu } from './displayMenu'
import {
  describeEvent,
  describeEventDetail,
  formatAltitude,
  formatAngle,
  formatEventClock,
  formatGee,
  formatKspTime,
  formatMass,
  formatMissionTime,
  formatNumber,
  formatPercent,
  formatResource,
  formatSpeed,
} from './format'
import { TimelineView, timelineOffsets } from './timeline'
import { renderShell } from './shell'
import { mountModelMenu, type ModelMenuState } from './modelMenu'

export interface AppCallbacks {
  onDemo: () => void
  onFile: (file: File) => void
  onSeek: (target: number | ((ut: number) => number), inputTime: number) => void
  onTogglePlay: (inputTime: number) => void
  onSpeed: (speed: number, inputTime: number) => void
  onStepSpeed: (direction: number, inputTime: number) => void
  onCamera: (mode: CameraMode) => void
  onResetCamera: () => void
  onSelectVessel: (id: string | null) => void
  onFocusVessel: (id: string) => void
  onToggleLanguage: () => void
  onDisplaySettings?: (settings: DisplaySettings) => void
  onSaveModels?: (state: ModelMenuState) => Promise<string | undefined>
}

export interface FrameView {
  ut: number
  playing: boolean
  speed: number
  state: VesselState | null
  fps: number
  cameraMode: CameraMode
  compassDeg: number | null
}

export { SPEEDS }

type Field = 'altitude' | 'speed' | 'vs' | 'heading' | 'throttle' | 'mass' | 'gee' | 'stage' | 'situation' | 'mach'

const TELEMETRY_FIELDS: Array<{ field: Field; label: MessageKey }> = [
  { field: 'altitude', label: 'telemetry.altitude' },
  { field: 'speed', label: 'telemetry.speed' },
  { field: 'vs', label: 'telemetry.verticalSpeed' },
  { field: 'heading', label: 'telemetry.heading' },
  { field: 'throttle', label: 'telemetry.throttle' },
  { field: 'mass', label: 'telemetry.mass' },
  { field: 'gee', label: 'telemetry.gee' },
  { field: 'stage', label: 'telemetry.stage' },
  { field: 'situation', label: 'telemetry.situation' },
  { field: 'mach', label: 'telemetry.mach' },
]

const RESOURCE_FIELDS: Array<{ field: 'lf' | 'ox' | 'ec' | 'mp'; label: MessageKey }> = [
  { field: 'lf', label: 'telemetry.lf' },
  { field: 'ox', label: 'telemetry.ox' },
  { field: 'ec', label: 'telemetry.ec' },
  { field: 'mp', label: 'telemetry.mp' },
]

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

export class AppView {
  readonly viewport: HTMLElement
  readonly labelLayer: HTMLElement

  private readonly root: HTMLElement
  private readonly callbacks: AppCallbacks
  private replay: Replay | null = null
  private selectedId: string | null = null
  private readonly trailSlider: HTMLInputElement
  private readonly trailValue: HTMLElement
  private secondaryId: string | null = null
  private startUt = 0
  private missionUt0 = 0
  private endUt = 1
  private lastUt = 0
  private dataDirty = true
  private lastPlaying: boolean | null = null
  private lastSpeed: number | null = null
  private lastCompass: number | null | undefined
  private readonly listenerLifetime = new AbortController()
  private readonly unsubscribeLanguage: () => void
  private activeVesselKey = ''
  private sideVesselKey = ''
  private roleVesselKey = ''
  private readonly textCache = new WeakMap<Element, string>()
  private activeEvent = -1
  private readonly resourceMax: Record<string, number> = { lf: 0, ox: 0, ec: 0, mp: 0 }
  private helpVisible = false
  private dragDepth = 0
  private combatData = false
  private displaySettings: DisplaySettings = cloneDisplaySettings(DEFAULT_DISPLAY_SETTINGS)

  private readonly fileInput: HTMLInputElement
  private readonly fileName: HTMLElement
  private readonly primarySelect: HTMLSelectElement
  private readonly secondarySelect: HTMLSelectElement
  private readonly bearingValue: HTMLElement
  private readonly aspectValue: HTMLElement
  private readonly rangeValue: HTMLElement
  private readonly closureValue: HTMLElement
  private readonly timePanel: HTMLElement
  private readonly leftDrawer: HTMLElement
  private readonly rightDrawer: HTMLElement
  private readonly telemetrySection: HTMLElement
  private readonly displayMenu: DisplayMenu
  private readonly modelMenu: ReturnType<typeof mountModelMenu>
  private rightPanelMode: 'data' | 'display' | null = null
  private readonly vesselList: HTMLElement
  private readonly vesselCount: HTMLElement
  private readonly eventList: HTMLElement
  private readonly vesselWindow: VirtualList
  private readonly eventWindow: VirtualList
  private windowEvents: readonly ReplayEvent[] = []
  private readonly eventCount: HTMLElement
  private readonly eventFilters: HTMLElement
  private eventFilter = 'all'
  private readonly telemetry: HTMLElement
  private readonly resources: HTMLElement
  private readonly telemetryVessel: HTMLElement
  private readonly clockMission: HTMLElement
  private readonly playButton: HTMLButtonElement
  private readonly playState: HTMLElement
  private readonly playSpeed: HTMLElement
  private readonly compass: HTMLElement
  private readonly compassArrow: HTMLElement
  private readonly track: HTMLElement
  private readonly timeline: TimelineView
  private readonly speeds: HTMLElement
  private readonly empty: HTMLElement
  private readonly hudUt: HTMLElement
  private readonly hudFps: HTMLElement
  private readonly timelineElapsed: HTMLElement
  private readonly timelineRemaining: HTMLElement
  private readonly loading: HTMLElement
  private readonly loadingText: HTMLElement
  private readonly warnBadge: HTMLButtonElement
  private readonly dropOverlay: HTMLElement
  private readonly helpOverlay: HTMLElement
  private readonly summaryOverlay: HTMLElement
  private readonly summaryBody: HTMLElement
  private readonly toast: HTMLElement
  private readonly toastTitle: HTMLElement
  private readonly toastDetail: HTMLElement
  private readonly fieldElements = new Map<Field, HTMLElement>()
  private readonly combatElements = new Map<string, HTMLElement>()
  private readonly resourceValues = new Map<string, HTMLElement>()
  private readonly resourceBars = new Map<string, HTMLElement>()

  constructor(root: HTMLElement, callbacks: AppCallbacks) {
    const { signal } = this.listenerLifetime
    this.root = root
    this.callbacks = callbacks
    root.innerHTML = renderShell()

    this.viewport = query<HTMLElement>(root, '#viewport')
    this.labelLayer = query<HTMLElement>(root, '#labels')
    this.fileInput = query<HTMLInputElement>(root, '#file-input')
    this.fileName = query(root, '#file-name')
    this.primarySelect = query<HTMLSelectElement>(root, '#primary-object')
    this.secondarySelect = query<HTMLSelectElement>(root, '#secondary-object')
    this.bearingValue = query(root, '#bearing-value')
    this.aspectValue = query(root, '#aspect-value')
    this.rangeValue = query(root, '#range-value')
    this.closureValue = query(root, '#closure-value')
    this.timePanel = query(root, '#time-panel')
    this.leftDrawer = query(root, '#left-drawer')
    this.rightDrawer = query(root, '#right-drawer')
    this.telemetrySection = query(root, '.telemetry-section')
    this.syncDrawerOffsets()
    this.vesselList = query(root, '#vessel-list')
    this.vesselCount = query(root, '#vessel-count')
    this.eventList = query(root, '#events')
    this.vesselWindow = new VirtualList(this.vesselList)
    this.eventWindow = new VirtualList(this.eventList)
    this.eventCount = query(root, '#event-count')
    this.eventFilters = query(root, '#event-filters')
    this.eventFilters.addEventListener('click', (pointer) => {
      const button = (pointer.target as HTMLElement).closest<HTMLElement>('[data-filter]')
      if (!button) return
      this.eventFilter = button.dataset.filter ?? 'all'
      for (const item of this.eventFilters.querySelectorAll<HTMLElement>('[data-filter]')) {
        item.classList.toggle('is-active', item.dataset.filter === this.eventFilter)
      }
      this.renderEvents()
    }, { signal })
    this.telemetry = query(root, '#telemetry')
    this.resources = query(root, '#resources')
    this.telemetryVessel = query(root, '#telemetry-vessel')
    this.clockMission = query(root, '#clock-mission')
    this.playButton = query(root, '#btn-play')
    this.playState = query(root, '#play-state')
    this.playSpeed = query(root, '#play-speed')
    this.compass = query(root, '#compass')
    this.compassArrow = query(root, '#compass-arrow')
    this.track = query(root, '#track')
    this.timeline = new TimelineView(this.track, { onSeek: (ut, inputTime) => this.callbacks.onSeek(ut, inputTime) })
    this.speeds = query(root, '#speeds')
    this.empty = query(root, '#empty')
    this.hudUt = query(root, '#hud-ut')
    this.hudFps = query(root, '#hud-fps')
    this.trailSlider = query(root, '#trail-size')
    this.trailValue = query(root, '#trail-size-value')
    this.trailSlider.max = String(TRAIL_SIZE_STEPS.length - 1)
    this.syncTrailSlider()
    this.trailSlider.addEventListener('input', () => {
      const index = Math.max(0, Math.min(TRAIL_SIZE_STEPS.length - 1, Number(this.trailSlider.value)))
      const seconds = snapTrailSeconds(TRAIL_SIZE_STEPS[index])
      this.displaySettings = { ...this.displaySettings, trailSeconds: seconds }
      this.displayMenu.update(this.displaySettings)
      this.trailValue.textContent = formatTrailDuration(seconds)
      this.callbacks.onDisplaySettings?.(this.displaySettings)
    }, { signal })
    this.timelineElapsed = query(root, '#timeline-elapsed')
    this.timelineRemaining = query(root, '#timeline-remaining')
    this.loading = query(root, '#loading')
    this.loadingText = query(root, '#loading-text')
    this.warnBadge = query(root, '#warn-badge')
    this.warnBadge.addEventListener('click', () => {
      const warnings = (this.replay?.warnings ?? []).filter((warning) => warning.code !== 'missingOptionalColumn')
      this.showToast(i18n.t('warnings.title'), warnings.map((warning) => warning.code).join(', '))
    }, { signal })
    this.dropOverlay = query(root, '#drop-overlay')
    this.helpOverlay = query(root, '#help-overlay')
    this.summaryOverlay = query(root, '#summary-overlay')
    this.summaryBody = query(root, '#summary-body')
    this.toast = query(root, '#toast')
    this.toastTitle = query(root, '#toast-title')
    this.toastDetail = query(root, '#toast-detail')

    const menuHost = query(root, '#display-menu')
    this.displayMenu = createDisplayMenu(this.displaySettings, (next) => {
      this.displaySettings = cloneDisplaySettings(next)
      this.dataDirty = true
      this.syncTrailSlider()
      this.callbacks.onDisplaySettings?.(this.displaySettings)
    })
    menuHost.appendChild(this.displayMenu.element)
    this.displayMenu.element.hidden = true
    this.modelMenu = mountModelMenu(query(root, '#models-panel'), query(root, '#btn-models'),
      state => this.callbacks.onSaveModels?.(state) ?? Promise.reject(new Error('Export unavailable')),
      key => this.showToast(i18n.t('models.title'), i18n.t(key)),
      fileName => this.showToast(i18n.t('models.title'), i18n.t('models.downloadStarted', { fileName }), 'notice'),
      () => {
        this.rightDrawer.classList.remove('is-open')
        this.rightPanelMode = null
        this.syncDrawerOffsets()
      })

    this.buildTelemetry()
    this.buildSpeeds()
    this.wire()
    this.applyLanguage()
    this.unsubscribeLanguage = i18n.onChange(() => {
      this.dataDirty = true
      this.lastPlaying = null
      this.applyLanguage()
      this.renderVessels()
      this.renderEvents()
      this.updateFileInfo()
      this.modelMenu.refresh()
    })
  }

  dispose(): void {
    if (this.listenerLifetime.signal.aborted) return
    this.listenerLifetime.abort()
    this.unsubscribeLanguage()
    this.modelMenu.setState(null)
    this.vesselWindow.dispose()
    this.eventWindow.dispose()
    this.timeline.dispose()
    this.displayMenu.dispose()
    this.replay = null
    this.windowEvents = []
    this.root.classList.remove('has-recording', 'drawer-left-open', 'drawer-right-open')
    this.root.replaceChildren()
  }

  private buildTelemetry(): void {
    for (const { field, label } of TELEMETRY_FIELDS) {
      const row = document.createElement('div')
      row.className = 't-row'
      const labelEl = document.createElement('span')
      labelEl.className = 't-label'
      labelEl.dataset.i18n = label
      const valueEl = document.createElement('span')
      valueEl.className = 't-value'
      valueEl.textContent = '—'
      row.append(labelEl, valueEl)
      this.telemetry.appendChild(row)
      this.fieldElements.set(field, valueEl)
    }

    for (const { field, label } of RESOURCE_FIELDS) {
      const row = document.createElement('div')
      row.className = 'resource-row'
      const head = document.createElement('div')
      head.className = 'resource-head'
      const labelEl = document.createElement('span')
      labelEl.className = 'resource-label'
      labelEl.dataset.i18n = label
      const valueEl = document.createElement('span')
      valueEl.className = 'resource-value'
      valueEl.textContent = '—'
      head.append(labelEl, valueEl)
      const bar = document.createElement('div')
      bar.className = 'resource-bar'
      const fill = document.createElement('span')
      bar.appendChild(fill)
      row.append(head, bar)
      this.resources.appendChild(row)
      this.resourceValues.set(field, valueEl)
      this.resourceBars.set(field, fill)
    }

    const rows: Array<[string, MessageKey]> = [
      ['side', 'combat.side'],
      ['health', 'combat.health'],
      ['weapon', 'combat.weapon'],
      ['lock', 'combat.lock'],
      ['last', 'combat.last'],
    ]
    for (const [key, label] of rows) {
      const row = document.createElement('div')
      row.className = 't-row'
      const labelEl = document.createElement('span')
      labelEl.className = 't-label'
      labelEl.dataset.i18n = label
      const valueEl = document.createElement('span')
      valueEl.className = 't-value'
      valueEl.textContent = '—'
      row.append(labelEl, valueEl)
      this.telemetry.appendChild(row)
      this.combatElements.set(key, valueEl)
    }
  }

  private buildSpeeds(): void {
    for (const speed of SPEEDS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'speed-btn'
      button.dataset.speed = String(speed)
      button.textContent = `x${speed}`
      button.addEventListener('click', event => this.callbacks.onSpeed(speed, event.timeStamp),
        { signal: this.listenerLifetime.signal })
      this.speeds.appendChild(button)
    }
  }

  private wire(): void {
    const { signal } = this.listenerLifetime
    const click = (selector: string, handler: (event: MouseEvent) => void) =>
      query<HTMLElement>(this.root, selector).addEventListener('click', handler, { signal })
    click('#btn-open', () => this.fileInput.click())
    click('#btn-demo', () => this.callbacks.onDemo())
    click('#btn-browse', () => this.fileInput.click())
    click('#btn-lang', () => this.callbacks.onToggleLanguage())
    click('#btn-help', () => this.toggleHelp())
    click('#btn-help-close', () => this.toggleHelp(false))
    click('#btn-help-ok', () => this.toggleHelp(false))
    click('#btn-summary', () => this.toggleSummary())
    click('#btn-summary-close', () => this.toggleSummary(false))
    click('#btn-summary-ok', () => this.toggleSummary(false))
    click('#btn-toast-close', () => this.hideToast())
    click('#btn-restart', event => this.callbacks.onSeek(this.startUt, event.timeStamp))
    click('#btn-prev-event', event => this.seekAdjacentEvent(-1, event.timeStamp))
    click('#btn-next-event', event => this.seekAdjacentEvent(1, event.timeStamp))
    click('#btn-slower', event => this.callbacks.onStepSpeed(-1, event.timeStamp))
    click('#btn-faster', event => this.callbacks.onStepSpeed(1, event.timeStamp))
    click('#btn-reset-camera', () => this.callbacks.onResetCamera())
    click('#bearing-range', () => this.swapTargets())
    click('#btn-left', () => {
      this.leftDrawer.classList.toggle('is-open')
      this.syncDrawerOffsets()
    })
    click('#btn-right', () => {
      if (this.rightDrawer.classList.contains('is-open') && this.rightPanelMode === 'data') {
        this.rightDrawer.classList.remove('is-open')
        this.rightPanelMode = null
        this.syncDrawerOffsets()
        return
      }
      this.modelMenu.close()
      this.rightDrawer.classList.add('is-open')
      this.rightPanelMode = 'data'
      this.telemetrySection.hidden = false
      this.displayMenu.element.hidden = true
      this.syncDrawerOffsets()
    })
    click('#btn-display', () => {
      if (this.rightDrawer.classList.contains('is-open') && this.rightPanelMode === 'display') {
        this.rightDrawer.classList.remove('is-open')
        this.rightPanelMode = null
        this.syncDrawerOffsets()
        return
      }
      this.modelMenu.close()
      this.rightDrawer.classList.add('is-open')
      this.rightPanelMode = 'display'
      this.telemetrySection.hidden = true
      this.displayMenu.element.hidden = false
      this.syncDrawerOffsets()
    })
    this.primarySelect.addEventListener('change', () => {
      this.callbacks.onSelectVessel(this.primarySelect.value || null)
    }, { signal })
    this.secondarySelect.addEventListener('change', () => {
      this.secondaryId = this.secondarySelect.value || null
      this.updateBearingRange()
    }, { signal })
    this.playButton.addEventListener('click', event => this.callbacks.onTogglePlay(event.timeStamp), { signal })

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0]
      this.fileInput.value = ''
      if (file) this.callbacks.onFile(file)
    }, { signal })

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
      button.addEventListener('click', () => {
        const mode = button.dataset.camera as CameraMode
        this.callbacks.onCamera(mode)
      }, { signal })
    }

    this.root.addEventListener('dragover', (event) => event.preventDefault(), { signal })
    window.addEventListener('dragenter', (event) => {
      event.preventDefault()
      this.dragDepth += 1
      this.dropOverlay.hidden = false
    }, { signal })
    window.addEventListener('dragleave', (event) => {
      event.preventDefault()
      this.dragDepth = Math.max(0, this.dragDepth - 1)
      if (this.dragDepth === 0) this.dropOverlay.hidden = true
    }, { signal })
    window.addEventListener('drop', (event) => {
      event.preventDefault()
      this.dragDepth = 0
      this.dropOverlay.hidden = true
      const file = event.dataTransfer?.files?.[0]
      if (file) this.callbacks.onFile(file)
    }, { signal })
  }

  setReplay(replay: Replay, models: ModelMenuState | null = null): void {
    if (this.listenerLifetime.signal.aborted) return
    this.modelMenu.setState(models)
    this.replay = replay
    this.startUt = replay.startUt
    this.missionUt0 = replay.manifest.session.ut0 ?? this.startUt
    this.endUt = Math.max(replay.startUt + 0.001, replay.endUt)
    this.combatData = replay.events.some((event) => COMBAT_EVENT_TYPES.has(event.type))
    this.lastUt = replay.startUt
    this.dataDirty = true
    this.activeVesselKey = ''
    this.sideVesselKey = ''
    const visible = this.visibleVessels()
    const sessionName = replay.manifest.session?.name
    const candidates = replay.vessels.filter((vessel) => !isDebrisVessel(vessel))
    const primary =
      candidates.find((vessel) => vessel.name === sessionName) ??
      candidates.find((vessel) => vessel.segments.some((segment) => segment.source === 'active')) ??
      candidates.find((vessel) => vessel.kind?.startsWith('air/')) ??
      candidates.find((vessel) => !vessel.transient) ??
      candidates[0] ??
      visible[0]
    this.selectedId = primary?.id ?? null
    this.secondaryId = visible.find(vessel => !isDebrisVessel(vessel) && vessel.id !== this.selectedId)?.id ?? null
    this.activeEvent = -1

    this.root.classList.add('has-recording')
    this.leftDrawer.classList.remove('is-open')
    this.rightDrawer.classList.remove('is-open')
    this.rightPanelMode = null
    this.displayMenu.element.hidden = true
    this.syncDrawerOffsets()
    this.empty.hidden = true
    this.timePanel.hidden = false

    this.computeResourceMax()
    this.populateObjectSelects()
    this.renderVessels()
    this.renderEvents()
    this.updateFileInfo()
    this.timeline.setReplay(replay)
    this.timeline.setSelection(this.selectedId)
    const offsets = timelineOffsets(replay.startUt, this.missionUt0, this.endUt)
    this.setText(this.timelineElapsed, offsets.elapsed)
    this.setText(this.timelineRemaining, offsets.remaining)

    const warnings = replay.warnings.filter((warning) => warning.code !== 'missingOptionalColumn')
    if (warnings.length > 0) {
      this.warnBadge.hidden = false
      this.warnBadge.textContent = `⚠ ${warnings.length}`
      this.warnBadge.title = warnings.map((warning) => warning.code).join('\n')
    } else {
      this.warnBadge.hidden = true
    }

    if (this.selectedId) this.setSelected(this.selectedId)
  }

  private computeResourceMax(): void {
    for (const key of Object.keys(this.resourceMax)) this.resourceMax[key] = 0
    for (const vessel of this.replay?.vessels ?? []) {
      for (const segment of vessel.segments) {
        const samples = segment.samples
        if (!samples) continue
        for (const key of Object.keys(this.resourceMax) as Array<'lf' | 'ox' | 'ec' | 'mp'>) {
          const column = samples[key]
          if (!column) continue
          for (let i = 0; i < column.length; i += 1) {
            if (column[i] > this.resourceMax[key]) this.resourceMax[key] = column[i]
          }
        }
      }
    }
  }

  private updateFileInfo(): void {
    if (!this.replay) return
    this.fileName.textContent = this.replay.fileName
  }

  private visibleVessels() {
    if (!this.replay) return []
    const frame = replayFrameAt(this.replay, this.lastUt)
    return this.replay.vessels.filter((vessel) => {
      if (isDebrisVessel(vessel)) {
        const first = vesselFirstUt(vessel)
        const last = vesselLastSampleUt(vessel)
        if (first === null || last === null) return false
        return this.lastUt >= first && this.lastUt <= last + 1.2
      }
      const first = vesselFirstUt(vessel)
      if (first === null || this.lastUt < first) return false
      const terminal = frame.events.terminalUt(vessel)
      if (terminal !== null && this.lastUt > terminal) return false
      if (frame.isActive(vessel)) {
        return true
      }
      return vessel.transient && terminal !== null
    })
  }

  private populateObjectSelects(visible = this.visibleVessels()): void {
    const vessels = visible.filter(vessel => !isDebrisVessel(vessel))
    const actors = this.replay?.actors ?? []
    const actorById = new Map(actors.map((actor) => [actor.id, actor]))

    this.primarySelect.textContent = ''
    const primaryNone = document.createElement('option')
    primaryNone.value = ''
    primaryNone.textContent = '—'
    this.primarySelect.appendChild(primaryNone)
    this.appendObjectOptions(this.primarySelect, vessels, actorById, null)
    const selectedVessel = this.replay?.vessels.find((vessel) => vessel.id === this.selectedId)
    if (selectedVessel && !vessels.some((vessel) => vessel.id === selectedVessel.id)) {
      const option = document.createElement('option')
      option.value = selectedVessel.id
      const first = vesselFirstUt(selectedVessel)
      const ended = first !== null && this.lastUt >= first
      option.textContent = ended
        ? `${selectedVessel.callsign ?? selectedVessel.name} · ${i18n.t('vessel.ended')}`
        : selectedVessel.callsign ?? selectedVessel.name
      this.primarySelect.appendChild(option)
    }
    this.primarySelect.value = this.selectedId ?? ''

    this.secondarySelect.textContent = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '—'
    this.secondarySelect.appendChild(none)
    this.appendObjectOptions(this.secondarySelect, vessels, actorById, this.selectedId)
    if (this.secondaryId === this.selectedId) this.secondaryId = null
    if (this.secondaryId !== null && !vessels.some(v => v.id === this.secondaryId)) this.secondaryId = null
    this.secondarySelect.value = this.secondaryId ?? ''
    this.secondaryId = this.secondarySelect.value || null
    this.updateBearingRange()
  }

  private appendObjectOptions(
    select: HTMLSelectElement,
    vessels: ReturnType<AppView['visibleVessels']>,
    actorById: Map<string, { id: string; parent: string | null; startUt: number; name: string; weapon: string | null }>,
    excludeId: string | null,
  ): void {
    const used = new Set<string>()
    const add = (vessel: (typeof vessels)[number], indent: boolean) => {
      if (vessel.id === excludeId || used.has(vessel.id)) return
      used.add(vessel.id)
      const option = document.createElement('option')
      option.value = vessel.id
      if (indent) {
        const actor = actorById.get(vessel.id)
        const launch = actor ? this.signedEventClock(actor.startUt) : ''
        option.textContent = `${launch}  ${vessel.name}`
      } else {
        option.textContent = vessel.callsign ?? vessel.name
      }
      select.appendChild(option)
    }

    for (const vessel of vessels) {
      if (vessel.transient) continue
      add(vessel, false)
      for (const child of vessels) {
        const actor = actorById.get(child.id)
        if (child.transient && actor?.parent === vessel.id) add(child, true)
      }
    }
    for (const vessel of vessels) {
      if (!vessel.transient || used.has(vessel.id)) continue
      add(vessel, actorById.has(vessel.id))
    }
  }

  private updateBearingRange(): void {
    const replay = this.replay
    const clear = () => {
      this.setText(this.bearingValue, '—')
      this.setText(this.aspectValue, '—')
      this.setText(this.rangeValue, '—')
      this.setText(this.closureValue, '—')
    }
    if (!replay || !this.selectedId || !this.secondaryId) {
      clear()
      return
    }
    const primary = replay.vessels.find((vessel) => vessel.id === this.selectedId)
    const secondary = replay.vessels.find((vessel) => vessel.id === this.secondaryId)
    if (!primary || !secondary) {
      clear()
      return
    }
    const frame = replayFrameAt(replay, this.lastUt)
    const from = frame.isActive(primary) ? frame.sample(primary) : null
    const to = frame.isActive(secondary) ? frame.sample(secondary) : null
    if (!from || !to || from.body !== to.body) {
      clear()
      return
    }
    const radius = replay.bodies.get(from.body)?.radius ?? 600_000
    const result = bearingRange(
      { lat: from.lat, lon: from.lon, alt: from.alt },
      { lat: to.lat, lon: to.lon, alt: to.alt },
      radius,
    )
    const unit = this.displaySettings.speedDistanceUnit
    const rangeText =
      unit === 'nautical'
        ? `${(result.rangeKm / 1.852).toFixed(1)} nmi`
        : unit === 'imperial'
          ? `${(result.rangeKm / 1.609344).toFixed(1)} mi`
          : result.rangeKm >= 10
            ? `${result.rangeKm.toFixed(1)} km`
            : `${(result.rangeKm * 1000).toFixed(0)} m`
    const dx = to.bf.x - from.bf.x
    const dy = to.bf.y - from.bf.y
    const dz = to.bf.z - from.bf.z
    const span = Math.hypot(dx, dy, dz)
    let closureText = '—'
    if (span > 1e-6 && from.velocity && to.velocity) {
      const rvx = to.velocity.x - from.velocity.x
      const rvy = to.velocity.y - from.velocity.y
      const rvz = to.velocity.z - from.velocity.z
      const closing = -(rvx * dx + rvy * dy + rvz * dz) / span
      const value =
        unit === 'nautical' ? closing * 1.943844 : unit === 'imperial' ? closing * 2.236936 : closing
      const suffix = unit === 'nautical' ? 'kn' : unit === 'imperial' ? 'mph' : 'm/s'
      closureText = `${closing >= 0 ? '+' : ''}${value.toFixed(1)} ${suffix}`
    }
    const aspectAngle = aspectAngleDeg(to.heading ?? 0, result.bearingDeg)
    const aspect = aspectLabel(aspectAngle)
    this.setText(this.bearingValue, `${result.bearingDeg.toFixed(0).padStart(3, '0')}°`)
    this.setText(this.aspectValue, `${aspect} ${aspectAngle.toFixed(0)}°`)
    this.setText(this.rangeValue, rangeText)
    this.setText(this.closureValue, closureText)
  }

  private kindLabel(kind: string | null | undefined): string {
    if (!kind) return ''
    const key = `kind.${kind.replace('/', '.')}`
    const translated = i18n.t(key as never)
    return translated === key ? kind : translated
  }

  private renderVessels(vessels = this.visibleVessels()): void {
    this.vesselCount.textContent = String(vessels.length)
    if (!vessels.length) {
      const empty = document.createElement('p')
      empty.className = 'panel-empty'
      empty.textContent = i18n.t('vessel.empty')
      this.vesselWindow.replace([{ height: 40, render: () => empty }])
      return
    }

    const frame = replayFrameAt(this.replay!, this.lastUt)
    const sideOrder: Record<string, number> = { blue: 0, red: 1, neutral: 2 }
    const actors = this.replay?.actors ?? []
    const actorById = new Map(actors.map((actor) => [actor.id, actor]))
    const existing = new Set(vessels.map((vessel) => vessel.id))
    const stageIds = new Set(
      vessels
        .filter((vessel) => {
          const parent = parentAt(vessel, this.lastUt)
          return !vessel.transient && parent && existing.has(parent)
        })
        .map((vessel) => vessel.id),
    )
    const parents = vessels
      .filter((vessel) => !vessel.transient && !stageIds.has(vessel.id))
      .sort((a, b) => {
        const side =
          (sideOrder[frame.side(a)] ?? 2) - (sideOrder[frame.side(b)] ?? 2)
        return side !== 0 ? side : a.name.localeCompare(b.name)
      })
    const ordered: typeof vessels = []
    const used = new Set<string>()
    for (const parent of parents) {
      ordered.push(parent)
      used.add(parent.id)
      const startOf = (vessel: (typeof vessels)[number]): number =>
        actorById.get(vessel.id)?.startUt ??
        vessel.separatedUt ??
        vessel.segments[0]?.startUt ??
        0
      const children = vessels
        .filter((child) => {
          if (child.transient) return actorById.get(child.id)?.parent === parent.id
          return parentAt(child, this.lastUt) === parent.id
        })
        .sort((a, b) => startOf(a) - startOf(b))
      for (const child of children) {
        ordered.push(child)
        used.add(child.id)
      }
    }
    for (const vessel of vessels) {
      if (!used.has(vessel.id)) ordered.push(vessel)
    }

    const rows: ListRow[] = []
    const indices = new Map(vessels.map((vessel, index) => [vessel, index]))
    let currentSide = ''
    ordered.forEach((vessel) => {
      const side = frame.side(vessel)
      if (side !== currentSide) {
        currentSide = side
        rows.push({ height: 20, render: () => {
          const header = document.createElement('div')
          header.className = `vessel-group vessel-group-${side}`
          header.textContent = i18n.t(`side.${side}` as MessageKey)
          return header
        } })
      }

      rows.push({ height: 46, focusable: true, render: () => {
      const index = indices.get(vessel)!
      const button = document.createElement('button')
      button.type = 'button'
      const isStageChild = !vessel.transient && Boolean(parentAt(vessel, this.lastUt))
      button.className = `vessel-card vessel-card-${side}${isStageChild ? ' vessel-card-child' : ''}`
      button.dataset.vessel = vessel.id
      button.classList.toggle('is-selected', this.selectedId === vessel.id)
      button.title = i18n.t('vessel.followHint')

      const dot = document.createElement('span')
      dot.className = 'vessel-dot'
      dot.style.background = displayColorHex({ ...vessel, side }, index)

      const meta = document.createElement('span')
      meta.className = 'vessel-meta'
      const name = document.createElement('span')
      name.className = 'vessel-name'
      const actor = actorById.get(vessel.id)
      name.textContent = actor
        ? `${this.signedEventClock(actor.startUt)}  ${displayVesselName(vessel)}`
        : isStageChild
          ? `${this.signedEventClock(vessel.separatedUt ?? vessel.segments[0]?.startUt ?? this.startUt)}  ${displayVesselName(vessel)}`
          : displayVesselName(vessel)
      const sub = document.createElement('span')
      sub.className = 'vessel-sub'
      const count = vessel.segments.reduce((total, segment) => total + (segment.samples?.length ?? 0), 0)
      const role = modelRoleAt(vessel, this.lastUt, stackEndUt(this.replay?.vessels ?? [], vessel))
      const kind = role
        ? this.kindLabel(role)
        : isDebrisVessel(vessel)
          ? i18n.t('kind.debris')
          : this.kindLabel(vessel.kind)
      sub.textContent = `${kind || vessel.type} · ${vessel.body} · ${i18n.t('vessel.samples', { count: formatNumber(count) })}`
      meta.append(name, sub)

      this.updateHealthBar(meta, vessel)

      button.append(dot, meta)
      button.addEventListener('click', () => {
        if (!this.listenerLifetime.signal.aborted) this.callbacks.onSelectVessel(vessel.id)
      })
      return button
      } })
    })
    this.vesselWindow.replace(rows)
  }

  private updateHealthBar(meta: HTMLElement, vessel: Replay['vessels'][number]): void {
    const frame = this.replay ? replayFrameAt(this.replay, this.lastUt) : null
    const health = this.hasCombatData() && this.displaySettings.showHealthBars
      ? frame?.sample(vessel)?.health : null
    let bar = meta.querySelector<HTMLElement>('.vessel-health')
    if (health == null || !Number.isFinite(health) || health >= 0.999) {
      bar?.remove()
      return
    }
    if (!bar) {
      bar = document.createElement('span')
      bar.className = 'vessel-health'
      const fill = document.createElement('span')
      fill.className = 'vessel-health-fill'
      bar.append(fill)
      meta.append(bar)
    }
    const fill = bar.firstElementChild as HTMLElement
    const width = `${Math.max(0, Math.min(1, health)) * 100}%`
    if (fill.style.width !== width) fill.style.width = width
  }

  private signedEventClock(ut: number): string {
    return `${ut < this.missionUt0 ? '-' : '+'}${formatMissionTime(ut, this.missionUt0).slice(3)}`
  }

  /** No combat events means no health UI, even if BDA wrote a health column. */
  private hasCombatData(): boolean {
    return this.combatData
  }

  private matchesEventFilter(type: string): boolean {
    if (this.eventFilter === 'all') return true
    if (this.eventFilter === 'combat') return COMBAT_EVENT_TYPES.has(type)
    const flight = new Set([
      'flight_start',
      'flight_end',
      'takeoff',
      'touchdown',
      'landing',
      'gear_up',
      'gear_down',
      'stage',
      'engine_ignition',
      'engine_shutdown',
      'soi_change',
      'crash',
      'destroyed',
    ])
    if (this.eventFilter === 'flight') return flight.has(type)
    return !flight.has(type) && !COMBAT_EVENT_TYPES.has(type)
  }

  private visibleEvents(): readonly ReplayEvent[] {
    const all = this.replay ? replayEventIndex(this.replay).forVessel(this.selectedId) : []
    return this.eventFilter === 'all' ? all : all.filter((event) => this.matchesEventFilter(event.type))
  }

  private renderEvents(): void {
    this.dataDirty = true
    this.activeEvent = -1
    const events = this.visibleEvents()
    this.windowEvents = events
    this.eventCount.textContent = String(events.length)
    if (!events.length) {
      const empty = document.createElement('p')
      empty.className = 'panel-empty'
      empty.textContent = i18n.t('events.empty')
      this.eventWindow.replace([{ height: 40, render: () => empty }])
      return
    }
    this.eventWindow.replace(events.map((event, index) => ({ height: 34, focusable: true, render: () => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'event-row'
      row.dataset.type = event.type
      row.dataset.index = String(index)
      row.classList.toggle('is-active', index === this.activeEvent)
      row.title = i18n.t('events.seekHint')

      const time = document.createElement('span')
      time.className = 'event-time'
      time.textContent = formatEventClock(event.ut, this.missionUt0)

      const dot = document.createElement('span')
      dot.className = 'event-dot'
      const dotClass = eventDotClass(event.type)
      if (dotClass) dot.classList.add(dotClass)

      const body = document.createElement('span')
      body.className = 'event-body'
      const label = document.createElement('span')
      label.className = 'event-label'
      label.textContent = describeEvent(event, i18n)
      const detail = document.createElement('span')
      detail.className = 'event-detail'
      detail.textContent = describeEventDetail(event, i18n)
      body.append(label, detail)

      row.append(time, dot, body)
      row.addEventListener('click', pointer => {
        if (!this.listenerLifetime.signal.aborted) this.callbacks.onSeek(event.ut, pointer.timeStamp)
      })
      row.addEventListener('dblclick', (pointer) => {
        if (this.listenerLifetime.signal.aborted) return
        pointer.preventDefault()
        const id = eventVesselId(event)
        if (id) this.callbacks.onFocusVessel(id)
      })
      return row
    } })))
  }

  get selectedVesselId(): string | null {
    return this.selectedId
  }

  setSelected(id: string | null): void {
    const previous = this.selectedId
    this.selectedId = id
    this.dataDirty = true
    if (id !== null && this.secondaryId === id) {
      this.secondaryId = previous && previous !== id ? previous : null
    }
    this.populateObjectSelects()
    for (const card of this.vesselList.querySelectorAll<HTMLElement>('.vessel-card')) {
      card.classList.toggle('is-selected', id !== null && card.dataset.vessel === id)
    }
    const vessel = id ? this.replay?.vessels.find((item) => item.id === id) : null
    this.telemetryVessel.textContent = vessel?.name ?? ''
    this.activeEvent = -1
    this.renderEvents()
    this.timeline.setSelection(id)
    this.updateBearingRange()
  }

  setLoading(visible: boolean, text?: string): void {
    this.loading.hidden = !visible
    if (text) this.loadingText.textContent = text
  }

  showToast(title: string, detail: string, kind: 'error' | 'notice' = 'error'): void {
    this.toast.classList.toggle('is-notice', kind === 'notice')
    this.toastTitle.textContent = title
    this.toastDetail.textContent = detail
    this.toast.hidden = false
  }

  hideToast(): void {
    this.toast.hidden = true
  }

  toggleHelp(force?: boolean): void {
    this.helpVisible = force ?? !this.helpVisible
    if (this.helpVisible) this.modelMenu.close()
    this.helpOverlay.hidden = !this.helpVisible
  }

  private toggleSummary(force?: boolean): void {
    const open = force ?? this.summaryOverlay.hidden
    if (open) this.modelMenu.close()
    this.summaryOverlay.hidden = !open
    if (open) this.renderSummary()
  }

  private renderSummary(): void {
    const replay = this.replay
    if (!replay) {
      this.summaryBody.textContent = i18n.t('summary.empty')
      return
    }

    const counts = new Map<string, number>()
    for (const event of replay.events) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
    }
    const vessels = replay.vessels.filter((vessel) => !vessel.transient)
    const blueLosses = replay.events.filter(
      (event) =>
        (event.type === 'kill' || event.type === 'destroyed' || event.type === 'crash') &&
        replay.vessels.find((vessel) => vessel.id === event.vessel)?.side === 'blue',
    ).length
    const redLosses = replay.events.filter(
      (event) =>
        (event.type === 'kill' || event.type === 'destroyed' || event.type === 'crash') &&
        replay.vessels.find((vessel) => vessel.id === event.vessel)?.side === 'red',
    ).length

    const rows: Array<[string, string]> = [
      ['duration', formatMissionTime(replay.endUt, replay.startUt)],
      ['vessels', String(vessels.length)],
      ['shots', String((counts.get('weapon_release') ?? 0) + (counts.get('gunfire') ?? 0))],
      ['hits', String(counts.get('hit') ?? 0)],
      ['kills', String(counts.get('kill') ?? 0)],
      ['gunfire', String(counts.get('gunfire') ?? 0)],
      ['countermeasures', String((counts.get('chaff') ?? 0) + (counts.get('flare') ?? 0) + (counts.get('countermeasure') ?? 0))],
      ['explosions', String((counts.get('impact') ?? 0) + (counts.get('proximity_detonation') ?? 0))],
      ['blueLosses', String(blueLosses)],
      ['redLosses', String(redLosses)],
    ]

    this.summaryBody.textContent = ''
    for (const [key, value] of rows) {
      const row = document.createElement('div')
      row.className = 'summary-row'
      const label = document.createElement('span')
      label.className = 'summary-label'
      label.textContent = i18n.t(`summary.${key}` as MessageKey)
      const number = document.createElement('span')
      number.className = 'summary-value'
      number.textContent = value
      row.append(label, number)
      this.summaryBody.appendChild(row)
    }
  }

  get helpOpen(): boolean {
    return this.helpVisible
  }

  update(frame: FrameView): void {
    const replay = this.replay
    if (!replay) return
    this.setText(this.hudFps, `${formatNumber(frame.fps, 0)} fps`)
    if (this.lastPlaying !== frame.playing) {
      this.lastPlaying = frame.playing
      this.setText(this.playState, frame.playing ? '' : i18n.t('timeline.paused'))
      this.playButton.classList.toggle('is-playing', frame.playing)
      this.playButton.title = i18n.t(frame.playing ? 'timeline.pause' : 'timeline.play')
      this.playButton.setAttribute('aria-label', this.playButton.title)
    }
    if (this.lastSpeed !== frame.speed) {
      this.lastSpeed = frame.speed
      this.setText(this.playSpeed, `x${frame.speed}`)
      for (const button of this.speeds.querySelectorAll<HTMLElement>('.speed-btn')) {
        button.classList.toggle('is-active', Number(button.dataset.speed) === frame.speed)
      }
    }
    const compass = frame.cameraMode === 'satellite' ? null : frame.compassDeg
    if (compass !== this.lastCompass) {
      this.lastCompass = compass
      this.compass.hidden = compass === null
      if (compass !== null) this.compassArrow.style.transform = `rotate(${compass}deg)`
    }
    if (this.lastUt === frame.ut && !this.dataDirty) return
    this.lastUt = frame.ut
    this.dataDirty = false
    const playback = replayFrameAt(replay, frame.ut)
    const visible = this.visibleVessels()
    const activeKey = visible.map((vessel) => vessel.id).join('|')
    const sideKey = visible
      .map((vessel) => `${vessel.id}:${playback.side(vessel)}`)
      .join('|')
    const roleKey = visible
      .map((vessel) => `${vessel.id}:${modelRoleAt(vessel, frame.ut, stackEndUt(this.replay?.vessels ?? [], vessel))}:${parentAt(vessel, frame.ut)}`)
      .join('|')
    if (
      activeKey !== this.activeVesselKey ||
      sideKey !== this.sideVesselKey ||
      roleKey !== this.roleVesselKey
    ) {
      this.activeVesselKey = activeKey
      this.sideVesselKey = sideKey
      this.roleVesselKey = roleKey
      this.renderVessels(visible)
      this.populateObjectSelects(visible)
      const stillVisible = visible.some((vessel) => vessel.id === this.selectedId)
      const selected = this.replay?.vessels.find((vessel) => vessel.id === this.selectedId)
      // A null selection is intentional after the user pans the satellite map;
      // never auto-pick the first visible vessel, or the camera snaps back to
      // the recording's initial aircraft when the timeline changes.
      if (
        this.selectedId !== null &&
        !shouldKeepSelection(selected, stillVisible)
      ) {
        const next = visible[0]
        if (next) this.callbacks.onSelectVessel(next.id)
      }
    }
    const visibleById = new Map(visible.map(vessel => [vessel.id, vessel]))
    for (const card of this.vesselList.querySelectorAll<HTMLElement>('.vessel-card')) {
      const vessel = visibleById.get(card.dataset.vessel!)
      const meta = card.querySelector<HTMLElement>('.vessel-meta')
      if (vessel && meta) this.updateHealthBar(meta, vessel)
    }

    const span = this.endUt - this.startUt
    const ratio = Math.min(1, Math.max(0, (frame.ut - this.startUt) / span))
    this.track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
    this.timeline.setTime(frame.ut)
    const offsets = timelineOffsets(frame.ut, this.missionUt0, this.endUt)
    this.setText(this.timelineElapsed, offsets.elapsed)
    this.setText(this.timelineRemaining, offsets.remaining)
    this.updateBearingRange()

    this.setText(this.clockMission, formatMissionTime(frame.ut, this.missionUt0))
    this.setText(this.hudUt, `UT ${formatKspTime(frame.ut)}`)

    if (frame.state) {
      const state = frame.state
      this.setField('altitude', formatAltitude(state.alt))
      this.setField('speed', state.speed === null ? '—' : formatSpeed(state.speed))
      this.setField('vs', state.verticalSpeed === null ? '—' : formatSpeed(state.verticalSpeed))
      this.setField('heading', state.heading === null ? '—' : formatAngle(state.heading))
      this.setField('throttle', state.throttle === null ? '—' : formatPercent(state.throttle))
      this.setField('mass', state.mass === null ? '—' : formatMass(state.mass))
      this.setField('gee', state.gee === null ? '—' : formatGee(state.gee))
      this.setField('stage', state.stage === null ? '—' : String(state.stage))
      this.setField(
        'situation',
        state.situation === null ? '—' : this.situationLabel(state.situation),
      )
      this.setField('mach', state.mach == null ? '—' : formatNumber(state.mach, 2))
      this.updateResource('lf', state.lf)
      this.updateResource('ox', state.ox)
      this.updateResource('ec', state.ec)
      this.updateResource('mp', state.mp)
    } else {
      for (const field of ['altitude', 'speed', 'vs', 'heading', 'throttle', 'mass', 'gee', 'stage', 'situation', 'mach'] as Field[]) {
        this.setField(field, '—')
      }
      for (const key of ['lf', 'ox', 'ec', 'mp'] as const) this.updateResource(key, null)
    }
    this.updateCombat(frame.state)

    this.highlightEvent(frame.ut)
  }

  private situationLabel(situation: string): string {
    const key = `situation.${situation}` as MessageKey
    const label = i18n.t(key)
    return label === key ? situation : label
  }

  private setField(field: Field, text: string): void {
    const element = this.fieldElements.get(field)
    if (element) this.setText(element, text)
  }

  private updateResource(key: 'lf' | 'ox' | 'ec' | 'mp', value: number | null): void {
    const valueEl = this.resourceValues.get(key)
    const barEl = this.resourceBars.get(key)
    if (!valueEl || !barEl) return
    if (value === null) {
      this.setText(valueEl, '—')
      barEl.style.width = '0%'
      return
    }
    this.setText(valueEl, formatResource(value))
    const max = this.resourceMax[key]
    barEl.style.width = `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`
  }

  private updateCombat(state: VesselState | null): void {
    const replay = this.replay
    const vessel = replay?.vessels.find((item) => item.id === this.selectedId)
    const side = this.combatElements.get('side')
    const health = this.combatElements.get('health')
    const weapon = this.combatElements.get('weapon')
    const lock = this.combatElements.get('lock')
    const last = this.combatElements.get('last')
    if (!replay || !vessel) {
      for (const element of [side, health, weapon, lock, last]) {
        if (element) this.setText(element, '—')
      }
      if (lock) lock.title = ''
      return
    }

    const ut = this.lastUt
    const frame = replayFrameAt(replay, ut)
    if (side) this.setText(side, i18n.t(`side.${frame.side(vessel)}` as MessageKey))
    if (health) {
      this.setText(health, state?.health == null ? '—' : formatPercent(state.health))
    }
    if (weapon) this.setText(weapon, vessel.loadout[0] ?? '—')
    if (lock) {
      const activeLock = this.replay?.locks.find(
        (item) => item.source === vessel.id && item.startUt <= ut && item.endUt >= ut,
      )
      const target = activeLock
        ? this.replay?.vessels.find((item) => item.id === activeLock.target)
        : null
      this.setText(lock, target ? target.name : '—')
      lock.title = target ? target.name : ''
    }
    if (last) {
      const recent = frame.events.lastCombat(vessel.id, ut)
      this.setText(last, recent ? describeEvent(recent, i18n) : '—')
    }
  }

  private highlightEvent(ut: number): void {
    const events = this.windowEvents
    const index = eventBound(events, event => event.ut <= ut + 1e-6) - 1
    if (index === this.activeEvent) return
    this.activeEvent = index
    const rows = this.eventList.querySelectorAll<HTMLElement>('.event-row')
    rows.forEach(row => row.classList.toggle('is-active', Number(row.dataset.index) === index))
    if (index >= 0) this.eventWindow.reveal(index)
  }

  private syncDrawerOffsets(): void {
    this.root.classList.toggle('drawer-left-open', this.leftDrawer.classList.contains('is-open'))
    this.root.classList.toggle('drawer-right-open', this.rightDrawer.classList.contains('is-open'))
  }

  private syncTrailSlider(): void {
    this.trailSlider.value = String(trailStepIndex(this.displaySettings.trailSeconds))
    this.trailValue.textContent = formatTrailDuration(this.displaySettings.trailSeconds)
  }

  private swapTargets(): void {
    const primary = this.selectedId
    const secondary = this.secondaryId
    if (!primary || !secondary) return
    this.callbacks.onSelectVessel(secondary)
  }

  private seekAdjacentEvent(direction: number, inputTime: number): void {
    const replay = this.replay
    if (!replay) return
    const events = replayEventIndex(replay).forVessel(this.selectedId)
    if (events.length === 0) return
    this.callbacks.onSeek(ut => {
      if (direction < 0) {
        const previous = events[eventBound(events, event => event.ut < ut - 1e-6) - 1]
        return Math.max(this.startUt, previous?.ut ?? this.startUt)
      }
      const next = events[eventBound(events, event => event.ut <= ut + 1e-6)]
      return Math.min(this.endUt, next?.ut ?? this.endUt)
    }, inputTime)
  }

  setCameraMode(mode: CameraMode): void {
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-camera]')) {
      button.classList.toggle('is-active', button.dataset.camera === mode)
    }
  }

  private setText(element: Element, text: string): void {
    if (this.textCache.get(element) === text) return
    this.textCache.set(element, text)
    element.textContent = text
  }

  private applyLanguage(): void {
    document.documentElement.lang = i18n.current === 'zh' ? 'zh-CN' : 'en'
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = element.dataset.i18n as MessageKey | undefined
      if (key) element.textContent = i18n.t(key)
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
      const key = element.dataset.i18nTitle as MessageKey | undefined
      if (key) element.title = i18n.t(key)
    }
    this.playButton.title = i18n.t('timeline.play')
    this.playButton.setAttribute('aria-label', this.playButton.title)
    const langButton = query<HTMLElement>(this.root, '#btn-lang')
    langButton.textContent = i18n.current === 'en' ? '中文' : 'EN'
  }
}

function eventDotClass(type: string): string {
  if (['weapon_release', 'gunfire', 'countermeasure', 'chaff', 'flare'].includes(type)) return 'weapon'
  if (['hit', 'kill', 'miss', 'impact', 'proximity_detonation', 'shrapnel', 'crash', 'destroyed'].includes(type)) {
    return 'hit'
  }
  if (type === 'target_lock') return 'lock'
  if (['flight_start', 'flight_end', 'takeoff', 'touchdown', 'landing'].includes(type)) return 'flight'
  return ''
}

import { VirtualList, type ListRow } from './listLayout'
