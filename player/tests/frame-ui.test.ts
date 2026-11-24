import { expect, it, vi } from 'vitest'
import { Mesh, Vector3, type ShaderMaterial, type Scene, type WebGLRenderer } from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import type { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import '../src/style.css'
import { parseArchive } from '../src/format/validate'
import * as selection from '../src/playback/selection'
import { sampleVessel, vesselTerminalUt } from '../src/playback/track'
import { CameraRig } from '../src/scene/camera'
import { World } from '../src/scene/world'
import { AppView } from '../src/ui/app'
import { TimelineView } from '../src/ui/timeline'
import { i18n } from '../src/i18n'
import { loadFixture } from './helpers/fixtures'

const bytes = await loadFixture('synthetic')

it('indexes actor terminal events separately from attribution and resolves ties in input order', () => {
  const replay = recording()
  const [hit, red] = replay.events
  const owner = replay.vessels[0]
  const miss = { ...hit, vessel: 'target', source: owner.id, target: 'target', type: 'miss', data: { actorId: 'missile' } }
  const events = [red, hit, miss, { ...red, data: { side: 'neutral' } }]
  const index = new selection.ReplayEventIndex(events)
  expect(index.forVessel(owner.id)).toEqual([hit, miss, red, events[3]])
  expect(index.forVessel('target')).toEqual([])
  expect(index.terminalUt({ id: 'missile', transient: true })).toBe(miss.ut)
  expect(index.lastCombat(owner.id, red.ut)).toBe(miss)
  expect(index.sideAt(owner, red.ut - 1)).toBe(owner.side)
  expect(index.sideAt(owner, red.ut)).toBe('neutral')
})

function recording() {
  const replay = parseArchive(new Uint8Array(bytes))
  const vessel = replay.vessels[0]
  vessel.segments[0].samples!.health = Float32Array.from(
    vessel.segments[0].samples!.t, t => t < replay.startUt + 30 ? 1 : 0.25,
  )
  replay.manifest.session.ut0 = replay.startUt + 10
  replay.vessels.push({ ...vessel, id: 'ordinary-neutral', name: 'Neutral', side: 'neutral' })
  replay.events = [
    { ...replay.events[0], vessel: vessel.id, source: null, target: null, type: 'hit', ut: replay.startUt + 30 },
    { ...replay.events[0], vessel: vessel.id, source: null, target: null, type: 'team_change',
      data: { side: 'red' }, ut: replay.startUt + 40 },
  ]
  return replay
}

function mount(replay = recording()) {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:640px;height:480px'
  document.body.append(host)
  const noop = () => {}
  const view = new AppView(host, {
    onDemo: noop, onFile: noop, onTogglePlay: noop, onSpeed: noop, onCamera: noop,
    onResetCamera: noop, onSelectVessel: id => view.setSelected(id), onFocusVessel: noop,
    onToggleLanguage: noop, onStepSpeed: noop,
    onSeek: target => draw(typeof target === 'number' ? target : target(replay.startUt)),
  })
  function draw(ut: number) {
    const vessel = replay.vessels.find(v => v.id === view.selectedVesselId)
    view.update({ ut, playing: false, speed: 1, fps: 60, cameraMode: 'external',
      compassDeg: 15, state: vessel ? sampleVessel(vessel, ut, replay.bodies) : null })
  }
  view.setReplay(replay)
  return { host, view, replay, draw }
}

it('offers ordinary neutral vessels in the selectors and preserves the pair on swap', () => {
  const { host, view, draw, replay } = mount()
  try {
    draw(replay.startUt)
    const a = host.querySelector<HTMLSelectElement>('#primary-object')!
    const b = host.querySelector<HTMLSelectElement>('#secondary-object')!
    expect(b.value).toBe('ordinary-neutral')
    host.querySelector<HTMLElement>('#bearing-range')!.click()
    expect(a.value).toBe('ordinary-neutral')
    expect(b.value).toBe(replay.vessels[0].id)
  } finally {
    view.dispose()
    host.remove()
  }
})

function loadDemoFromUi(doc: Document): Promise<void> {
  const button = doc.querySelector<HTMLButtonElement>('#btn-demo')!
  const loading = doc.querySelector<HTMLElement>('#loading')!
  const toast = doc.querySelector<HTMLElement>('#toast')!
  const fileName = doc.querySelector<HTMLElement>('#file-name')!
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(check)
    // Use an overall deadline inside the browser test's timeout. The steady
    // state is signaled by the application, not by waiting a fixed interval.
    const deadline = setTimeout(() => {
      finish(new Error(`Demo load timed out: loading=${!loading.hidden}; ` +
        `file=${fileName.textContent || '(none)'}; viewport=${!!doc.querySelector('.viewport-canvas')}`))
    }, 10_000)
    function finish(error?: Error) {
      observer.disconnect()
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve()
    }
    function check() {
      if (!toast.hidden && !toast.classList.contains('is-notice')) {
        const title = toast.querySelector('#toast-title')?.textContent
        const detail = toast.querySelector('#toast-detail')?.textContent
        finish(new Error(`Demo load failed: ${title} — ${detail}`))
      } else if (loading.hidden && fileName.textContent === 'synthetic.kerbtac' &&
          doc.querySelector('.viewport-canvas')) {
        finish()
      }
    }
    observer.observe(doc.querySelector('#app')!, {
      attributes: true, attributeFilter: ['hidden'],
      childList: true, characterData: true, subtree: true,
    })
    button.click()
    check()
  })
}

async function mountGame({ demoDelayMs = 0, corruptDemo = false } = {}) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:640px;height:480px'
  const demoResponse = demoDelayMs || corruptDemo ? `
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const response = await nativeFetch(url, options);
      if (!String(url).includes('synthetic.kerbtac')) return response;
      if (${demoDelayMs}) await new Promise(resolve => setTimeout(resolve, ${demoDelayMs}));
      return ${corruptDemo} ? new Response('invalid ZIP') : response;
    };
  ` : ''
  iframe.srcdoc = `<div id="app"></div><script>
    ${demoResponse}
    window.framesPending = new Map();
    window.wallNow = 0;
    Object.defineProperty(performance, 'now', { value: () => window.wallNow });
    let id = 0;
    window.requestAnimationFrame = cb => { window.framesPending.set(++id, cb); return id };
    window.cancelAnimationFrame = id => window.framesPending.delete(id);
    window.draw = now => { window.wallNow = Math.max(now, window.wallNow);
      const callbacks = [...window.framesPending.values()]; window.framesPending.clear();
      for (const callback of callbacks) callback(now); };
  </script><script type="module" src="/src/main.ts"></script>`
  const loaded = new Promise<void>(resolve => iframe.addEventListener('load', () => resolve(), { once: true }))
  document.body.append(iframe)
  try {
    await loaded
    const doc = iframe.contentDocument!
    const win = iframe.contentWindow as Window & typeof globalThis & {
      draw(now: number): void; framesPending: Map<number, unknown>; wallNow: number
    }
    await loadDemoFromUi(doc)
    const dispatchAt = (target: EventTarget, event: Event, time: number, delivered = time) => {
      Object.defineProperty(event, 'timeStamp', { value: time })
      win.wallNow = delivered
      target.dispatchEvent(event)
    }
    const click = (selector: string, time: number, delivered = time) =>
      dispatchAt(doc.querySelector(selector)!, new win.MouseEvent('click', { bubbles: true }), time, delivered)
    return { iframe, doc, win, click, dispatchAt }
  } catch (error) {
    iframe.remove()
    throw error
  }
}

it('keeps the app and scene interactive at a fixed paused UT; skips steady-frame redraws', async () => {
  const { iframe, doc, win, click } = await mountGame({ demoDelayMs: 1200 })
  try {
    expect(win.framesPending.size).toBe(1)
    const base = doc.defaultView!.performance.now()
    win.draw(base + 1000)
    expect(doc.querySelector('#clock-mission')!.textContent).toBe('T+ 00:00:01')
    Object.defineProperty(doc, 'hidden', { configurable: true, value: true })
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(win.framesPending.size).toBe(0)
    Object.defineProperty(doc, 'hidden', { configurable: true, value: false })
    doc.dispatchEvent(new Event('visibilitychange'))
    win.draw(base + 100_000)
    expect(doc.querySelector('#clock-mission')!.textContent).toBe('T+ 00:00:01')
    click('#btn-play', base + 100_000)
    win.draw(base + 100_250)
    const time = doc.querySelector('#clock-mission')!.textContent
    expect(time).toBe('T+ 00:00:01')
    const compass = doc.querySelector<HTMLElement>('#compass .compass-arrow')!
    const before = compass.style.transform
    const canvas = doc.querySelector('.viewport-canvas')!
    const mutations = new MutationObserver(() => {})
    mutations.observe(doc.querySelector('#events')!, { childList: true, subtree: true, attributes: true })
    win.draw(base + 100_500)
    expect(mutations.takeRecords()).toHaveLength(0)
    mutations.disconnect()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 40 }))
    win.draw(base + 100_750)
    expect(compass.style.transform).not.toBe(before)
    expect(doc.querySelector('#clock-mission')!.textContent).toBe(time)
    doc.querySelector<HTMLButtonElement>('#btn-display')!.click()
    const metric = doc.querySelector<HTMLSelectElement>('#display-menu select:has(option[value="tas"])')!
    metric.value = 'tas'
    metric.dispatchEvent(new Event('change'))
    win.draw(base + 101_000)
    expect(metric.value).toBe('tas')
    expect(doc.querySelector('#clock-mission')!.textContent).toBe(time)
    win.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(win.framesPending.size).toBe(0)
    expect(doc.querySelector('.viewport-canvas')).toBeNull()
  } finally {
    iframe.remove()
  }
})

it('reports the actual demo parse error instead of timing out during setup', async () => {
  await expect(mountGame({ corruptDemo: true })).rejects.toThrow(
    `Demo load failed: ${i18n.t('load.error')} — ${i18n.t('error.notZip')}`,
  )
})

it('anchors play, seek and speed at input time even between long frames', async () => {
  const { iframe, doc, win, click, dispatchAt } = await mountGame()
  const time = () => doc.querySelector('#clock-mission')!.textContent
  try {
    win.draw(1000)
    expect(time()).toBe('T+ 00:00:01')
    click('#btn-play', 2000)
    win.draw(3000)
    expect(time()).toBe('T+ 00:00:02')
    click('#btn-play', 10000)
    win.draw(11000)
    expect(time()).toBe('T+ 00:00:03')
    click('#btn-faster', 12000, 12500)
    win.draw(11900) // A rendering opportunity timestamp can predate the input callback.
    win.draw(13000)
    expect(time()).toBe('T+ 00:00:06')
    const key = (name: string, timestamp: number) =>
      dispatchAt(win, new win.KeyboardEvent('keydown', { key: name }), timestamp)
    key('[', 14000)
    win.draw(15000)
    expect(time()).toBe('T+ 00:00:09')
    key('ArrowLeft', 16000)
    win.draw(17000)
    expect(time()).toBe('T+ 00:00:06')
    click('#btn-restart', 20000)
    win.draw(21000)
    expect(time()).toBe('T+ 00:00:01')
    const canvas = doc.querySelector<HTMLCanvasElement>('#track canvas')!
    const bounds = canvas.getBoundingClientRect()
    const seek = new win.PointerEvent('pointerdown', { button: 0, buttons: 1,
      clientX: bounds.left + bounds.width * 0.63 })
    const expected = Math.floor(120 * (seek.clientX - bounds.left) / bounds.width + 1)
    dispatchAt(canvas, seek, 25000)
    win.draw(26000)
    expect(time()).toBe(`T+ 00:01:${String(expected - 60).padStart(2, '0')}`)
  } finally {
    win.dispatchEvent(new win.PageTransitionEvent('pagehide'))
    iframe.remove()
  }
})

it('stops timeline seeks after capture loss, released buttons or teardown', () => {
  const host = document.createElement('div')
  host.className = 'track'
  host.style.width = '640px'
  document.body.append(host)
  const seeks: number[] = []
  const timeline = new TimelineView(host, { onSeek: ut => seeks.push(ut) })
  const canvas = timeline.element
  timeline.setReplay(recording())
  const bounds = canvas.getBoundingClientRect()
  function pointer(type: string, pointerId: number, buttons: number, fraction: number) {
    canvas.dispatchEvent(new PointerEvent(type, { pointerId, button: 0, buttons, bubbles: true,
      clientX: bounds.left + bounds.width * fraction }))
  }
  const count = () => seeks.length
  try {
    pointer('pointerdown', 1, 1, 0.1)
    expect(count()).toBe(1)
    pointer('lostpointercapture', 1, 0, 0.1)
    pointer('pointermove', 1, 1, 0.2)
    expect(count()).toBe(1)
    pointer('pointerdown', 2, 1, 0.1)
    pointer('pointermove', 3, 1, 0.2)
    expect(count()).toBe(2)
    pointer('pointerup', 3, 0, 0.2)
    pointer('pointermove', 2, 1, 0.25)
    expect(count()).toBe(3)
    pointer('pointermove', 2, 0, 0.3)
    pointer('pointermove', 2, 1, 0.35)
    expect(count()).toBe(3)
    pointer('pointerdown', 4, 1, 0.4)
    timeline.dispose()
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: -120 })
    canvas.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(false)
    expect(Reflect.get(timeline, 'replay')).toBeNull()
    expect(Reflect.get(timeline, 'events')).toHaveLength(0)
  } finally {
    timeline.dispose()
    host.remove()
  }
})

it('unmounts AppView without intercepting drag/drop on the reused root', () => {
  const { host, view } = mount()
  host.id = 'app'
  const timeline = Reflect.get(view, 'timeline') as TimelineView
  function cancelled(type: string) {
    return !host.dispatchEvent(new DragEvent(type, { cancelable: true, bubbles: true }))
  }
  try {
    expect(cancelled('dragover')).toBe(true)
    expect(cancelled('drop')).toBe(true)
    view.dispose()
    expect(cancelled('dragover')).toBe(false)
    expect(cancelled('dragenter')).toBe(false)
    expect(cancelled('drop')).toBe(false)
    expect(Reflect.get(view, 'replay')).toBeNull()
    expect(Reflect.get(view, 'windowEvents')).toHaveLength(0)
    expect(Reflect.get(timeline, 'replay')).toBeNull()
  } finally {
    view.dispose()
    host.remove()
  }
})

// This workload uses notes/team changes (no independent combat FX meshes),
// identical in the old and new revisions. Timer covers JS/render submission,
// not GPU completion. Run separately from the parallel regression suite.
it('benchmarks event-dense playback and pause with identical data', async ({ annotate }) => {
  const replay = recording()
  replay.vessels = Array.from({ length: 16 }, (_, i) => ({
    ...replay.vessels[0], id: `bench-${i}`, side: 'neutral', name: `Bench ${i}`,
  }))
  replay.events = Array.from({ length: 24_000 }, (_, i) => ({
    ...replay.events[0], ut: replay.startUt + i / 240, vessel: `bench-${i % 16}`,
    type: i % 31 === 0 ? 'team_change' : 'note',
    data: { side: i % 2 ? 'blue' : 'red' }, body: null, lat: null, lon: null, alt: null,
  }))
  const { host, view, draw } = mount(replay)
  const world = new World(view.viewport, view.labelLayer)
  const times = Array.from({ length: 21 }, (_, i) => replay.startUt + 25 + i * 0.5)
  const result: string[] = []
  function timing(label: string, iterate: (ut: number) => void, values = times, repetitions = 1) {
    iterate(values[0])
    const durations = values.map(ut => {
      const start = performance.now()
      for (let i = 0; i < repetitions; i++) iterate(ut)
      return (performance.now() - start) / repetitions
    }).sort((a, b) => a - b)
    result.push(`${label}: median ${durations[10].toFixed(4)} ms; p95 ${durations[19].toFixed(4)} ms`)
  }
  try {
    world.load(replay)
    const events = Reflect.get(selection, 'replayEventIndex')?.(replay) as selection.ReplayEventIndex | undefined
    timing('event lookup only (full scans)', ut => {
      let hits = 0
      for (const vessel of replay.vessels) {
        if (selection.sideAt(vessel, ut, replay.events) !== 'neutral') hits++
        if (vesselTerminalUt(vessel, replay.events) !== null) hits++
      }
      expect(selection.eventsForSelection(replay.events, replay.vessels[0].id)).toHaveLength(1500)
      expect(hits).toBe(16)
    }, times, 8)
    if (events) timing('event lookup only (indexed)', ut => {
      let hits = 0
      for (const vessel of replay.vessels) {
        if (events.sideAt(vessel, ut) !== 'neutral') hits++
        if (events.terminalUt(vessel) !== null) hits++
      }
      expect(events.forVessel(replay.vessels[0].id)).toHaveLength(1500)
      expect(hits).toBe(16)
    }, times, 100)
    const combined = (ut: number) => { draw(ut); world.setTime(ut); world.update(0.016) }
    timing('app + world playback frame', combined)
    timing('app + world paused frame', combined, times.map(() => times[0]))
    await annotate(result.join('\n'), 'notice')
  } finally {
    world.dispose()
    Reflect.get(view, 'dispose')?.call(view)
    host.remove()
  }
}, 20_000)

it('updates the combat Health and existing vessel row after a timeline pointer seek', () => {
  const { host, view, draw, replay } = mount()
  try {
    draw(replay.startUt)
    const card = host.querySelector<HTMLElement>(`[data-vessel="${replay.vessels[0].id}"]`)!
    expect(card.querySelector('.vessel-health-fill')).toBeNull()
    const canvas = host.querySelector<HTMLCanvasElement>('#track canvas')!
    const bounds = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: bounds.left + bounds.width * 0.3 }))
    expect(host.querySelector('[data-i18n="combat.health"]')!.nextElementSibling!.textContent).toBe('25%')
    expect(card.querySelector<HTMLElement>('.vessel-health-fill')?.style.width).toBe('25%')
    const healthMenu = host.querySelector<HTMLElement>('[data-i18n="display.healthBars"]')!
    const toggle = healthMenu.closest('label')!.querySelector('input')!
    toggle.click()
    draw(replay.startUt + (replay.endUt - replay.startUt) * 0.3)
    expect(card.querySelector('.vessel-health-fill')).toBeNull()
    toggle.click()
    draw(replay.startUt + (replay.endUt - replay.startUt) * 0.3)
    expect(card.querySelector<HTMLElement>('.vessel-health-fill')?.style.width).toBe('25%')
    draw(replay.startUt)
    expect(card.querySelector('.vessel-health:not([hidden])')).toBeNull()
  } finally {
    view.dispose()
    host.remove()
  }
})

it('hides unknown per-row Health without replacing it with manifest data', () => {
  const replay = recording()
  const vessel = replay.vessels[0]
  vessel.health = 0.8
  vessel.loadout = ['Recorded weapon']
  const table = vessel.segments[0].samples!
  table.health = Float32Array.from(table.t, ut =>
    ut < replay.startUt + 35 ? 0.25 : ut < replay.startUt + 38 ? NaN : 0)
  replay.locks = [{
    source: vessel.id, target: 'ordinary-neutral', sensor: null, mode: null,
    startUt: replay.startUt + 32, endUt: replay.startUt + 39,
  }]
  const { host, view, draw } = mount(replay)
  const field = (key: string) => host.querySelector(`[data-i18n="combat.${key}"]`)!.nextElementSibling!.textContent
  const bar = () => host.querySelector<HTMLElement>(`[data-vessel="${vessel.id}"] .vessel-health-fill`)
  try {
    draw(replay.startUt + 34)
    expect(field('health')).toBe('25%')
    expect(bar()?.style.width).toBe('25%')
    draw(replay.startUt + 36)
    expect(field('health')).toBe('—')
    expect(bar()).toBeNull()
    expect(field('weapon')).toBe('Recorded weapon')
    expect(field('lock')).toBe('Neutral')
    expect(field('last')).toBe(i18n.t('event.hit'))
    expect(field('side')).toBe(i18n.t(`side.${vessel.side ?? 'neutral'}`))
    draw(replay.startUt + 39)
    expect(field('health')).toBe('0%')
    expect(bar()?.style.width).toBe('0%')
  } finally {
    view.dispose()
    host.remove()
  }
})

it('shows lock and recent event for a neutral vessel without any Health or loadout', () => {
  const replay = recording()
  const vessel = replay.vessels[0]
  vessel.side = 'neutral'
  vessel.health = null
  vessel.loadout = []
  vessel.segments[0].samples!.health = null
  replay.locks = [{
    source: vessel.id, target: 'ordinary-neutral', sensor: null, mode: null,
    startUt: replay.startUt, endUt: replay.endUt,
  }]
  const { host, view, draw } = mount(replay)
  const field = (key: string) => host.querySelector(`[data-i18n="combat.${key}"]`)!.nextElementSibling!.textContent
  try {
    draw(replay.startUt + 35)
    expect(field('lock')).toBe('Neutral')
    expect(field('last')).toBe(i18n.t('event.hit'))
    expect(field('health')).toBe('—')
    expect(field('weapon')).toBe('—')
    expect(field('side')).toBe(i18n.t('side.neutral'))
  } finally {
    view.dispose()
    host.remove()
  }
})

it('shows signed mission time from ut0 while restart seeks the playback boundary', () => {
  const { host, view, draw, replay } = mount()
  try {
    draw(replay.startUt + 40)
    expect(host.querySelector('#clock-mission')!.textContent).toBe('T+ 00:00:30')
    expect(host.querySelector('#timeline-elapsed')!.textContent).toBe('+00:00:30')
    const canvas = host.querySelector<HTMLCanvasElement>('#track canvas')!
    const bounds = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: bounds.left + bounds.width * (30 / (replay.endUt - replay.startUt)),
    }))
    expect(host.querySelector('.timeline-tooltip')!.textContent).toBe('T+ 00:00:20 · hit')
    expect(host.querySelector('.event-time')!.textContent).toBe('00:00:20')
    host.querySelector<HTMLElement>('#btn-restart')!.click()
    expect(host.querySelector('#clock-mission')!.textContent).toBe('T- 00:00:10')
    expect(host.querySelector('#track')!.getAttribute('aria-valuenow')).toBe('0')
  } finally {
    view.dispose()
    host.remove()
  }
})

it('turns on horizontal pointer drags at the pitch clamp, and detaches on dispose', () => {
  const el = document.createElement('canvas')
  document.body.append(el)
  try {
    const rig = new CameraRig(el)
    rig.setExternalAngles(60, 1)
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, clientX: 10 }))
    el.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 30 }))
    expect(rig.yawDeg).toBeCloseTo(55)
    expect(rig.pitchDeg).toBeCloseTo(1)
    el.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 50, clientY: 200 }))
    expect(rig.yawDeg).toBeCloseTo(50)
    expect(rig.pitchDeg).toBeCloseTo(1)
    rig.dispose()
    expect(el.classList.contains('is-orbiting')).toBe(false)
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1 }))
    el.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 25, clientY: -10 }))
    expect(rig.yawDeg).toBeCloseTo(50)
  } finally {
    el.remove()
  }
})

it('changes WebGL height-wall opacity without changing merged geometry or side tint', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:320px;height:240px'
  const labels = host.appendChild(document.createElement('div'))
  document.body.append(host)
  const replay = recording()
  const world = new World(host, labels)
  try {
    world.load(replay)
    world.setHeightWall('all')
    world.setTime(replay.startUt + 60)
    world.update(0)
    const wall = (Reflect.get(world, 'scene') as Scene).getObjectByName('vessel-height-wall') as Mesh
    const geometry = wall.geometry
    expect(wall.visible).toBe(true)
    const original = Array.from(geometry.getAttribute('alpha').array)
    world.setHeightMetric('tas')
    world.update(0)
    expect(wall.geometry).toBe(geometry)
    expect(Array.from(geometry.getAttribute('alpha').array)).not.toEqual(original)
    const material = wall.material as ShaderMaterial
    expect(material.uniforms.wallColor.value.getHexString()).toBe('ff5f6d')
    await expect.poll(() => wall.geometry).not.toBe(geometry)
    world.update(0)
    const alpha = wall.geometry.getAttribute('alpha')
    expect(wall.geometry.userData.substeps).toBe(4)
    expect(Math.max(...alpha.array)).toBeCloseTo(0.5)
    expect(wall.geometry.drawRange.count).toBeLessThan(wall.geometry.index!.count)
    world.setCameraMode('satellite')
    world.update(0)
    expect(wall.visible).toBe(false)
  } finally {
    world.dispose()
    host.remove()
  }
})

it('preserves ASL geometry but excludes missing AGL from coarse and Worker wall opacity', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:320px;height:240px'
  const labels = host.appendChild(document.createElement('div'))
  document.body.append(host)
  const replay = recording()
  const vessel = replay.vessels[0]
  const table = vessel.segments[0].samples!
  table.alt.fill(500)
  table.agl = Float32Array.from(table.t, (_, i) => (i >= 10 && i < 20 ? NaN : i < 10 ? 0 : 100))
  const radius = replay.bodies.get(vessel.body)!.radius
  const world = new World(host, labels)
  try {
    world.load(replay)
    world.setTime(replay.startUt + 10)
    world.update(0)
    const wall = (Reflect.get(world, 'scene') as Scene).getObjectByName('vessel-height-wall') as Mesh
    const coarse = wall.geometry
    const check = (substeps: number) => {
      expect(wall.geometry.userData.substeps).toBe(substeps)
      const alpha = wall.geometry.getAttribute('alpha')
      const position = wall.geometry.getAttribute('position')
      const vertex = (sample: number) => sample * 2 * substeps + 1
      expect(alpha.getX(vertex(5))).toBeCloseTo(0.15)
      expect(alpha.getX(vertex(15))).toBeCloseTo(0.15)
      expect(alpha.getX(vertex(25))).toBeCloseTo(0.5)
      expect(new Vector3().fromBufferAttribute(position, vertex(15)).length() - radius).toBeCloseTo(500, 0)
      expect(new Vector3().fromBufferAttribute(position, vertex(25)).length() - radius).toBeCloseTo(100, 0)
    }
    check(1)
    await expect.poll(() => wall.geometry).not.toBe(coarse)
    world.update(0)
    check(4)
  } finally {
    world.dispose()
    host.remove()
  }
})

it('does not submit WebGL work for an unchanged frame, but redraws after paused wheel input', () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:320px;height:240px'
  const labels = host.appendChild(document.createElement('div'))
  document.body.append(host)
  const world = new World(host, labels)
  try {
    const replay = recording()
    world.load(replay)
    const renderer = Reflect.get(world, 'renderer') as WebGLRenderer
    world.setTime(replay.startUt + 35)
    world.update(0.016)
    const before = renderer.info.render.frame
    world.update(0.016)
    expect(renderer.info.render.frame).toBe(before)
    const distance = world.rig.distance
    host.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    world.update(0.016)
    expect(world.rig.distance).toBeGreaterThan(distance)
    expect(renderer.info.render.frame).toBeGreaterThan(before)
  } finally {
    world.dispose()
    host.remove()
  }
})

it('redraws a paused scene after real WebGL context restoration without input', async () => {
  const replay = recording()
  const oldBody = replay.bodies.get('Kerbin')!
  // No async Kerbin map upload or selected trail job may invalidate the
  // paused scene coincidentally while the context is being restored.
  const body = { ...oldBody, name: 'TestBody' }
  replay.bodies.set(body.name, body)
  for (const vessel of replay.vessels) {
    vessel.body = body.name
    for (const segment of vessel.segments) segment.body = body.name
  }
  const { host, view, draw } = mount(replay)
  const world = new World(view.viewport, view.labelLayer)
  const undoSpies: Array<() => void> = []
  try {
    const canvas = view.viewport.querySelector<HTMLCanvasElement>('.viewport-canvas')!
    const gl = canvas.getContext('webgl2')!
    const context = gl.getExtension('WEBGL_lose_context')!
    expect(context).not.toBeNull()
    const draws = [
      vi.spyOn(gl, 'drawArrays'), vi.spyOn(gl, 'drawElements'),
      vi.spyOn(gl, 'drawArraysInstanced'), vi.spyOn(gl, 'drawElementsInstanced'),
    ]
    undoSpies.push(...draws.map(spy => () => spy.mockRestore()))
    const drawCount = () => draws.reduce((total, spy) => total + spy.mock.calls.length, 0)
    const nextContextEvent = (type: string) => new Promise<void>((resolve, reject) => {
      const signal = AbortSignal.timeout(3000)
      signal.addEventListener('abort', () => reject(new Error(`Did not receive ${type}`)), { once: true })
      canvas.addEventListener(type, () => resolve(), { once: true, signal })
    })
    world.load(replay)
    world.setSelected(null)
    const ut = replay.startUt + 35
    world.setTime(ut)
    draw(ut)
    world.update(0.016)
    expect(drawCount()).toBeGreaterThan(0)
    const steady = drawCount()
    world.update(0.016)
    expect(drawCount()).toBe(steady)

    const lost = nextContextEvent('webglcontextlost')
    context.loseContext()
    await lost
    expect(gl.isContextLost()).toBe(true)
    // Let the loss event finish dispatch, including Three's preventDefault,
    // before asking Chrome to restore the context.
    await new Promise(resolve => requestAnimationFrame(resolve))
    const restored = nextContextEvent('webglcontextrestored')
    context.restoreContext()
    await restored
    expect(gl.isContextLost()).toBe(false)
    const beforeRestoreFrame = drawCount()
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      world.update(0.016)
      resolve()
    }))
    expect(drawCount(), 'first paused frame after WebGL restoration').toBeGreaterThan(beforeRestoreFrame)
    expect(Reflect.get(world, 'currentUt')).toBe(ut)
    expect(host.querySelector('#clock-mission')!.textContent).toBe('T+ 00:00:25')
    expect(host.querySelector('#play-state')!.textContent).toBe(i18n.t('timeline.paused'))
    const afterRestoreFrame = drawCount()
    world.update(0.016)
    expect(drawCount()).toBe(afterRestoreFrame)
  } finally {
    undoSpies.forEach(restore => restore())
    world.dispose()
    view.dispose()
    host.remove()
  }
})

it('releases composer, outline, and output GPU resources on world teardown', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const adds = vi.spyOn(EventTarget.prototype, 'addEventListener')
  const removals = vi.spyOn(EventTarget.prototype, 'removeEventListener')
  const world = new World(host, document.createElement('div'))
  try {
    const canvas = host.querySelector('canvas')!
    const restoreHandlers = adds.mock.calls.filter(([type], i) =>
      type === 'webglcontextrestored' && adds.mock.contexts[i] === canvas).map(([, listener]) => listener)
    const composer = Reflect.get(world, 'composer') as EffectComposer
    const outline = composer.passes[1] as OutlinePass
    const output = composer.passes[2] as OutputPass
    const targets = [
      composer.renderTarget1, composer.renderTarget2, outline.renderTargetMaskBuffer, output.material,
    ]
    const disposed: string[] = []
    targets.forEach((resource, index) => {
      if ('isMaterial' in resource) resource.addEventListener('dispose', () => disposed.push(`material:${index}`))
      else resource.addEventListener('dispose', () => disposed.push(`target:${index}`))
    })
    world.dispose()
    expect(restoreHandlers).toHaveLength(2) // Three and World
    const removedHandlers = removals.mock.calls.filter(([type], i) =>
      type === 'webglcontextrestored' && removals.mock.contexts[i] === canvas).map(([, listener]) => listener)
    expect(removedHandlers).toEqual(expect.arrayContaining(restoreHandlers))
    expect(disposed.sort()).toEqual(['material:3', 'target:0', 'target:1', 'target:2'])
    world.dispose()
    expect(disposed).toHaveLength(4)
    expect(host.querySelector('canvas')).toBeNull()
  } finally {
    world.dispose()
    adds.mockRestore()
    removals.mockRestore()
    host.remove()
  }
})
