import './style.css'
import demoUrl from '../testdata/synthetic.kerbtac?url'
import { parseArchiveAsync } from './format/parseClient'
import { FormatError, readArchive } from './format/parse'
import { modelArchiveName, writeReplayWithModels } from './format/writeModels'
import type { Replay } from './format/types'
import { i18n, type MessageKey } from './i18n'
import { PlaybackClock } from './playback/clock'
import type { DisplaySettings } from './playback/displaySettings'
import { replayFrameAt } from './playback/selection'
import type { CameraMode } from './scene/camera'
import { World } from './scene/world'
import { AppView, SPEEDS } from './ui/app'
import { ReplayBenchmark } from './dev/bench'
import { ModelMenuState } from './ui/modelMenu'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing #app element')

let replay: Replay | null = null
let world: World | null = null
let displaySettings: DisplaySettings | undefined
let replaySource: File | null = null
let clock: PlaybackClock | null = null
let selectedId: string | null = null
let cameraMode: CameraMode = 'external'
let demoAvailable = true
const pressed = new Set<string>()
const pageListeners = new AbortController()
const pageSignal = pageListeners.signal
let loadRequest = 0
let loadController: AbortController | undefined

function beginLoad(): AbortSignal {
  loadController?.abort()
  loadController = new AbortController()
  return loadController.signal
}
const benchmark = new URLSearchParams(location.search).has('bench') ? new ReplayBenchmark() : null

const app = new AppView(root, {
  onDemo: () => {
    if (!demoAvailable) {
      app.showToast(i18n.t('load.error'), i18n.t('load.demoMissing'))
      return
    }
    void loadDemo()
  },
  onFile: (file) => {
    void loadFile(file)
  },
  onSeek: seekTo,
  onTogglePlay: togglePlay,
  onSpeed: setSpeed,
  onStepSpeed: cycleSpeed,
  onCamera: (mode) => {
    setCamera(mode)
  },
  onResetCamera: () => {
    world?.resetCamera()
    app.setCameraMode(cameraMode)
  },
  onSelectVessel: (id) => {
    if (id === null) {
      selectedId = null
      world?.setSelected(null)
      app.setSelected(null)
      return
    }
    const vessel = replay?.vessels.find((item) => item.id === id)
    if (!vessel) return
    selectedId = id
    world?.setSelected(id)
    app.setSelected(id)
  },
  onFocusVessel: (id) => {
    focusVessel(id)
  },
  onToggleLanguage: () => {
    i18n.toggle()
  },
  onSaveModels: saveModels,
  onDisplaySettings: (settings) => {
    displaySettings = settings
    world?.setDisplaySettings(settings)
  },
})

app.setCameraMode(cameraMode)

function getWorld(): World {
  if (world) return world
  // The startup UI and native file chooser do not need a GPU context.
  const created = new World(app.viewport, app.labelLayer)
  if (displaySettings) created.setDisplaySettings(displaySettings)
  created.rig.onSatellitePan = () => {
    const hadSelection = selectedId !== null
    selectedId = null
    created.setSelected(null)
    if (hadSelection) app.setSelected(null)
  }
  created.onEventClick = seekTo
  created.onVesselPick = focusVessel
  world = created
  scheduleFrame()
  return created
}

function focusVessel(id: string): void {
  const vessel = replay?.vessels.find((item) => item.id === id)
  if (!vessel) return
  if (cameraMode === 'free') setCamera('external')
  selectedId = id
  world?.setSelected(id)
  app.setSelected(id)
}

function setCamera(mode: CameraMode): void {
  cameraMode = mode
  world?.setCameraMode(mode)
  app.setCameraMode(mode)
}

function seekTo(target: number | ((ut: number) => number), inputTime: number): void {
  if (!clock) return
  // A fixed destination replaces all pre-seek time. Relative/adjacent seeks
  // first need to know where playback was when the input occurred.
  if (typeof target === 'function') advancePlayback(inputTime)
  else anchorPlayback(inputTime)
  benchmark?.seek(inputTime)
  clock.seek(typeof target === 'number' ? target : target(clock.ut))
}

function togglePlay(inputTime: number): void {
  if (!clock) return
  const wasPlaying = clock.playing
  advancePlayback(inputTime)
  if (wasPlaying) clock.pause()
  else clock.play()
}

function setSpeed(speed: number, inputTime: number): void {
  advancePlayback(inputTime)
  clock?.setSpeed(speed)
}

async function loadDemo(): Promise<void> {
  const request = ++loadRequest
  const signal = beginLoad()
  const loadStarted = benchmark ? performance.now() : 0
  app.setLoading(true, i18n.t('load.reading', { name: 'synthetic.kerbtac' }))
  try {
    const response = await fetch(demoUrl, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await loadReplay(await response.arrayBuffer(), 'synthetic.kerbtac', loadStarted, request, signal)
  } catch (error) {
    if (request === loadRequest) {
      demoAvailable = false
      reportError(error)
    }
  } finally {
    if (request === loadRequest) app.setLoading(false)
  }
}

async function loadFile(file: File): Promise<void> {
  const request = ++loadRequest
  const signal = beginLoad()
  const loadStarted = benchmark ? performance.now() : 0
  app.setLoading(true, i18n.t('load.reading', { name: file.name }))
  try {
    await loadReplay(await file.arrayBuffer(), file.name, loadStarted, request, signal, file)
    if (request === loadRequest) app.hideToast()
  } catch (error) {
    if (request === loadRequest) reportError(error)
  } finally {
    if (request === loadRequest) app.setLoading(false)
  }
}

async function loadReplay(bytes: ArrayBuffer, fileName: string, loadStarted: number, request: number,
  signal: AbortSignal, source: File | null = null): Promise<void> {
  if (request !== loadRequest) return
  const parseStart = benchmark ? performance.now() : 0
  const loaded = await parseArchiveAsync(bytes, fileName, undefined, signal)
  if (request !== loadRequest) return
  const parseMs = benchmark ? performance.now() - parseStart : 0
  const scene = getWorld()
  replay = loaded
  replaySource = source
  clock = new PlaybackClock(loaded.startUt, loaded.endUt)
  clock.setGaps(loaded.gaps)
  scene.load(loaded)
  app.setReplay(loaded, new ModelMenuState(loaded.vessels, scene, loaded.modelFiles))
  selectedId = app.selectedVesselId
  setCamera('external')
  scene.setSelected(selectedId)
  clock.play()
  lastFrame = lastPlayback = document.hidden ? null : performance.now()
  document.title = `${fileName} — KerbTac`
  benchmark?.parsed(parseMs, loadStarted)
}

async function saveModels(state: ModelMenuState): Promise<string | undefined> {
  const recording = replay
  const source = replaySource
  if (!recording) return
  const models = state.snapshot()
  const sourceBytes = await (source ? source.arrayBuffer() : fetch(demoUrl).then(response => response.arrayBuffer()))
  if (recording !== replay) return
  const files = new Map<string, Uint8Array>()
  const bindings = []
  const keys = new Map<File | Uint8Array, string>()
  for (const item of models) {
    let key = keys.get(item.source)
    if (!key) {
      key = `${keys.size}/${item.binding.file.split('/').at(-1)}`
      keys.set(item.source, key)
      const bytes = item.source instanceof File ? new Uint8Array(await item.source.arrayBuffer()) : item.source
      files.set(key, bytes)
    }
    bindings.push({ ...item.binding, file: key })
  }
  if (recording !== replay) return
  const result = await writeReplayWithModels(readArchive(new Uint8Array(sourceBytes)), { version: 1, models: bindings }, files)
  if (recording !== replay) return
  const url = URL.createObjectURL(new Blob([result], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  const fileName = modelArchiveName(recording.fileName)
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return fileName
}

function reportError(error: unknown): void {
  console.error(error)
  let detail = i18n.t('error.generic')
  if (error instanceof FormatError) {
    const key = `error.${error.code}` as MessageKey
    const message = i18n.t(key)
    if (message !== key) detail = message
    else if (error.message) detail = error.message
  } else if (error instanceof Error && error.message) {
    detail = error.message
  }
  app.showToast(i18n.t('load.error'), detail)
}

function currentState() {
  if (!replay || !selectedId || !clock) return null
  const vessel = replay.vessels.find((item) => item.id === selectedId)
  const frame = replayFrameAt(replay, clock.ut)
  return vessel && frame.isActive(vessel) ? frame.sample(vessel) : null
}

function cycleSpeed(direction: number, inputTime: number): void {
  if (!clock) return
  const index = SPEEDS.indexOf(clock.speed as (typeof SPEEDS)[number])
  const base = index >= 0 ? index : SPEEDS.indexOf(1)
  const next = Math.min(SPEEDS.length - 1, Math.max(0, base + direction))
  setSpeed(SPEEDS[next], inputTime)
}

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  pressed.add(event.key.toLowerCase())

  switch (event.key) {
    case ' ':
      event.preventDefault()
      togglePlay(event.timeStamp)
      break
    case 'ArrowLeft':
      event.preventDefault()
      seekTo(ut => ut - 5, event.timeStamp)
      break
    case 'ArrowRight':
      event.preventDefault()
      seekTo(ut => ut + 5, event.timeStamp)
      break
    case '[':
      event.preventDefault()
      cycleSpeed(-1, event.timeStamp)
      break
    case ']':
      event.preventDefault()
      cycleSpeed(1, event.timeStamp)
      break
    case 'Escape':
      if (app.helpOpen) app.toggleHelp(false)
      break
    case '?':
      event.preventDefault()
      app.toggleHelp()
      break
    default:
      break
  }

  const key = event.key.toLowerCase()
  if (key === 'f') setCamera('external')
  else if (key === 'c') setCamera('free')
  else if (key === 'r') {
    world?.resetCamera()
    app.setCameraMode(cameraMode)
  } else if (key === 'l') i18n.toggle()
}, { signal: pageSignal })

let lastFrame: number | null = null
let lastPlayback: number | null = null
let raf: number | null = null
let fps = 60

/** Input and RAF use the same performance-origin timestamps. A frame queued
 * before an input may report an older timestamp; never move the anchor back. */
function anchorPlayback(now: number): void {
  if (!document.hidden && (lastPlayback === null || now > lastPlayback)) lastPlayback = now
}

function advancePlayback(now: number): void {
  const previous = lastPlayback
  anchorPlayback(now)
  if (previous !== null && lastPlayback !== null && lastPlayback > previous) {
    clock?.tick((lastPlayback - previous) / 1000)
  }
}

function scheduleFrame(): void {
  if (world && raf === null && !document.hidden && !pageSignal.aborted) raf = requestAnimationFrame(frame)
}

function suspendFrames(): void {
  if (raf !== null) cancelAnimationFrame(raf)
  raf = null
  lastFrame = lastPlayback = null
  pressed.clear()
  benchmark?.resetFrameInterval()
}

function frame(now: number): void {
  raf = null
  if (document.hidden || pageSignal.aborted) return
  const elapsed = lastFrame === null ? 0 : Math.max(0, (now - lastFrame) / 1000)
  const cameraDt = Math.min(0.1, elapsed)
  lastFrame = now
  if (elapsed > 0) fps = fps * 0.92 + (1 / elapsed) * 0.08

  advancePlayback(now)
  const ut = clock?.ut ?? replay?.startUt ?? 0

  if (replay && world) {
    if (cameraMode === 'free') {
      const forward = (pressed.has('w') ? 1 : 0) - (pressed.has('s') ? 1 : 0)
      const right = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0)
      const up = (pressed.has('e') ? 1 : 0) - (pressed.has('q') ? 1 : 0)
      if (forward !== 0 || right !== 0 || up !== 0) {
        world.moveFree(forward, right, up, cameraDt, pressed.has('shift'))
      }
    }
    world.setTime(ut)
    world.update(cameraDt)
  }

  app.update({
    ut,
    playing: clock?.playing ?? false,
    speed: clock?.speed ?? 1,
    state: currentState(),
    fps,
    cameraMode,
    compassDeg: world?.compassHeadingDeg() ?? null,
  })

  if (benchmark && replay && benchmark.frame(now, performance.now(), !!clock?.playing && !document.hidden)) {
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    console.info('[KerbTac benchmark]', benchmark.metrics(heap?.usedJSHeapSize ?? null))
  }
  scheduleFrame()
}

window.addEventListener('keyup', (event) => {
  pressed.delete(event.key.toLowerCase())
}, { signal: pageSignal })

window.addEventListener('blur', () => pressed.clear(), { signal: pageSignal })
// Hidden tabs suspend both the clock and rendering. Keep the user's play/pause
// intent; the first visible frame re-anchors so no hidden time is replayed.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendFrames()
  else scheduleFrame()
}, { signal: pageSignal })
window.addEventListener('pageshow', scheduleFrame, { signal: pageSignal })
window.addEventListener('pagehide', (event) => {
  suspendFrames()
  if (event.persisted) return
  pageListeners.abort()
  ++loadRequest
  loadController?.abort()
  app.dispose()
  world?.dispose()
  world = null
  replay = null
  replaySource = null
  clock = null
}, { signal: pageSignal })
