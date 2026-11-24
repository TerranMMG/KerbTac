import type { BufferGeometry } from 'three'
import { MAX_MODELS_BYTES, type ModelBinding } from '../format/models'
import type { VesselTrack } from '../format/types'
import { i18n, type MessageKey } from '../i18n'
import { displayVesselName } from '../playback/roles'
import { canCustomizeModel, loadCustomGeometry, type CustomModelEntry } from '../scene/customModels'

interface ModelRegistry {
  getCustomModel(id: string): CustomModelEntry | null
  setCustomModel(id: string, geometry: BufferGeometry, binding: ModelBinding): void
  clearCustomModel(id: string): void
}

type Transform = Pick<ModelBinding, 'scale' | 'rotation' | 'offset'>
const identity: Transform = { scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0] }
export type ModelSource = File | Uint8Array

export class ModelMenuState {
  readonly vessels: VesselTrack[]
  private readonly rows = new Map<string, VesselTrack>()
  private readonly sources = new Map<string, ModelSource>()
  private readonly embedded = new Set<string>()
  private readonly pending = new Map<string, symbol>()
  private closed = false

  constructor(vessels: readonly VesselTrack[], private readonly registry: ModelRegistry,
    embeddedFiles: ReadonlyMap<string, Uint8Array> = new Map()) {
    this.vessels = vessels.filter(canCustomizeModel)
    for (const vessel of this.vessels) {
      this.rows.set(vessel.id, vessel)
      const binding = this.binding(vessel.id)
      const data = binding && embeddedFiles.get(binding.file)
      if (data) {
        this.sources.set(vessel.id, data)
        this.embedded.add(vessel.id)
      }
    }
  }

  binding(id: string): ModelBinding | undefined {
    return this.registry.getCustomModel(id)?.binding
  }

  get totalBytes(): number {
    let total = 0
    for (const source of new Set(this.sources.values())) total += source instanceof File ? source.size : source.byteLength
    return total
  }

  get canSave(): boolean {
    return this.sources.size > 0 || this.embedded.size > 0
  }

  snapshot(): Array<{ binding: ModelBinding; source: ModelSource }> {
    return [...this.sources].flatMap(([id, source]) => {
      const binding = this.binding(id)
      return binding ? [{ binding, source }] : []
    })
  }

  async choose(id: string, file: File): Promise<void> {
    if (this.closed || !this.rows.has(id)) return
    const token = Symbol()
    this.pending.set(id, token)
    let geometry: BufferGeometry | undefined
    try {
      geometry = await loadCustomGeometry(file)
      if (this.closed || this.pending.get(id) !== token) return
      this.registry.setCustomModel(id, geometry, { vesselId: id, file: file.name, ...identity })
      geometry = undefined
      this.sources.set(id, file)
    } catch (error) {
      if (!this.closed && this.pending.get(id) === token) throw error
    } finally {
      geometry?.dispose()
      if (this.pending.get(id) === token) this.pending.delete(id)
    }
  }

  reset(id: string): void {
    this.pending.delete(id)
    this.registry.clearCustomModel(id)
    this.sources.delete(id)
  }

  setTransform(id: string, transform: Transform): void {
    const current = this.registry.getCustomModel(id)
    if (!current || this.closed) return
    this.registry.setCustomModel(id, current.geometry, { ...current.binding, ...transform })
  }

  resetTransform(id: string): void {
    this.setTransform(id, identity)
  }

  close(): void {
    this.closed = true
    this.pending.clear()
  }
}

export function mountModelMenu(panel: HTMLElement, opener: HTMLButtonElement,
  onSave: (state: ModelMenuState) => Promise<string | undefined>,
  onError: (key: MessageKey) => void,
  onDownload: (fileName: string) => void,
  onOpen: () => void,
): { setState(state: ModelMenuState | null): void; refresh(): void; close(): void } {
  const list = panel.querySelector<HTMLElement>('#model-list')!
  const size = panel.querySelector<HTMLElement>('#models-size')!
  const save = panel.querySelector<HTMLButtonElement>('#models-save')!
  let state: ModelMenuState | null = null
  let saving = false

  const isOpen = () => panel.classList.contains('is-open')

  function open(visible: boolean): void {
    if (visible === isOpen()) return
    const restoreFocus = !visible && panel.contains(document.activeElement)
    if (restoreFocus) opener.focus({ preventScroll: true })
    panel.inert = !visible
    panel.classList.toggle('is-open', visible)
    opener.setAttribute('aria-expanded', String(visible))
    if (visible) {
      onOpen()
      refresh()
      panel.querySelector<HTMLButtonElement>('#models-close')?.focus({ preventScroll: true })
    }
  }

  opener.addEventListener('click', () => open(!isOpen()))
  for (const id of ['#models-close', '#models-session']) {
    panel.querySelector(id)!.addEventListener('click', () => open(false))
  }
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    open(false)
  })
  save.addEventListener('click', async () => {
    const current = state
    if (!current?.canSave || saving) return
    saving = true
    updateFooter()
    try {
      const fileName = await onSave(current)
      if (fileName && state === current) onDownload(fileName)
    } catch {
      if (state === current) onError('models.saveError')
    } finally {
      saving = false
      updateFooter()
    }
  })

  function button(key: MessageKey, action: () => void): HTMLButtonElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'btn ghost small'
    el.textContent = i18n.t(key)
    el.addEventListener('click', action)
    return el
  }

  function updateFooter(): void {
    const total = state?.totalBytes ?? 0
    const over = total > MAX_MODELS_BYTES
    size.textContent = i18n.t(over ? 'models.sizeWarning' : 'models.size', {
      size: (total / (1024 * 1024)).toFixed(1),
    })
    save.disabled = !state?.canSave || saving
    save.textContent = i18n.t(saving ? 'models.saving' : 'models.save')
  }

  function refresh(): void {
    if (!isOpen() || !state) return
    const current = state
    list.replaceChildren(...current.vessels.map(vessel => createRow(current, vessel)))
    updateFooter()
  }

  function createRow(current: ModelMenuState, vessel: VesselTrack): HTMLElement {
    const row = document.createElement('section')
    row.className = 'model-row'
    row.dataset.vesselId = vessel.id
    const heading = document.createElement('h3')
    heading.textContent = displayVesselName(vessel)
    heading.title = heading.textContent
    const type = document.createElement('span')
    type.className = 'model-type'
    type.textContent = [vessel.type, vessel.modelRole].filter(Boolean).join(' · ')
    type.title = type.textContent
    const fileName = document.createElement('span')
    fileName.className = 'model-filename'
    const actions = document.createElement('div')
    actions.className = 'model-actions'
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.obj,.stl'
    input.hidden = true
    const choose = button('models.choose', () => input.click())
    const reset = button('models.reset', () => { current.reset(vessel.id); renderTransform() })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      try {
        await current.choose(vessel.id, file)
        if (state === current) {
          if (row.isConnected) renderTransform()
          else refresh()
        }
      } catch {
        if (state === current) onError('models.loadError')
      }
    })
    actions.append(choose, reset, input)
    const fields = document.createElement('div')
    fields.className = 'model-transform'
    const summary = document.createElement('div')
    summary.className = 'model-summary'
    summary.append(heading, type, fileName, actions)
    row.append(summary, fields)
    renderTransform()
    return row

    function renderTransform(): void {
      const binding = current.binding(vessel.id)
      fileName.textContent = binding?.file.split('/').at(-1) ?? i18n.t('models.builtIn')
      fileName.title = fileName.textContent
      reset.disabled = !binding
      fields.replaceChildren()
      fields.hidden = !binding
      updateFooter()
      if (!binding) return
      const values = [binding.scale, ...binding.rotation, ...binding.offset]
      const keys: MessageKey[] = [
        'models.scale', 'models.rotationX', 'models.rotationY', 'models.rotationZ',
        'models.offsetX', 'models.offsetY', 'models.offsetZ',
      ]
      const inputs = keys.map((key, index) => {
        const label = document.createElement('label')
        label.textContent = i18n.t(key)
        const field = document.createElement('input')
        field.type = 'number'
        field.step = 'any'
        field.required = true
        field.value = String(values[index])
        field.addEventListener('change', updateTransform)
        label.append(field)
        fields.append(label)
        return field
      })
      fields.append(button('models.resetTransform', () => {
        current.resetTransform(vessel.id)
        renderTransform()
      }))

      function updateTransform(): void {
        const [scale, rx, ry, rz, x, y, z] = inputs.map(field => field.valueAsNumber)
        if (![scale, rx, ry, rz, x, y, z].every(Number.isFinite) || !scale || scale < 0) {
          onError('models.transformError')
          renderTransform()
          return
        }
        try {
          current.setTransform(vessel.id, { scale, rotation: [rx!, ry!, rz!], offset: [x!, y!, z!] })
        } catch {
          onError('models.transformError')
          renderTransform()
        }
      }
    }
  }

  return {
    setState(next) {
      state?.close()
      state = next
      opener.disabled = !next?.vessels.length
      open(false)
      list.replaceChildren()
      updateFooter()
    },
    refresh,
    close: () => open(false),
  }
}
